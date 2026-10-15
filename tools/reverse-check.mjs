/* 反向验证运行器 —— 证明 dom-smoke 里的关键断言"真的会红"。
 *
 * 跑法：node tools/reverse-check.mjs
 *
 * 做法：对 src/app.js 逐个做一处破坏 -> 跑 tools/dom-smoke.mjs -> 要求【指定名字的
 * 那条断言】出现在失败清单里 -> 立刻把原文写回去（不管成败都还原）。
 *
 * 为什么要这么麻烦：一条永远为真的断言（假守卫）比没有断言更糟 —— 它会让人以为
 * 有覆盖。写"要红的那条断言的名字"是刻意的：如果破坏的是 A 逻辑却红了 B 断言，
 * 说明 B 才是真正守住 A 的那条，名字对不上会直接报出来。
 *
 * 这个文件是临时工具，跑完可以删。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'src', 'app.js');
const CORE = path.join(ROOT, 'src', 'todo-core.js');
const ORIG = { app: fs.readFileSync(APP, 'utf8'), core: fs.readFileSync(CORE, 'utf8') };

const CASES = [
  {
    name: 'importance is ignored when saving a task',
    file: 'app',
    find: "      important: !!form.important,",
    replace: "      important: false,",
    expect: 'important was stored'
  },
  {
    name: 'the score forgets the deadline (everything scores 0)',
    file: 'core',
    find: "    return (999 - clampDays(left)) * 100 + (item.important ? 50 : 0);",
    replace: "    return 0;",
    expect: 'the undated one is last in the flat list'
  },
  {
    name: 'the task list is never written to localStorage',
    file: 'app',
    find: "      window.localStorage.setItem(LS_KEY, text);",
    replace: "      if (false) window.localStorage.setItem(LS_KEY, text);",
    expect: 'the change was written to localStorage'
  },
  {
    name: 'today stops being highlighted on the heatmap',
    file: 'core',
    find: "          level: hits.length ? (day.getTime() === ref.getTime() ? 2 : 1) : 0,",
    replace: "          level: hits.length ? 1 : 0,",
    expect: 'today is the highlighted level'
  },
  {
    /* 注意：不能简单地把 `if (!title)` 改成 `if (false)` —— 逻辑层的 requireTitle
       还会抛一次，app.js 的 try/catch 会接住并显示同样的人话，破坏就"看不见"了。
       所以这里改的是校验本身的【行为】：名字空的时候不去提示，而是抛一个 TypeError。
       它会被 try/catch 接住并显示"存不下来：…"，于是 "and it says why" 必然变红。 */
    name: 'an empty title is not actually checked',
    file: 'app',
    find: "      el.edErr.textContent = '先给这件事起个名字吧';",
    replace: "      throw new TypeError('the empty-title guard did not run');",
    expect: 'and it says why'
  },
  {
    name: 'the quadrant boundary forgets the urgency line',
    file: 'core',
    find: "    var lim = typeof urgentDays === 'number' ? urgentDays : D.URGENT_DAYS;",
    replace: "    var lim = 0;",
    expect: 'with a 7-day line it jumps to Q1'
  },
  {
    name: 'a repeat task is allowed to sit in the quadrant list',
    file: 'core',
    find: "    return doc.items.filter(function (it) { return isRepeat(it); });",
    replace: "    return [];",
    expect: 'two habits are listed'
  },
  {
    /* 今天这一屏是默认视图，它一旦不画，用户第一眼看到的就是空白。
       这里期望的是那串"点不到节点"的报错而不是某条断言名 —— 因为不画这一屏之后，
       后面的点击根本走不下去，测试是在半路炸掉的。它同样是"真的红了"。 */
    name: 'the today screen actually gets rendered',
    file: 'app',
    find: "    renderToday(now);",
    replace: "    /* renderToday(now); */",
    expect: 'cannot click missing node: #today [data-tk="1"] [data-check]'
  },
  {
    /* 勾掉时不道喜，庆祝功能就是白做的 —— 这条守着"爽感"那件事 */
    name: 'checking something off throws confetti',
    file: 'app',
    find: "    if (changed && checked) celebrateCheck(id);",
    replace: "    if (false && changed && checked) celebrateCheck(id);",
    expect: 'checking pops exactly one praise bubble'
  },
  {
    /* 用户自己写的鼓励话必须优先，否则那个文本框就是个摆设 */
    name: 'the user\'s own encouraging words are used',
    file: 'core',
    find: "    if (mine.length) return mine;",
    replace: "    if (false && mine.length) return mine;",
    expect: 'and it uses the custom line'
  }
];

