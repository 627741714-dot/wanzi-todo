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

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const gh = 'C:\\Program Files\\GitHub CLI\\gh.exe';
  return execFileSync(gh, ['auth', 'token'], { encoding: 'utf8' }).trim();
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
/* 有上游就比较，没有就把所有已跟踪文件都当改动 */
let changed;
try {
  const upstream = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}');
  changed = git('diff', '--name-only', upstream + '..HEAD').split('\n').filter(Boolean);
} catch {
  changed = git('ls-files').split('\n').filter(Boolean);
}
/* 工作区里还没提交的改动也算 */
const dirty = git('status', '--porcelain').split('\n').filter(Boolean).map(l => l.slice(3).trim());
const files = [...new Set([...changed, ...dirty])].filter(f => f && fs.existsSync(path.join(ROOT, f)));

if (!files.length) { console.log('没有要推的文件。'); process.exit(0); }
console.log('分支 ' + branch + '，要推 ' + files.length + ' 个文件：');
for (const f of files) console.log('  ' + f);
if (DRY) process.exit(0);

const T = token();
const api = (p, opts) => fetch('https://api.github.com' + p, {
  ...opts,
  headers: {
    authorization: 'Bearer ' + T,
    accept: 'application/vnd.github+json',
    'user-agent': 'wanzi-push-via-api',
    ...(opts && opts.headers)
  }
});

/* 先拿一次当前 HEAD 的 tree sha 作为父提交 */
const ref = await api(`/repos/${OWNER}/${REPO}/git/ref/heads/${branch}`).then(r => r.json());
if (!ref.object) { console.error('拿不到分支 ref：' + JSON.stringify(ref)); process.exit(1); }
const parentSha = ref.object.sha;
const parent = await api(`/repos/${OWNER}/${REPO}/git/commits/${parentSha}`).then(r => r.json());
console.log('父提交 ' + parentSha.slice(0, 8));

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
