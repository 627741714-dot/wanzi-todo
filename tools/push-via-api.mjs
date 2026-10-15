/* 网络环境里 github.com:443 经常连不上（但 api.github.com:443 是通的），
   所以 git push 会失败。这里用 GitHub 的 Contents API 直接把工作区里
   相对于上次提交改动过的文件写上去 —— 效果和 push 一样，走的是 api.github.com。

   用法：node tools/push-via-api.mjs            # 推送所有改动过的已跟踪文件
        node tools/push-via-api.mjs --dry        # 只看会推什么
*/
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = '627741714-dot';
const REPO = path.basename(ROOT);
const DRY = process.argv.includes('--dry');
const DELETE = process.argv.includes('--delete');

/* 一律走 -z（NUL 分隔）+ core.quotepath=false：
   默认的 git 会把中文文件名写成 "\344\270\270..." 这种带引号的转义形式，
   拿它去 fs.existsSync 永远找不到 —— 上一轮就是这样把 18 张新截图和
   丸梓todo.html 静默漏掉的（只推了 11 个 ASCII 名字的文件）。 */
function git(...args) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: ROOT, encoding: 'utf8' });
}

/* 按 NUL 切开，过滤空串。前提是命令带了 -z。 */
function gitZ(...args) {
  return git(...args).split('\0').filter(Boolean);
}

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const gh = 'C:\\Program Files\\GitHub CLI\\gh.exe';
  return execFileSync(gh, ['auth', 'token'], { encoding: 'utf8' }).trim();
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD').trim();

const T = token();
/* 这个网络环境里 api.github.com 也会时不时 ECONNRESET，一口气几十个请求
   跑到一半就断。所以每个请求都带重试（4 次，0.6s / 1.2s / 2.4s 退避）。 */
async function api(p, opts) {
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      return await fetch('https://api.github.com' + p, {
        ...opts,
        headers: {
          authorization: 'Bearer ' + T,
          accept: 'application/vnd.github+json',
          'user-agent': 'wanzi-push-via-api',
          ...(opts && opts.headers)
        }
      });
    } catch (e) {
      last = e;
      console.log('  （第 ' + (i + 1) + ' 次请求失败：' + (e.cause && e.cause.code ? e.cause.code : e.message) + '，等一下重来）');
      await new Promise(r => setTimeout(r, 600 * Math.pow(2, i)));
    }
  }
  throw last;
}

/* 先拿远端分支的当前 sha 作为父提交 */
const ref = await api(`/repos/${OWNER}/${REPO}/git/ref/heads/${branch}`).then(r => r.json());
if (!ref.object) { console.error('拿不到分支 ref：' + JSON.stringify(ref)); process.exit(1); }
const parentSha = ref.object.sha;
const parent = await api(`/repos/${OWNER}/${REPO}/git/commits/${parentSha}`).then(r => r.json());
console.log('父提交 ' + parentSha.slice(0, 8));

const GONE = [];   /* 远端还有、本地已删的文件 */

/* 跟【远端那个 sha】比，而不是跟本地 origin/master —— API 推出来的提交本地根本没有，
   本地跟踪分支会一直停在老位置，那样每次都会把全部文件重推一遍。
   本地没这个对象，就找共同祖先来比；再不济就比"两边内容不一样的文件"。 */