function run() {
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'dom-smoke.mjs')], {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024
    });
    return { code: 0, out: '' };
  } catch (e) {
    return { code: e.status === undefined ? 1 : e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

let bad = 0;

/* ------------------------------------------------------------------ 开工前的体检
 *
 * 上一版这个脚本有个难查的毛病：它把"这次启动时读到的源码"当成原始版本，一旦有
 * 一次运行被 Ctrl+C 杀掉（来不及还原），磁盘上留下的是【被破坏过】的源码，下一次
 * 运行就会把"坏的"当成"好的"备份起来，破坏被永久固化 —— 我实际踩到了：
 * src/todo-core.js 的 isUrgent 里 `var lim = 0;` 就这么留在了文件里，
 * 而工具一直报得挺正常。
 *
 * 两道防线：
 *   1) 开工前先确认源码里有几个"一定在"的标记（说明没被改坏），不对就拒绝运行；
 *   2) 把关卡过的源码另存一份快照，之后每次还原都从快照来，不信任磁盘现状。
 */
const MUST_HAVE = {
  app: ["if (!title) {", "function saveForm()", "function bkRestore(mode)"],
  core: ["var lim = typeof urgentDays === 'number' ? urgentDays : D.URGENT_DAYS;", "function scoreOf(item, now)", "function normalize(raw)"]
};

for (const k of ['app', 'core']) {
  const missing = MUST_HAVE[k].filter((s) => ORIG[k].indexOf(s) < 0);
  if (missing.length) {
    console.log('REFUSING TO RUN - src/' + (k === 'app' ? 'app.js' : 'todo-core.js') + ' looks modified already.');
    console.log('  missing marker(s): ' + missing.join(' | '));
    console.log('  Put the original source back first (or check git diff), then run this again.');
    process.exit(2);
  }
}

const BACKUP = path.join(ROOT, '.reverse-backup');
fs.mkdirSync(BACKUP, { recursive: true });
for (const [k, file] of [['app', APP], ['core', CORE]]) {
  const snap = path.join(BACKUP, path.basename(file));
  const knownGood = fs.existsSync(snap) &&
    MUST_HAVE[k].every((s) => fs.readFileSync(snap, 'utf8').indexOf(s) >= 0);
  /* 只在【现在这份是干净的】或者【快照是干净的】时决定用哪一份。
     两边都不干净 = 之前被中途杀过、磁盘上已经是坏源码，这时直接罢工，
     免得继续把破坏复制下去（这是我实际踩过的坑）。 */
  if (ORIG[k].indexOf(MUST_HAVE[k][0]) >= 0) {
    fs.writeFileSync(snap, ORIG[k], 'utf8');
  } else if (knownGood) {
    fs.writeFileSync(file, fs.readFileSync(snap, 'utf8'), 'utf8');
  } else {
    console.log('REFUSING TO RUN - src/' + (k === 'app' ? 'app.js' : 'todo-core.js') +
      ' is damaged and I have no clean snapshot.');
    process.exit(2);
  }
}

function restoreAll() {
  for (const [k, file] of [['app', APP], ['core', CORE]]) {
    const snap = path.join(BACKUP, path.basename(file));
    if (fs.existsSync(snap)) fs.writeFileSync(file, fs.readFileSync(snap, 'utf8'), 'utf8');
  }
}

for (const c of CASES) {
  const target = c.file === 'app' ? APP : CORE;
  const src = ORIG[c.file];
  if (src.indexOf(c.find) < 0) {
    console.log('SKIP  ' + c.name + '  (pattern not found any more)');
    bad++;
    continue;
  }
  fs.writeFileSync(target, src.replace(c.find, c.replace), 'utf8');
  let result;
  try {
    result = run();
  } finally {
    restoreAll();
  }
  const hit = result.code !== 0 && result.out.indexOf(c.expect) >= 0;
  console.log((hit ? 'RED   ' : 'MISS  ') + c.name + '  -> expected "' + c.expect + '"');
  if (!hit) {
    bad++;
    const lines = result.out.split('\n').filter((l) => l.trim().startsWith('x ')).slice(0, 6);
    console.log('        test exited ' + result.code + '; failing assertions: ' + (lines.length ? lines.join(' | ') : '(none)'));
  }
}

console.log('\n--------------------------------------------------');
restoreAll();
process.exit(bad ? 1 : 0);
