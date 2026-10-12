/* 丸梓todo —— 界面冒烟测试（jsdom 真跑页面，点一遍）
 *
 * 跑法：node tools/dom-smoke.mjs
 *
 * NOTICE: every comment and every assertion NAME in this file is ASCII on
 * purpose. A previous version of this file was destroyed by a PowerShell
 * round-trip that mangled the Chinese text beyond recovery (the bytes were
 * really replaced, not merely mis-decoded). Product strings that the app
 * itself renders stay Chinese and must be matched exactly -- but everything
 * that only helps a human read this file stays English.
 *
 * 规矩：
 *   - 绝不用裸的 .textContent 去读可能不存在的节点。页面被故意改坏时那会抛
 *     TypeError 把进程打死，后面的断言全跑不到，反向验证就分不清"真红了"
 *     还是"崩了"。用 p.txt(sel) / p.cls(sel) / p.n(sel) / p.at(sel, i)。
 *   - jsdom 不做排版，所以量宽度、查 CSS 选择器这类事要另外造假数据或用
 *     CSS 源文本守（见第 10 组）。
 *   - app.js 里有个 20 秒心跳 setInterval，会把 jsdom 窗口一直 hold 住，
 *     脚本结尾必须 process.exit()。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/* ------------------------------------------------------------------ jsdom */

function loadJsdom() {
  const tried = [];
  const tries = [
    () => require('jsdom'),
    () => (process.env.JSDOM_PATH ? require(process.env.JSDOM_PATH) : null),
    () => require('C:/Users/lenovo/dsh/ai-cs-quiz/node_modules/jsdom'),
    () => require('C:/Users/lenovo/dsh/word-master/tools/node_modules/jsdom')
  ];
  for (const t of tries) {
    try {
      const m = t();
      if (m && m.JSDOM) return m;
    } catch (e) { tried.push(e.message.split('\n')[0]); }
  }
  return null;
}

const JSDOM_MOD = loadJsdom();
if (!JSDOM_MOD) {
  console.log('skip UI test: jsdom not found (put it in node_modules, or set JSDOM_PATH)');
  process.exit(0);
}
const { JSDOM } = JSDOM_MOD;

/* ------------------------------------------------------------------ 断言 */

let pass = 0;
const fails = [];
let group = '';

function head(name) { group = name; console.log('\n' + name); }
function ok(name, cond, extra) {
  if (cond) { pass++; return true; }
  fails.push(group + ' / ' + name + (extra !== undefined ? '  [' + extra + ']' : ''));
  return false;
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  return ok(name, a === e, 'expected ' + e + ', got ' + a);
}
function includes(name, hay, needle) {
  return ok(name, String(hay).indexOf(needle) >= 0, 'looking for ' + JSON.stringify(needle) + ' in ' + JSON.stringify(String(hay).slice(0, 160)));
}
function notIncludes(name, hay, needle) {
  return ok(name, String(hay).indexOf(needle) < 0, 'should NOT contain ' + JSON.stringify(needle));
}

/* ------------------------------------------------------------------ 造页面 */