const localHead = git('rev-parse', 'HEAD').trim();
let changed = [];
if (parentSha === localHead) {
  changed = [];
} else {
  let base = null;
  try { git('fetch', '--no-tags', 'origin', branch); base = parentSha; } catch { /* 网络不好，正常 */ }
  if (base) {
    changed = gitZ('diff', '--name-only', '-z', base + '..HEAD');
    try { git('update-ref', 'refs/remotes/origin/' + branch, base); } catch { /* 算了 */ }
  } else {
    /* 本地没有远端提交：把两边所有文件都拿出来，逐个比内容 sha */
    const remoteTree = await api(`/repos/${OWNER}/${REPO}/git/trees/${parent.tree.sha}?recursive=1`).then(r => r.json());
    const remote = new Map();
    for (const e of (remoteTree.tree || [])) if (e.type === 'blob') remote.set(e.path, e.sha);
    const localFiles = gitZ('ls-files', '-z');
    for (const f of localFiles) {
      const rel = f.split(path.sep).join('/');
      const buf = fs.readFileSync(path.join(ROOT, f));
      const blob = await api(`/repos/${OWNER}/${REPO}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: buf.toString('base64'), encoding: 'base64' })
      }).then(x => x.json());
      if (!blob.sha) { console.error('建 blob 失败：' + f + ' → ' + JSON.stringify(blob)); process.exit(1); }
      if (remote.get(rel) !== blob.sha) changed.push(f);
      remote.delete(rel);
    }
    /* 远端有、本地已经没有的文件。默认不动它（免得手滑清空远端），
       加 --delete 才会在这次提交里删掉。 */
    for (const gone of remote.keys()) {
      GONE.push(gone);
      console.log('  （远端还有、本地已删：' + gone + '）');
    }
  }
}
/* 工作区里还没提交的改动（含未跟踪的新文件）也算。
   用 diff --name-only 而不是 status --porcelain：后者每条前面带 "XY " 前缀，
   而且重命名会多带一个"来源"路径，解析起来容易踩坑。 */
const dirtyTracked = gitZ('diff', '--name-only', '-z', 'HEAD');
const untracked = gitZ('ls-files', '--others', '--exclude-standard', '-z');
const files = [...new Set([...changed, ...dirtyTracked, ...untracked])]
  .filter(f => f && fs.existsSync(path.join(ROOT, f)));

if (!files.length && !(DELETE && GONE.length)) { console.log('没有要推的文件。'); process.exit(0); }
console.log('分支 ' + branch + '，要推 ' + files.length + ' 个文件：');
for (const f of files) console.log('  ' + f);
if (DELETE && GONE.length) console.log('并删掉远端 ' + GONE.length + ' 个已不存在的文件（--delete）');
if (DRY) process.exit(0);

/* 逐个文件建 blob */
const entries = [];
for (const f of files) {
  const buf = fs.readFileSync(path.join(ROOT, f));
  const r = await api(`/repos/${OWNER}/${REPO}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: buf.toString('base64'), encoding: 'base64' })
  }).then(x => x.json());
  if (!r.sha) { console.error('建 blob 失败：' + f + ' → ' + JSON.stringify(r)); process.exit(1); }
  entries.push({ path: f.split(path.sep).join('/'), mode: '100644', type: 'blob', sha: r.sha });
  console.log('  blob ' + r.sha.slice(0, 8) + '  ' + f);
}

/* 要删的走 sha:null（Git Data API 的删除写法） */
if (DELETE) for (const g of GONE) entries.push({ path: g, mode: '100644', type: 'blob', sha: null });

const tree = await api(`/repos/${OWNER}/${REPO}/git/trees`, {
  method: 'POST',
  body: JSON.stringify({ base_tree: parent.tree.sha, tree: entries })
}).then(r => r.json());
if (!tree.sha) { console.error('建 tree 失败：' + JSON.stringify(tree)); process.exit(1); }

const msg = process.argv.includes('--message')
  ? process.argv[process.argv.indexOf('--message') + 1]
  : 'update: ' + files.join(', ');
const commit = await api(`/repos/${OWNER}/${REPO}/git/commits`, {
  method: 'POST',
  body: JSON.stringify({ message: msg, tree: tree.sha, parents: [parentSha] })
}).then(r => r.json());
if (!commit.sha) { console.error('建 commit 失败：' + JSON.stringify(commit)); process.exit(1); }

const upd = await api(`/repos/${OWNER}/${REPO}/git/refs/heads/${branch}`, {
  method: 'PATCH',
  body: JSON.stringify({ sha: commit.sha, force: false })
}).then(r => r.json());
if (!upd.object) { console.error('更新分支失败：' + JSON.stringify(upd)); process.exit(1); }

console.log('✓ 已推上去：' + commit.sha.slice(0, 8) + '  ' + msg);