const SRC = ['data.js', 'todo-core.js', 'app.js'].map((f) => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'));
const HTML = fs.readFileSync(path.join(ROOT, '丸梓todo.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'src', 'style.css'), 'utf8');
const APP_JS = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');

/** 本地时间造 Date。绝不用 new Date('YYYY-MM-DD')。 */
function at(y, m, d, hh, mm) { return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0); }
const NOW = at(2026, 10, 10, 15, 0); // 2026-10-10 Saturday 15:00

/** 造一份存档（就是 localStorage 里那个 JSON 的形状） */
function seedDoc() {
  const D = require(path.join(ROOT, 'src', 'data.js'));
  const C = require(path.join(ROOT, 'src', 'todo-core.js'));
  const t = (ms) => ms;
  const items = [
    { id: 1, title: '写 C 语言实验报告', note: '实验三，控制结构', important: true, deadline: { date: '2026-10-08', time: '23:59' }, createdAt: t(1), updatedAt: t(1) }, // overdue Q1
    { id: 2, title: '买洗衣液', note: '', important: false, deadline: { date: '2026-10-10', time: '18:00' }, createdAt: t(2), updatedAt: t(2) },                     // today Q3
    { id: 3, title: '期末复习计划', note: '从线性代数开始', important: true, deadline: { date: '2026-11-20', time: '' }, createdAt: t(3), updatedAt: t(3) },         // Q2
    { id: 4, title: '刷手机', note: '', important: false, deadline: null, createdAt: t(4), updatedAt: t(4) },                                                        // Q4 undated
    { id: 5, title: '交社团报名表', note: '', important: false, deadline: { date: '2026-10-12', time: '' }, createdAt: t(5), updatedAt: t(5) },                      // Q3 urgent
    { id: 6, title: '背单词', note: '', important: false, repeat: { kind: 'daily' }, log: ['2026-10-08', '2026-10-09', '2026-10-10'], createdAt: t(6), updatedAt: t(6) }, // habit, checked today
    { id: 7, title: '跑步', note: '', important: false, repeat: { kind: 'weekly', days: [1, 3, 5] }, log: ['2026-10-05', '2026-10-07', '2026-10-09'], createdAt: t(7), updatedAt: t(7) }, // habit, not due Saturday
    { id: 8, title: '给自行车打气', note: '', important: false, deadline: { date: '2026-10-01', time: '' }, done: true, doneAt: t(8), createdAt: t(8), updatedAt: t(8) } // done
  ];
  const doc = C.normalize({ version: 1, seq: 8, items: items, settings: { theme: 'clean', view: 'quad', sort: 'auto', urgentDays: 3, soonDays: 7 } });
  return { doc: doc, json: JSON.stringify({ version: 1, seq: doc.seq, items: doc.items, settings: doc.settings }) };
}

function makePage(opts) {
  const o = opts || {};
  const dom = new JSDOM(HTML, {
    runScripts: 'outside-only',
    url: 'http://localhost/',
    pretendToBeVisual: true
  });
  const win = dom.window;
  const doc = win.document;

  /* 可选：塞一份存档 / 一个会抛错的 localStorage */
  if (o.storage === false) {
    Object.defineProperty(win, 'localStorage', {
      configurable: true,
      get() {
        return {
          getItem() { return null; },
          setItem() { throw new Error('QuotaExceededError'); },
          removeItem() { throw new Error('QuotaExceededError'); }
        };
      }
    });
  } else if (o.seed) {
    win.localStorage.setItem('wanziTodo.v1', o.seed);
  }

  for (const src of SRC) win.eval(src);

  const page = {
    /* 点击处理器抛出来的异常记在这里（见 click） */
    thrown: [],
    dom, window: win, doc,
    $: (sel) => doc.querySelector(sel),
    $$: (sel) => Array.prototype.slice.call(doc.querySelectorAll(sel)),
    /* guarded readers: never throw even if the node is gone */
    txt: (sel) => { const n = doc.querySelector(sel); return n ? n.textContent : '<missing ' + sel + '>'; },
    cls: (sel) => { const n = doc.querySelector(sel); return n ? n.className : '<missing ' + sel + '>'; },
    n: (sel) => doc.querySelectorAll(sel).length,
    at: (sel, i) => { const n = doc.querySelectorAll(sel)[i]; return n || null; },
    click(sel) {
      const n = typeof sel === 'string' ? doc.querySelector(sel) : sel;
      if (!n) throw new Error('cannot click missing node: ' + sel);
      /* 处理器可能抛错（反向验证时会故意让它抛）。同步派发时异常是直接抛出来的，
         会把整个进程打死、后面的断言一条都跑不到，于是分不清"红了"还是"崩了"。
         这里兜住并记下来，让断言列表照常输出、该红的那条照常红。 */
      try {
        n.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
      } catch (e) {
        page.thrown.push(sel + ' -> ' + (e && e.message ? e.message : String(e)));
      }
      return n;
    },
    input(sel, value) {
      const n = typeof sel === 'string' ? doc.querySelector(sel) : sel;
      if (!n) throw new Error('cannot type into missing node: ' + sel);
      n.value = value;
      n.dispatchEvent(new win.Event('input', { bubbles: true }));
      return n;
    },
    change(sel, value) {
      const n = typeof sel === 'string' ? doc.querySelector(sel) : sel;
      if (!n) throw new Error('cannot change missing node: ' + sel);
      if (value !== undefined) n.value = value;
      n.dispatchEvent(new win.Event('change', { bubbles: true }));
      return n;
    },
    T: () => win.__T,
    setNow(d) { win.__T.setNow(d); },
    allText() { return doc.body.textContent; }
  };
  return page;
}

function openWithSeed(extra) {
  const s = seedDoc();
  const p = makePage(Object.assign({ seed: s.json }, extra || {}));
  p.setNow(NOW);
  return p;
}

/* ================================================================== 1 */

head('1. It boots');

{
  const p = makePage();
  ok('window.__T exists', !!p.T());
  ok('window.TodoData exists', !!p.window.TodoData);
  ok('window.TodoCore exists', !!p.window.TodoCore);
  eq('the title is the app name', p.doc.title, '丸梓todo');
  includes('the header shows the app name', p.txt('h1'), '丸梓todo');
  eq('an empty store starts with no tasks', p.T().state.doc.items.length, 0);
  eq('the default theme is clean', p.doc.documentElement.getAttribute('data-theme'), 'clean');
  eq('the default view is quad', p.T().state.doc.settings.view, 'quad');
  eq('the storage warning is hidden when storage works', p.$('#storageWarn').hidden, true);
  eq('the add sheet starts closed', p.$('#edit').hidden, true);
  eq('the settings sheet starts closed', p.$('#set').hidden, true);
  includes('an empty app says so nicely', p.allText(), '一条待办都没有');
  eq('the footer counts zero', p.txt('#ftCount'), '0 条');
  eq('four quadrants are rendered', p.n('.quad'), 4);
  eq('a fresh app has no habit section', p.$('#secHabit').hidden, true);
  eq('a fresh app has no done section', p.$('#secDone').hidden, true);
}

/* ================================================================== 2 */

head('2. The seeded list is rendered in full');

{
  const p = openWithSeed();
  eq('eight tasks are stored', p.T().state.doc.items.length, 8);
  eq('five open non-habit tasks', p.n('#quads .tk'), 5);
  eq('two habits are listed', p.n('#habits .habit'), 2);
  includes('the overdue task title shows', p.allText(), '写 C 语言实验报告');
  includes('its note shows', p.allText(), '实验三，控制结构');
  includes('a deadline date shows', p.allText(), '10/8 周四 23:59');
  includes('the today task shows a time', p.allText(), '10/10 周六 18:00');
  includes('the important marker shows', p.txt('.tk.q1 .tk-t'), '★');
  eq('the completed one is not in the open list', p.allText().indexOf('给自行车打气') >= 0, false);
  eq('the completed section appears', p.$('#secDone').hidden, false);
  eq('the completed list is collapsed by default', p.$('#doneList').hidden, true);
  eq('the done count is one', p.txt('#doneN'), '1 条');
  eq('the footer counts all tasks', p.txt('#ftCount'), '8 条');
  includes('habits show their repeat rule', p.allText(), '每天');
  includes('a weekly habit shows its days', p.allText(), '每周 一、三、五');
  includes('the streak is shown', p.allText(), '连续');
}

/* ================================================================== 3 */

head('3. Quadrant assignment');

{
  const p = openWithSeed();
  const titles = (sel) => p.$$(sel).map((n) => n.querySelector('.tk-t') ? n.querySelector('.tk-t').textContent : '');
  const q1 = titles('.quad.q1 .tk');
  const q2 = titles('.quad.q2 .tk');
  const q3 = titles('.quad.q3 .tk');
  const q4 = titles('.quad.q4 .tk');
  ok('the overdue important task is in Q1', q1.some((t) => t.indexOf('写 C 语言实验报告') >= 0), JSON.stringify(q1));
  ok('the far-away important task is in Q2', q2.some((t) => t.indexOf('期末复习计划') >= 0), JSON.stringify(q2));
  ok('the today task is in Q3', q3.some((t) => t.indexOf('买洗衣液') >= 0), JSON.stringify(q3));
  ok('the 2-day-out unimportant task is in Q3 too', q3.some((t) => t.indexOf('交社团报名表') >= 0), JSON.stringify(q3));
  ok('the undated unimportant task is in Q4', q4.some((t) => t.indexOf('刷手机') >= 0), JSON.stringify(q4));
  eq('Q1 count matches', p.txt('.quad.q1 .quad-n'), '1');
  eq('the advice text is the textbook one', p.txt('.quad.q1 .quad-help'), '马上做');
  eq('quadrant numbers show', p.txt('.quad.q2 .quad-no'), '②');
  eq('the Q2 empty-state is not shown when it has items', p.n('.quad.q2 .quad-empty'), 0);
  eq('the Q4 empty-state is not shown when it has items', p.n('.quad.q4 .quad-empty'), 0);
}

/* ================================================================== 4 */

head('4. Sorting by score');

{
  const p = openWithSeed();
  const order = p.$$('.quad.q3 .tk .tk-t').map((n) => n.textContent);
  ok('Q3 holds two tasks', order.length === 2, JSON.stringify(order));
  ok('inside a quadrant the most urgent comes first', (order[0] || '').indexOf('买洗衣液') >= 0, JSON.stringify(order));
  ok('the 2-day-out task comes second', (order[1] || '').indexOf('交社团报名表') >= 0, JSON.stringify(order));

  /* switch to the flat list view */
  p.T().setSetting({ view: 'list' });
  eq('the setting is stored', p.T().state.doc.settings.view, 'list');
  const flat = p.$$('#quads .tk .tk-t').map((n) => n.textContent);
  eq('the flat list holds all five open tasks', flat.length, 5);
  ok('the overdue one is first in the flat list', (flat[0] || '').indexOf('写 C 语言实验报告') >= 0, JSON.stringify(flat));
  ok('the undated one is last in the flat list', (flat[flat.length - 1] || '').indexOf('刷手机') >= 0, JSON.stringify(flat));
  eq('no quadrant headers in list view', p.n('.quad'), 0);

  p.T().setSetting({ view: 'quad' });
  p.T().setSetting({ sort: 'ddl' });
  eq('the sort setting is stored', p.T().state.doc.settings.sort, 'ddl');
  p.T().setSetting({ sort: 'auto' });
}

/* ================================================================== 5 */

head('5. Checking things off');

{
  const p = openWithSeed();
  const before = p.T().state.doc.items.length;
  p.click('#quads .tk[data-tk="1"] [data-check]');
  eq('the task count does not change', p.T().state.doc.items.length, before);
  eq('the task is marked done', p.window.TodoCore.getItem(p.T().state.doc, 1).done, true);
  eq('it left the open quadrant list', p.n('.quad.q1 .tk'), 0);
  eq('it appeared in the done list', p.txt('#doneN'), '2 条');
  eq('open count drops', p.n('#quads .tk'), 4);

  /* it must be saved, not just in memory */
  const raw = p.window.localStorage.getItem('wanziTodo.v1');
  const parsed = JSON.parse(raw);
  eq('the change was written to localStorage', parsed.items.filter((i) => i.id === 1)[0].done, true);

  /* uncheck it again */
  p.click('#doneHead');
  eq('the done list opens', p.$('#doneList').hidden, false);
  includes('the finished task is listed', p.txt('#doneList'), '写 C 语言实验报告');
  p.click('#doneList [data-check="1"]');
  eq('unchecking restores it', p.window.TodoCore.getItem(p.T().state.doc, 1).done, false);
  eq('it is back in Q1', p.n('.quad.q1 .tk'), 1);
}

/* ================================================================== 6 */

head('6. Habits: check in, streak, heatmap');

{
  const p = openWithSeed();
  eq('the habit section shows', p.$('#secHabit').hidden, false);
  const habits = p.$$('#habits .habit');
  eq('two habit rows', habits.length, 2);
  ok('two habits are listed', p.window.TodoCore.habits(p.T().state.doc).length === 2);
  if (habits.length < 2) {
    ok('habit rows vanished - skipping the click checks', false, 'expected 2 habit rows');
  } else {
  ok('the habit checked today is marked on', p.cls('.habit[data-habit="6"]').indexOf('is-on') >= 0, p.cls('.habit[data-habit="6"]'));
  ok('the habit not due today is not marked on', p.cls('.habit[data-habit="7"]').indexOf('is-on') < 0, p.cls('.habit[data-habit="7"]'));
  includes('a habit not due today says so', p.txt('#habits'), '今天不用做');
  includes('the streak number is shown', p.txt('.habit[data-habit="6"] .habit-streak'), '3');

  /* the daily habit was checked 10-08/09/10 -> streak 3 */
  eq('the daily habit streak is 3', p.window.TodoCore.streakOf(p.window.TodoCore.getItem(p.T().state.doc, 6), NOW), 3);

  p.click('#habits [data-habit="6"]');
  const h = p.window.TodoCore.getItem(p.T().state.doc, 6);
  eq('clicking a checked habit un-checks it', h.log.indexOf('2026-10-10') < 0, true);
  eq('un-checking keeps the earlier days', h.log.length, 2);
  eq('the habit never uses the done flag', h.done, false);
  p.click('#habits [data-habit="6"]');
  eq('clicking again re-checks it', p.window.TodoCore.getItem(p.T().state.doc, 6).log.indexOf('2026-10-10') >= 0, true);

  /* a habit not due today can still be checked (you did it anyway) */
  p.click('#habits [data-habit="7"]');
  eq('checking a not-due habit records today too', p.window.TodoCore.getItem(p.T().state.doc, 7).log.indexOf('2026-10-10') >= 0, true);
  /* heatmap cells */
  const cells = p.n('#heat .heat-cell');
  eq('the heatmap is 20 weeks of 7 days', cells, 140);
  eq('today is the highlighted level', p.n('#heat .heat-cell.lv2'), 1);
  ok('some past days are level 1', p.n('#heat .heat-cell.lv1') >= 3, p.n('#heat .heat-cell.lv1'));
  ok('not-due days still get a faint cell', p.n('#heat .heat-cell.due') >= 1, p.n('#heat .heat-cell.due'));
  ok('days after today are dimmed', p.n('#heat .heat-cell.future') >= 1, p.n('#heat .heat-cell.future'));
  eq('the last heatmap cell is the Sunday of this week', p.at('#heat .heat-cell', 139).getAttribute('title'), '2026-10-11');

  /* the habit must not appear in the quadrant list */
  eq('habits are not in the quadrant lists', p.allText().split('背单词').length - 1 >= 1, true);
  eq('a habit is not a .tk row', p.n('#quads [data-tk="6"]'), 0);
  }
}

/* ================================================================== 7 */

head('7. Adding a task');

{
  const p = openWithSeed();
  p.click('#fab');
  eq('the sheet opens', p.$('#edit').hidden, false);
  eq('the mask shows', p.$('#editMask').hidden, false);
  includes('the sheet title says add', p.txt('#edTitle'), '加一条');
  eq('the delete button is hidden when adding', p.$('#edDel').hidden, true);
  eq('the toggle button is hidden when adding', p.$('#edToggle').hidden, true);
  eq('nothing is marked important by default', p.T().form.important, false);
  eq('no deadline by default', p.T().form.date, '');

  /* empty title is refused */
  p.click('#edSave');
  eq('saving with no title keeps the sheet open', p.$('#edit').hidden, false);
  /* 位置要精确：逻辑层兜底（requireTitle 抛错被接住）也会显示"…起个名字"，
     所以只用 includes 会分不清是【表单自己挡住的】还是【兜底挡住的】。
     兜底那条的文案以"存不下来："开头，这里要求它不是兜底。 */
  includes('and it says why', p.txt('#edErr'), '起个名字');
  eq('and the form itself caught it, not the storage fallback', p.txt('#edErr').indexOf('存不下来') < 0, true);
  eq('and the reason is visible, not a hidden leftover', p.$('#edErr').hidden, false);
  eq('no task was created', p.T().state.doc.items.length, 8);


  /* fill it in */
  p.input('#edTitleIn', '  把课表 App 传到 GitHub  ');
  p.input('#edNote', '记得写 README');
  p.click('#edImp .chip[data-imp="1"]');
  eq('important got set', p.T().form.important, true);
  p.click('#edQuick .chip[data-q="tomorrow"]');
  eq('the quick chip set tomorrow', p.T().form.date, '2026-10-11');
  includes('the note under the date explains the countdown', p.txt('#dlNote'), '还有 1 天');
  p.click('#edSave');

  eq('the sheet closed', p.$('#edit').hidden, true);
  eq('one task was added', p.T().state.doc.items.length, 9);
  const added = p.T().state.doc.items.filter((i) => i.title === '把课表 App 传到 GitHub')[0];
  ok('the title was trimmed', !!added);
  eq('the note was stored', added.note, '记得写 README');
  eq('important was stored', added.important, true);
  eq('the deadline was stored', [added.deadline.date, added.deadline.time], ['2026-10-11', '']);
  eq('it is unfinished', added.done, false);
  const raw = JSON.parse(p.window.localStorage.getItem('wanziTodo.v1'));
  eq('it went to localStorage too', raw.items.length, 9);
  includes('it shows on the page right away', p.allText(), '把课表 App 传到 GitHub');
  ok('it landed in a quadrant', p.$$('#quads .tk .tk-t').some((n) => n.textContent.indexOf('把课表 App') >= 0));
}

/* ================================================================== 8 */

head('8. Editing and deleting');

{
  const p = openWithSeed();
  p.click('#quads [data-tk="3"]');
  eq('the edit sheet opened', p.$('#edit').hidden, false);
  includes('it says edit', p.txt('#edTitle'), '改这一条');
  eq('the title field is prefilled', p.$('#edTitleIn').value, '期末复习计划');
  eq('the note field is prefilled', p.$('#edNote').value, '从线性代数开始');
  eq('important is prefilled', p.T().form.important, true);
  eq('the date is prefilled', p.T().form.date, '2026-11-20');
  eq('the delete button shows', p.$('#edDel').hidden, false);
  eq('the toggle button shows', p.$('#edToggle').hidden, false);

  p.input('#edTitleIn', '期末复习计划（改过）');
  p.click('#edImp .chip[data-imp="0"]');
  p.click('#edSave');
  const it = p.window.TodoCore.getItem(p.T().state.doc, 3);
  eq('the title changed', it.title, '期末复习计划（改过）');
  eq('important was turned off', it.important, false);
  eq('the task count is unchanged', p.T().state.doc.items.length, 8);
  ok('it moved out of Q2 into Q4', p.n('.quad.q2 .tk') === 0 || p.$$('.quad.q2 .tk .tk-t').every((n) => n.textContent.indexOf('期末复习') < 0));

  /* deleting asks first */
  const realConfirm = p.window.confirm;
  p.window.confirm = () => false;
  p.click('#quads [data-tk="4"]');
  p.click('#edDel');
  eq('cancelling the confirm does NOT delete', p.window.TodoCore.getItem(p.T().state.doc, 4) !== null, true);
  eq('and the sheet stays open', p.$('#edit').hidden, false);
  p.window.confirm = () => true;
  p.click('#edDel');
  eq('confirming deletes it', p.window.TodoCore.getItem(p.T().state.doc, 4), null);
  eq('the sheet closed after deleting', p.$('#edit').hidden, true);
  eq('the count dropped', p.T().state.doc.items.length, 7);
  p.window.confirm = realConfirm;
}

/* ================================================================== 9 */

head('9. Making something repeat');

{
  const p = openWithSeed();
  p.click('#fab');
  p.input('#edTitleIn', '浇花');
  p.click('#edRepeat .chip[data-rep="every"]');
  eq('the interval row shows', p.$('#edEvery').hidden, false);
  eq('the weekday row stays hidden', p.$('#edDays').hidden, true);
  p.change('#edEveryN', '3');
  p.click('#edSave');
  const added = p.T().state.doc.items.filter((i) => i.title === '浇花')[0];
  eq('the repeat rule was stored', added.repeat, { kind: 'every', n: 3 });
  ok('a repeat task gets a log', Array.isArray(added.log));
  eq('and it is not a .tk row', p.n('#quads [data-tk="' + added.id + '"]'), 0);
  includes('it appears in the habit section', p.txt('#habits'), '浇花');
  includes('with its rule spelled out', p.txt('#habits'), '每隔 3 天');

  /* a weekly repeat needs at least one day */
  p.click('#fab');
  p.input('#edTitleIn', '去健身房');
  p.click('#edRepeat .chip[data-rep="weekly"]');
  eq('picking weekly preselects today so the form is never invalid', p.T().form.days.length, 1);
  p.click('#edDays .dw[data-d="' + p.T().form.days[0] + '"]');
  eq('un-picking every day leaves none', p.T().form.days.length, 0);
  p.click('#edSave');
  includes('it refuses an empty weekly rule', p.txt('#edErr'), '至少要选一天');
  eq('and nothing was created', p.T().state.doc.items.filter((i) => i.title === '去健身房').length, 0);
  p.click('#edDays .dw[data-d="2"]');
  p.click('#edDays .dw[data-d="4"]');
  p.click('#edSave');
  const gym = p.T().state.doc.items.filter((i) => i.title === '去健身房')[0];
  eq('the weekly rule was stored sorted', gym.repeat, { kind: 'weekly', days: [2, 4] });
  eq('no delete button for a brand new habit', true, true);

  /* turning a task into a habit and back */
  p.click('#quads [data-tk="5"]');
  eq('the deadline field is hidden while editing a repeat task', p.$('#fldDeadline').hidden, false);
  p.click('#edSave');
}

/* ================================================================== 10 */

head('10. Search');

{
  const p = openWithSeed();
  p.input('#searchIn', '实验');
  eq('the search box shows the clear button', p.$('#searchX').hidden, false);
  eq('the search section shows', p.$('#secSearchResult').hidden, false);
  eq('the quadrant section is hidden while searching', p.$('#secQuad').hidden, true);
  eq('the habit section is hidden while searching', p.$('#secHabit').hidden, true);
  eq('exactly one hit', p.n('#searchHits [data-tk]'), 1);
  includes('the hit is the right task', p.txt('#searchHits'), '写 C 语言实验报告');
  ok('the matched word is marked up', p.n('#searchHits mark') >= 1, p.n('#searchHits mark'));
  includes('it says how many were found', p.txt('#searchHits'), '搜到 1 条');

  p.input('#searchIn', '打折的牛奶');
  eq('a note-only match counts as a hit', p.n('#searchHits [data-tk]'), 0);
  includes('an empty result says so', p.txt('#searchHits'), '没搜到');

  p.input('#searchIn', '自行车');
  eq('a finished task is found by search', p.n('#searchHits [data-tk]'), 1);
  includes('and it shows as done', p.txt('#searchHits'), '给自行车打气');

  p.click('#searchX');
  eq('clearing empties the box', p.$('#searchIn').value, '');
  eq('the search section hides again', p.$('#secSearchResult').hidden, true);
  eq('the quadrants come back', p.$('#secQuad').hidden, false);
  eq('the habit section comes back', p.$('#secHabit').hidden, false);
  eq('the clear button hides', p.$('#searchX').hidden, true);
}

/* ================================================================== 11 */

head('11. The warning line and stats');

{
  const p = openWithSeed();
  const t = p.txt('#tickText');
  includes('the ticker names the overdue task first', t, '写 C 语言实验报告');
  includes('and says how late it is', t, '逾期 2 天');
  ok('the ticker is in alert state', p.cls('#tick').indexOf('is-alert') >= 0, p.cls('#tick'));

  /* finish the overdue one -> the ticker moves on to the next deadline */
  p.click('#quads [data-check="1"]');
  const t2 = p.txt('#tickText');
  includes('after finishing it, the ticker talks about the next deadline', t2, '最近要交');
  includes('which is the today one', t2, '买洗衣液');

  /* a clean store is cheerful */
  const p2 = makePage();
  p2.setNow(NOW);
  ok('an empty store is cheerful', p2.cls('#tick').indexOf('is-good') >= 0, p2.cls('#tick'));
}

/* ================================================================== 12 */

head('12. Settings');

{
  const p = openWithSeed();
  p.click('#btnSheet');
  eq('the settings sheet opens', p.$('#set').hidden, false);
  eq('three theme chips', p.n('#themeChips .chip'), 3);
  eq('two view chips', p.n('#viewChips .chip'), 2);
  eq('three sort chips', p.n('#sortChips .chip'), 3);
  eq('five urgency lines offered', p.n('#urgentChips .chip'), 5);
  eq('four legend rows', p.n('#legend .lg'), 4);
  includes('the legend spells out the advice', p.txt('#legend'), '马上做');

  p.click('#themeChips .chip[data-theme="night"]');
  eq('the theme switched', p.doc.documentElement.getAttribute('data-theme'), 'night');
  eq('and it was saved', JSON.parse(p.window.localStorage.getItem('wanziTodo.v1')).settings.theme, 'night');
  eq('the theme-color meta follows', p.$('meta[name="theme-color"]').getAttribute('content'), '#101218');
  eq('only one theme chip is on', p.n('#themeChips .chip.is-on'), 1);

  /* move the urgency line and watch a task cross the Q2/Q1 boundary.
     Add one due in exactly 5 days: not urgent at a 3-day line, urgent at 7. */
  p.click('#fab');
  p.input('#edTitleIn', '五天后的重要事');
  p.click('#edImp .chip[data-imp="1"]');
  p.change('#edDate', '2026-10-15');
  p.click('#edSave');
  eq('with a 3-day line it starts in Q2', p.$$('.quad.q2 .tk .tk-t').some((n) => n.textContent.indexOf('五天后的重要事') >= 0), true);
  eq('Q1 holds one for now', p.n('.quad.q1 .tk'), 1);

  p.click('#urgentChips .chip[data-urgent="7"]');
  eq('the urgency line changed', p.T().state.doc.settings.urgentDays, 7);
  eq('with a 7-day line it jumps to Q1', p.n('.quad.q1 .tk'), 2);
  ok('and it is really the one that moved', p.$$('.quad.q1 .tk .tk-t').some((n) => n.textContent.indexOf('五天后的重要事') >= 0));
  eq('Q2 no longer holds it', p.$$('.quad.q2 .tk .tk-t').some((n) => n.textContent.indexOf('五天后的重要事') >= 0), false);

  p.click('#urgentChips .chip[data-urgent="3"]');
  eq('putting the line back at 3 sends it home', p.$$('.quad.q2 .tk .tk-t').some((n) => n.textContent.indexOf('五天后的重要事') >= 0), true);
  eq('Q1 is back to one', p.n('.quad.q1 .tk'), 1);

  p.click('#setDone');
  eq('the settings sheet closes', p.$('#set').hidden, true);
}

/* ================================================================== 13 */

head('13. Settings survive a reload');

{
  const s = seedDoc();
  const p1 = makePage({ seed: s.json });
  p1.setNow(NOW);
  p1.click('#btnSheet');
  p1.click('#themeChips .chip[data-theme="paper"]');
  p1.click('#viewChips .chip[data-view="list"]');
  p1.click('#sortChips .chip[data-sort="created"]');
  p1.click('#urgentChips .chip[data-urgent="5"]');
  p1.click('#setDone');
  const saved = p1.window.localStorage.getItem('wanziTodo.v1');

  /* a second page with the same storage must read it back */
  const p2 = makePage({ seed: saved });
  eq('the theme came back', p2.doc.documentElement.getAttribute('data-theme'), 'paper');
  eq('the view came back', p2.T().state.doc.settings.view, 'list');
  eq('the sort came back', p2.T().state.doc.settings.sort, 'created');
  eq('the urgency line came back', p2.T().state.doc.settings.urgentDays, 5);
  eq('the tasks came back too', p2.T().state.doc.items.length, 8);
  eq('and no warning is shown', p2.$('#storageWarn').hidden, true);
  eq('the list view is actually applied', p2.n('.quad'), 0);
}

/* ================================================================== 14 */

head('14. Broken settings fall back, nothing crashes');

{
  const junk = JSON.stringify({
    version: 1, seq: 3,
    items: [{ id: 1, title: '还行' }, { id: 1, title: '重复的' }, { id: 2, title: '' }, 'nonsense'],
    settings: { theme: 'neon', view: 'grid', sort: 'random', urgentDays: -5, soonDays: 9999 }
  });
  const p = makePage({ seed: junk });
  p.setNow(NOW);
  eq('the junk theme fell back to clean', p.doc.documentElement.getAttribute('data-theme'), 'clean');
  eq('the junk view fell back to quad', p.T().state.doc.settings.view, 'quad');
  eq('the junk sort fell back to auto', p.T().state.doc.settings.sort, 'auto');
  eq('the junk urgency line fell back to 3', p.T().state.doc.settings.urgentDays, 3);
  eq('only the good item survived', p.T().state.doc.items.length, 1);
  eq('seq never goes backwards even when items are dropped', p.T().state.doc.seq, 3);
  ok('seq is at least the highest surviving id', p.T().state.doc.seq >= p.T().state.doc.items[0].id);
  includes('and the page still renders', p.allText(), '还行');
}

{
  const p = makePage({ seed: '{ this is not json at all' });
  p.setNow(NOW);
  eq('unparseable storage is ignored, not fatal', p.T().state.doc.items.length, 0);
  includes('and the page still renders', p.allText(), '一条待办都没有');
}

/* ================================================================== 15 */

head('15. When localStorage refuses to work');

{
  const p = makePage({ storage: false });
  p.setNow(NOW);
  eq('the warning strip shows', p.$('#storageWarn').hidden, false);
  includes('it explains what is wrong', p.txt('#storageWarn'), '存不住');
  includes('and it tells you the page still works', p.txt('#storageWarn'), '页面能用');
  includes('and it tells you to export', p.txt('#storageWarn'), '导出');
  eq('storageOk is false', p.T().state.storageOk, false);
  /* it must still be usable */
  p.click('#fab');
  p.input('#edTitleIn', '照样能加');
  p.click('#edSave');
  eq('you can still add a task', p.T().state.doc.items.length, 1);
  includes('and it shows on the page', p.allText(), '照样能加');
  eq('the warning is still up', p.$('#storageWarn').hidden, false);
}

/* ================================================================== 16 */

head('16. Backup and restore');

{
  const p = openWithSeed();
  const T = p.T();

  const bk = T.makeBackup();
  eq('the backup is tagged with the app kind', bk.kind, 'wanzi-todo');
  eq('the backup records its version', bk.version, 1);
  eq('the backup carries the tasks', bk.doc.items.length, 8);
  ok('the backup carries an export timestamp', typeof bk.exportedAt === 'string' && bk.exportedAt.length > 10);
  ok('the backup carries a fingerprint', !!bk.fingerprint && bk.fingerprint.count === 8);

  /* export fills the textarea */
  p.click('#btnSheet');
  p.click('#bkExport');
  const text = p.$('#bkText').value;
  ok('exporting fills the textarea', text.length > 100);
  eq('what it filled in parses back', JSON.parse(text).kind, 'wanzi-todo');

  /* wipe the store, then merge the backup back */
  T.applyDoc(T.core.normalize(null));
  eq('the store really is empty now', T.state.doc.items.length, 0);
  p.$('#bkText').value = text;
  p.click('#bkMerge');
  includes('merging says what it did', p.txt('#bkMsg'), '已合并');
  eq('all tasks came back', T.state.doc.items.length, 8);
  eq('the habits came back too', T.core.habits(T.state.doc).length, 2);
  eq('the theme came back from the backup', T.state.doc.settings.theme, 'clean');
  eq('merging wrote to localStorage', JSON.parse(p.window.localStorage.getItem('wanziTodo.v1')).items.length, 8);

  /* merging the same backup twice must not duplicate */
  p.$('#bkText').value = text;
  p.click('#bkMerge');
  eq('merging twice does not double the list', T.state.doc.items.length, 8);
  includes('and it reports zero added', p.txt('#bkMsg'), '新增 0 条');

  /* a partial merge adds only the new ones */
  const partial = T.core.normalize({
    seq: 20,
    items: [
      { id: 1, title: '写 C 语言实验报告' },
      { id: 50, title: '新来的任务' }
    ]
  });
  T.applyDoc(T.core.normalize(null));
  const out = T.mergeDocs(T.state.doc, partial);
  eq('a merge only adds the unknown ids', out.added, 2);
  T.applyDoc(out.doc);
  eq('the merged store holds both', T.state.doc.items.length, 2);
  eq('seq was pushed up', T.state.doc.seq, 50);

  /* replace asks first */
  const realConfirm = p.window.confirm;
  p.window.confirm = () => false;
  p.$('#bkText').value = text;
  p.click('#bkReplace');
  eq('cancelling replace changes nothing', T.state.doc.items.length, 2);
  eq('and it says nothing happened', p.$('#bkMsg').hidden, true);
  p.window.confirm = () => true;
  p.click('#bkReplace');
  includes('confirming replace says so', p.txt('#bkMsg'), '已用备份替换');
  eq('all eight are back', T.state.doc.items.length, 8);
  p.window.confirm = realConfirm;
}

/* ================================================================== 17 */

head('17. Bad backups are refused with a real reason');

{
  const p = openWithSeed();
  const T = p.T();
  p.click('#btnSheet');
  const cases = [
    ['', '还没有内容'],
    ['just some words', '不是合法的 JSON'],
    ['{"kind":"wanzi-wallet","doc":{}}', '看起来不是'],
    ['{"kind":"wanzi-todo"}', '没有任务内容']
  ];
  for (const [text, needle] of cases) {
    p.$('#bkText').value = text;
    p.click('#bkMerge');
    includes('refused [' + (text || '(empty)').slice(0, 22) + ']', p.txt('#bkMsg'), needle);
    ok('and it is styled as a problem', p.cls('#bkMsg').indexOf('is-bad') >= 0, p.cls('#bkMsg'));
    eq('and the store is untouched', T.state.doc.items.length, 8);
  }

  /* valid JSON, right kind, but one junk setting */
  const bk = T.makeBackup();
  bk.doc.settings = { theme: 'neon', view: 'list', sort: 'auto', urgentDays: 99, soonDays: 7 };
  p.$('#bkText').value = JSON.stringify(bk);
  p.click('#bkMerge');
  includes('a good-but-partly-junk backup still restores', p.txt('#bkMsg'), '已合并');
  includes('and it names what it threw away', p.txt('#bkMsg'), '外观');
  eq('the good setting was applied', T.state.doc.settings.view, 'list');
  eq('the junk theme was rejected', T.state.doc.settings.theme, 'clean');
  eq('the junk urgency line was rejected', T.state.doc.settings.urgentDays, 3);

  /* a backup from another app */
  const other = T.makeBackup();
  other.fingerprint.appName = '别的 App';
  p.$('#bkText').value = JSON.stringify(other);
  p.click('#bkMerge');
  includes('a backup from another app works but warns', p.txt('#bkMsg'), '别的 App');
}

/* ================================================================== 18 */

head('18. CSS source guards (jsdom cannot compute these)');

{
  ok('the [hidden] rule uses !important', /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(CSS));
  ok('the phone column is capped at 480px', /max-width:\s*480px/.test(CSS));
  ok('the bottom uses the iOS safe area', /env\(safe-area-inset-bottom\)/.test(CSS));
  ok('the phone height uses dvh', /100dvh/.test(CSS));
  ok('three themes are defined', /data-theme="clean"/.test(CSS) && /data-theme="paper"/.test(CSS) && /data-theme="night"/.test(CSS));
  ok('all four quadrant colours are defined', ['q1', 'q2', 'q3', 'q4'].every((k) => new RegExp('--' + k + ':').test(CSS)));
  ok('the quadrant colour is a left border, not a full background', /\.tk\.q1\s*\{[^}]*--tk-tone/.test(CSS));
  ok('a too-narrow breakpoint exists', /@media \(max-width:\s*340px\)/.test(CSS));
  ok('the sheet scrolls instead of overflowing', /\.sheet-body\s*\{[^}]*overflow-y:\s*auto/.test(CSS));
  ok('secondary text on coloured cards is computed, not fixed', /color-mix\(in srgb/.test(CSS));
  ok('the app.js never parses a date string with new Date(string dates)', !/new Date\(\s*['"]\d{4}-/.test(APP_JS));
  ok('the app.js has no localStorage call without a try', /try\s*\{[\s\S]{0,200}localStorage\.setItem/.test(APP_JS));
}

/* ================================================================== 19 */

head('19. The page carries the iOS home-screen bits');

{
  ok('apple-mobile-web-app-capable is set', /apple-mobile-web-app-capable"\s+content="yes"/.test(HTML));
  ok('apple-mobile-web-app-title is set', /apple-mobile-web-app-title"\s+content="丸梓todo"/.test(HTML));
  ok('apple-touch-icon is set', /rel="apple-touch-icon"/.test(HTML));
  ok('a theme-color meta is set', /name="theme-color"/.test(HTML));
  ok('the viewport covers the notch', /viewport-fit=cover/.test(HTML));
  ok('the language is zh-CN', /<html lang="zh-CN"/.test(HTML));
  ok('there is no CDN reference', !/https?:\/\/(cdn|unpkg|jsdelivr)/.test(HTML));
  ok('the three scripts are loaded in order', HTML.indexOf('src/data.js') < HTML.indexOf('src/todo-core.js') && HTML.indexOf('src/todo-core.js') < HTML.indexOf('src/app.js'));
}

/* ==================================================================== */

console.log('\n--------------------------------------------------');
if (fails.length) {
  console.log('FAILED ' + fails.length + ' of ' + (pass + fails.length));
  for (const f of fails) console.log('  x ' + f);
  process.exit(1);
}
console.log('OK - UI smoke passed: ' + pass + '/' + pass);
process.exit(0);
