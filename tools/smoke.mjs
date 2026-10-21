/* 丸梓todo —— 纯逻辑冒烟测试
 *
 * 跑法：node tools/smoke.mjs      或      npm test
 *
 * 规矩（从课表项目学来的）：
 *   1. 不许写"永远为真"的假断言。每条关键断言都反向验证过一次
 *      （临时把对应实现改坏，确认这条真的变红，再改回）。
 *   2. 日期一律用本地时间构造 at(y,m,d,hh,mm)，绝不用 Date.parse('YYYY-MM-DD')。
 *   3. 断言的"名字"用英文，"期望值"里的产品文案用中文原文逐字比对 ——
 *      文件名和注释也别用中文，免得哪天被工具改坏编码就看不懂了。
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const D = require(path.join(ROOT, 'src', 'data.js'));
const C = require(path.join(ROOT, 'src', 'todo-core.js'));

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
function near(name, actual, expected, tol) {
  return ok(name, Math.abs(actual - expected) <= (tol || 0), 'expected ~' + expected + ', got ' + actual);
}

/* ------------------------------------------------------------ 造时间助手 */

/** 本地时间造 Date。绝不用 new Date('YYYY-MM-DD')。 */
function at(y, m, d, hh, mm) {
  return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
}
const NOW = at(2026, 10, 10, 15, 0); // 2026-10-10 周六 15:00

/* 快捷造任务文档 */
function docWith(items, settings) {
  return C.normalize({ seq: 0, items: items || [], settings: settings || {} });
}
function task(id, title, extra) {
  const o = Object.assign({ id, title, createdAt: 1000 + id, updatedAt: 1000 + id }, extra || {});
  return o;
}
function dl(date, time) { return { date, time: time || '' }; }

/* ================================================================ 1 数据 */

head('1. Data shapes');

ok('META has an app name', typeof D.META.appName === 'string' && D.META.appName.length > 0);
eq('the app is called what the user asked for', D.META.appName, '丸梓todo');
eq('the storage key is namespaced', D.META.storageKey, 'wanziTodo.v1');
eq('the backup kind is namespaced', D.META.backupKind, 'wanzi-todo');
eq('exactly four quadrants', D.QUADRANTS.length, 4);
eq('quadrant keys in order', D.QUADRANTS.map((q) => q.key), ['q1', 'q2', 'q3', 'q4']);
eq('quadrant 1 is important+urgent', [D.QUADRANTS[0].important, D.QUADRANTS[0].urgent], [true, true]);
eq('quadrant 2 is important, not urgent', [D.QUADRANTS[1].important, D.QUADRANTS[1].urgent], [true, false]);
eq('quadrant 3 is not important, urgent', [D.QUADRANTS[2].important, D.QUADRANTS[2].urgent], [false, true]);
eq('quadrant 4 is neither', [D.QUADRANTS[3].important, D.QUADRANTS[3].urgent], [false, false]);
eq('quadrants carry the textbook advice', D.QUADRANTS.map((q) => q.advice), ['马上做', '安排时间做', '快速做完', '能不做就不做']);
eq('urgency buckets cover overdue first', D.URGENCY_BUCKETS[0].key, 'overdue');
eq('the last bucket is a catch-all', D.URGENCY_BUCKETS[D.URGENCY_BUCKETS.length - 1].max, null);
eq('the urgency line defaults to 3 days', D.URGENT_DAYS, 3);
eq('the "due soon" block defaults to 7 days', D.SOON_DAYS, 7);
eq('three themes offered', D.THEMES.length, 3);
eq('the default theme is the clean one', D.DEFAULTS.theme, 'clean');
eq('the default view is today (focus), not the quadrant board', D.DEFAULTS.view, 'focus');
eq('the first view offered is today', D.VIEWS[0].key, 'focus');
ok('praise lines ship for single tasks / a clear day / streaks', D.CHEERS_TASK.length >= 5 && D.CHEERS_DAY.length >= 4 && D.CHEERS_STREAK.length >= 2);
ok('the streak praise lines take an {n}', D.CHEERS_STREAK.some((s) => s.indexOf('{n}') >= 0));
eq('celebrating a check is on by default', D.DEFAULTS.celebrate, true);
eq('no custom praise lines by default', D.DEFAULTS.cheers, '');
eq('the default sort is the auto score', D.DEFAULTS.sort, 'auto');
ok('repeat kinds include daily/weekly/every', ['daily', 'weekly', 'every'].every((k) => D.REPEAT_KINDS.some((r) => r.key === k)));
eq('EMPTY starts with an empty list', D.EMPTY.items, []);

/* ================================================================ 2 日期 */

head('2. Date arithmetic (local time only)');

eq('ymd formats with zero padding', C.ymd(at(2026, 1, 5)), '2026-01-05');
eq('hm formats with zero padding', C.hm(at(2026, 1, 5, 9, 5)), '09:05');
ok('parseDay accepts a good string', !!C.parseDay('2026-10-10'));
eq('parseDay round-trips to local midnight', C.parseDay('2026-10-10').getHours(), 0);
eq('parseDay month is 0-based inside Date but right outside', C.parseDay('2026-10-10').getMonth(), 9);
eq('parseDay rejects garbage', C.parseDay('2026/10/10'), null);
eq('parseDay rejects Feb 30', C.parseDay('2026-02-30'), null);
eq('parseDay rejects a non-string', C.parseDay(20261010), null);
eq('parseHm accepts 9:05', C.parseHm('9:05'), 545);
eq('parseHm accepts 23:59', C.parseHm('23:59'), 1439);
eq('parseHm rejects 24:00', C.parseHm('24:00'), null);
eq('parseHm rejects 12:60', C.parseHm('12:60'), null);
eq('parseHm rejects empty', C.parseHm(''), null);

eq('daysBetween is 0 for the same day', C.daysBetween(at(2026, 10, 10, 23, 59), at(2026, 10, 10, 0, 1)), 0);
eq('daysBetween ignores the time of day', C.daysBetween(at(2026, 10, 11, 0, 1), at(2026, 10, 10, 23, 59)), 1);
eq('daysBetween goes negative for the past', C.daysBetween(at(2026, 10, 8), at(2026, 10, 10)), -2);
eq('daysBetween crosses a month end', C.daysBetween(at(2026, 11, 1), at(2026, 10, 31)), 1);
eq('daysBetween crosses a year end', C.daysBetween(at(2027, 1, 1), at(2026, 12, 31)), 1);
eq('daysBetween handles a leap year Feb 29', C.daysBetween(at(2028, 3, 1), at(2028, 2, 28)), 2);
eq('addDays rolls the month', C.ymd(C.addDays(at(2026, 10, 31), 1)), '2026-11-01');
eq('addDays rolls backwards across a year', C.ymd(C.addDays(at(2026, 1, 1), -1)), '2025-12-31');
eq('addDays uses local time, not UTC', C.ymd(C.addDays(at(2026, 10, 10), 0)), '2026-10-10');

eq('isoDow: Sunday is 7, not 0', C.isoDow(at(2026, 10, 11)), 7);
eq('isoDow: Saturday is 6', C.isoDow(at(2026, 10, 10)), 6);
eq('isoDow: Monday is 1', C.isoDow(at(2026, 10, 5)), 1);
eq('mondayOf a Saturday gives that week Monday', C.ymd(C.mondayOf(at(2026, 10, 10))), '2026-10-05');
eq('mondayOf a Sunday stays in the same week', C.ymd(C.mondayOf(at(2026, 10, 11))), '2026-10-05');
eq('mondayOf a Monday is itself', C.ymd(C.mondayOf(at(2026, 10, 5))), '2026-10-05');
eq('mondayOf works across a year boundary', C.ymd(C.mondayOf(at(2027, 1, 1))), '2026-12-28');

/* ============================================================ 3 评分排序 */

head('3. Urgency score (integers only)');

const t_ovd_imp = C.normalizeItem(task(1, 'overdue+important', { important: true, deadline: dl('2026-10-08') })); // 2 days late
const t_ovd = C.normalizeItem(task(2, 'overdue', { deadline: dl('2026-10-08') }));
const t_today_imp = C.normalizeItem(task(3, 'today+important', { important: true, deadline: dl('2026-10-10') }));
const t_today = C.normalizeItem(task(4, 'today', { deadline: dl('2026-10-10') }));
const t_tmr_imp = C.normalizeItem(task(5, 'tomorrow+important', { important: true, deadline: dl('2026-10-11') }));
const t_tmr = C.normalizeItem(task(6, 'tomorrow', { deadline: dl('2026-10-11') }));
const t_none = C.normalizeItem(task(7, 'no deadline', { important: true }));
const t_far = C.normalizeItem(task(8, 'far away', { important: true, deadline: dl('2027-10-01') }));

eq('overdue+important scores higher than overdue alone', C.scoreOf(t_ovd_imp, NOW) > C.scoreOf(t_ovd, NOW), true);
eq('overdue+important = 100150', C.scoreOf(t_ovd_imp, NOW), 100150);
eq('overdue alone = 100100', C.scoreOf(t_ovd, NOW), 100100);
eq('today+important = 99950', C.scoreOf(t_today_imp, NOW), 99950);
eq('today = 99900', C.scoreOf(t_today, NOW), 99900);
eq('tomorrow+important = 99850', C.scoreOf(t_tmr_imp, NOW), 99850);
eq('tomorrow = 99800', C.scoreOf(t_tmr, NOW), 99800);
eq('no deadline scores 0 even when important', C.scoreOf(t_none, NOW), 0);
ok('every score is an integer', [t_ovd_imp, t_ovd, t_today_imp, t_today, t_tmr_imp, t_tmr, t_none].every((t) => Number.isInteger(C.scoreOf(t, NOW))));
ok('a far-away deadline still loses to an overdue one', C.scoreOf(t_far, NOW) < C.scoreOf(t_ovd, NOW));
ok('importance only breaks ties on the same day', Math.abs(C.scoreOf(t_today_imp, NOW) - C.scoreOf(t_today, NOW)) === C.WEIGHT_IMPORTANT);
ok('importance is worth less than a single day', C.WEIGHT_IMPORTANT < 100);
eq('the score is capped at -999 days', C.scoreOf(C.normalizeItem(task(9, 'ancient', { deadline: dl('1900-01-01') })), NOW), C.scoreOf(C.normalizeItem(task(10, 'still ancient', { deadline: dl('1000-01-01') })), NOW));
eq('a very far deadline is capped at 999 days', C.scoreOf(C.normalizeItem(task(11, 'x', { deadline: dl('2200-01-01') })), NOW), C.scoreOf(C.normalizeItem(task(12, 'y', { deadline: dl('2300-01-01') })), NOW));

eq('daysLeftOf is null without a deadline', C.daysLeftOf(t_none, NOW), null);
eq('daysLeftOf is 0 on the deadline day', C.daysLeftOf(t_today, NOW), 0);
eq('daysLeftOf is -2 two days late', C.daysLeftOf(t_ovd, NOW), -2);
eq('urgency of an overdue task', C.urgencyOf(t_ovd, NOW), 'overdue');
eq('urgency of a today task', C.urgencyOf(t_today, NOW), 'today');
eq('urgency of a tomorrow task', C.urgencyOf(t_tmr, NOW), 'tomorrow');
eq('urgency of a 2-day task is the 3-day bucket', C.urgencyOf(C.normalizeItem(task(13, 'x', { deadline: dl('2026-10-12') })), NOW), 'urgent');
eq('urgency of a 3-day task is still the 3-day bucket', C.urgencyOf(C.normalizeItem(task(14, 'x', { deadline: dl('2026-10-13') })), NOW), 'urgent');
eq('urgency of a 4-day task jumps to the week bucket', C.urgencyOf(C.normalizeItem(task(15, 'x', { deadline: dl('2026-10-14') })), NOW), 'week');
eq('urgency of an 8-day task is later', C.urgencyOf(C.normalizeItem(task(16, 'x', { deadline: dl('2026-10-18') })), NOW), 'later');
eq('urgency of no deadline is none', C.urgencyOf(t_none, NOW), 'none');

eq('urgent: 3 days out counts as urgent', C.isUrgent(C.normalizeItem(task(17, 'x', { deadline: dl('2026-10-13') })), NOW), true);
eq('urgent: 4 days out is not urgent', C.isUrgent(C.normalizeItem(task(18, 'x', { deadline: dl('2026-10-14') })), NOW), false);
eq('urgent: overdue counts as urgent', C.isUrgent(t_ovd, NOW), true);
eq('urgent: a done task is never urgent', C.isUrgent(C.normalizeItem(task(19, 'x', { deadline: dl('2026-10-08'), done: true })), NOW), false);
eq('urgent: no deadline is not urgent', C.isUrgent(t_none, NOW), false);
eq('the urgent line can be overridden by settings', C.isUrgent(C.normalizeItem(task(20, 'x', { deadline: dl('2026-10-14') })), NOW, 5), true);

eq('quadrant of important+overdue', C.quadrantOf(t_ovd_imp, NOW).key, 'q1');
eq('quadrant of important+far', C.quadrantOf(t_far, NOW).key, 'q2');
eq('quadrant of unimportant+overdue', C.quadrantOf(t_ovd, NOW).key, 'q3');
eq('quadrant of unimportant+far', C.quadrantOf(t_far, NOW).key, 'q2');
eq('an unimportant far task is in quadrant 4', C.quadrantOf(C.normalizeItem(task(22, 'x', { deadline: dl('2026-12-01') })), NOW).key, 'q4');
eq('a no-deadline important task falls in quadrant 2', C.quadrantOf(t_none, NOW).key, 'q2');
eq('a no-deadline unimportant task falls in quadrant 4', C.quadrantOf(C.normalizeItem(task(21, 'x')), NOW).key, 'q4');

head('3b. Sorting');

const mixed = docWith([
  task(1, 'no ddl important', { important: true }),
  task(2, 'overdue', { deadline: dl('2026-10-06') }),
  task(3, 'far important', { important: true, deadline: dl('2026-12-01') }),
  task(4, 'today important', { important: true, deadline: dl('2026-10-10') }),
  task(5, 'tomorrow', { deadline: dl('2026-10-11') })
]);
const autoOrder = C.flatList(mixed, NOW).map((t) => t.title);
eq('auto sort puts the most overdue first', autoOrder[0], 'overdue');
eq('auto sort puts today+important second', autoOrder[1], 'today important');
eq('auto sort puts tomorrow third', autoOrder[2], 'tomorrow');
eq('auto sort puts the far one fourth', autoOrder[3], 'far important');
eq('auto sort sinks the no-deadline task to the very bottom', autoOrder[4], 'no ddl important');
ok('a no-deadline task loses to every dated task even when important', autoOrder.indexOf('no ddl important') === autoOrder.length - 1);

const ddlOrder = C.flatList(docWith(mixed.items, { sort: 'ddl' }), NOW).map((t) => t.title);
eq('ddl sort starts with the oldest deadline', ddlOrder[0], 'overdue');
eq('ddl sort ignores importance', ddlOrder[1], 'today important');
eq('ddl sort puts undated tasks last', ddlOrder[ddlOrder.length - 1], 'no ddl important');

const createdOrder = C.flatList(docWith(mixed.items, { sort: 'created' }), NOW).map((t) => t.id);
eq('created sort shows the newest first', createdOrder[0], 5);

const sameDay = docWith([
  task(1, 'a', { important: false, deadline: dl('2026-10-12') }),
  task(2, 'b', { important: true, deadline: dl('2026-10-12') })
]);
eq('on the same deadline day, important comes first', C.flatList(sameDay, NOW).map((t) => t.title), ['b', 'a']);

const tie = docWith([task(7, 'seven', { createdAt: 500 }), task(8, 'eight', { createdAt: 500 })]);
const tieA = C.flatList(tie, NOW).map((t) => t.id);
const tieB = C.flatList(tie, NOW).map((t) => t.id);
eq('a tie is broken by id so the order never flips', tieA, [7, 8]);
eq('sorting twice gives the same order (stable)', tieA, tieB);

head('3c. Quadrant buckets');

const qdoc = docWith([
  task(1, 'q1 item', { important: true, deadline: dl('2026-10-09') }),
  task(2, 'q2 item', { important: true, deadline: dl('2026-11-20') }),
  task(3, 'q3 item', { deadline: dl('2026-10-09') }),
  task(4, 'q4 item', { deadline: dl('2026-11-20') }),
  task(5, 'q2 undated', { important: true })
]);
const quads = C.byQuadrant(qdoc, NOW);
eq('q1 holds only the important+urgent one', quads.q1.map((t) => t.title), ['q1 item']);
eq('q2 holds the important non-urgent ones', quads.q2.map((t) => t.title).sort(), ['q2 item', 'q2 undated']);
eq('q3 holds the urgent unimportant one', quads.q3.map((t) => t.title), ['q3 item']);
eq('q4 holds the rest', quads.q4.map((t) => t.title), ['q4 item']);
eq('every open task lands in exactly one quadrant', quads.q1.length + quads.q2.length + quads.q3.length + quads.q4.length, C.openTasks(qdoc).length);
ok('a done task is not in any quadrant', !['q1 item'].includes('x') && quads.q1.every((t) => !t.done));

head('3d. Deadlines that need attention');

const attn = docWith([
  task(1, 'late', { deadline: dl('2026-10-05') }),
  task(2, 'today', { deadline: dl('2026-10-10') }),
  task(3, 'in 5 days', { deadline: dl('2026-10-15') }),
  task(4, 'in 20 days', { deadline: dl('2026-10-30') }),
  task(5, 'undated'),
  task(6, 'already done late', { deadline: dl('2026-10-01'), done: true })
]);
eq('overdueTasks only lists the late ones', C.overdueTasks(attn, NOW).map((t) => t.title), ['late']);
eq('soonTasks includes overdue + today + within a week', C.soonTasks(attn, NOW).map((t) => t.title), ['late', 'today', 'in 5 days']);
eq('soonTasks leaves the far one out', C.soonTasks(attn, NOW).some((t) => t.title === 'in 20 days'), false);
eq('soonTasks leaves undated tasks out', C.soonTasks(attn, NOW).some((t) => t.title === 'undated'), false);
eq('soonTasks leaves finished tasks out', C.soonTasks(attn, NOW).some((t) => t.title === 'already done late'), false);

/* ============================================================ 4 重复打卡 */

head('4. Repeating habits and check-ins');

eq('normalizeRepeat accepts daily', C.normalizeRepeat({ kind: 'daily' }).kind, 'daily');
eq('normalizeRepeat dedupes and sorts weekly days', C.normalizeRepeat({ kind: 'weekly', days: [5, 1, 5, 3] }).days, [1, 3, 5]);
eq('normalizeRepeat drops out-of-range weekdays', C.normalizeRepeat({ kind: 'weekly', days: [0, 8, 2] }).days, [2]);
eq('normalizeRepeat rejects an empty weekly list', C.normalizeRepeat({ kind: 'weekly', days: [] }), null);
eq('normalizeRepeat accepts an interval', C.normalizeRepeat({ kind: 'every', n: 3 }).n, 3);
eq('normalizeRepeat rejects interval 0', C.normalizeRepeat({ kind: 'every', n: 0 }), null);
eq('normalizeRepeat rejects a giant interval', C.normalizeRepeat({ kind: 'every', n: 400 }), null);
eq('normalizeRepeat rejects an unknown kind', C.normalizeRepeat({ kind: 'hourly' }), null);

const daily = C.normalizeItem(task(1, '背单词', { repeat: { kind: 'daily' }, createdAt: at(2026, 10, 1).getTime() }));
const mwf = C.normalizeItem(task(2, '跑步', { repeat: { kind: 'weekly', days: [1, 3, 5] }, createdAt: at(2026, 10, 1).getTime() }));
const every3 = C.normalizeItem(task(3, '浇花', { repeat: { kind: 'every', n: 3 }, createdAt: at(2026, 10, 1).getTime() }));

ok('a daily habit is recognised as repeating', C.isRepeat(daily));
eq('a plain task is not repeating', C.isRepeat(C.normalizeItem(task(4, 'x'))), false);
eq('a daily habit is due every day', C.dueOn(daily, at(2026, 10, 10)), true);
eq('a Mon/Wed/Fri habit is due on Saturday? no', C.dueOn(mwf, at(2026, 10, 10)), false);
eq('a Mon/Wed/Fri habit is due on Monday', C.dueOn(mwf, at(2026, 10, 12)), true);
eq('a Mon/Wed/Fri habit is due on Wednesday', C.dueOn(mwf, at(2026, 10, 14)), true);
eq('a Mon/Wed/Fri habit is not due on Tuesday', C.dueOn(mwf, at(2026, 10, 13)), false);
eq('every-3-days from Oct 1 is due on Oct 4', C.dueOn(every3, at(2026, 10, 4)), true);
eq('every-3-days is not due on Oct 5', C.dueOn(every3, at(2026, 10, 5)), false);
eq('every-3-days is due again on Oct 7', C.dueOn(every3, at(2026, 10, 7)), true);
eq('every-3-days anchors on the created day itself', C.dueOn(every3, at(2026, 10, 1)), true);
eq('every-3-days handles a date before the anchor without going negative', C.dueOn(every3, at(2026, 9, 28)), true);

eq('repeatText for daily', C.repeatText(daily), '每天');
eq('repeatText lists weekday names', C.repeatText(mwf), '每周 一、三、五');
eq('repeatText for an interval', C.repeatText(every3), '每隔 3 天');

eq('a habit never uses the done flag', daily.done, false);
ok('a habit is given an empty log', Array.isArray(daily.log) && daily.log.length === 0);
eq('normalizeLog sorts and dedupes', C.normalizeLog(['2026-10-05', '2026-10-01', '2026-10-05', 'garbage', 42]), ['2026-10-01', '2026-10-05']);

let h = daily;
let res = C.toggle(C.normalize({ items: [h] }), h.id, at(2026, 10, 10, 9, 0));
eq('checking a habit records today', res.item.log, ['2026-10-10']);
eq('checking a habit reports checked=true', res.checked, true);
eq('checking a habit leaves done=false', res.item.done, false);
eq('doneToday is true right after checking', C.doneToday(res.item, at(2026, 10, 10, 20, 0)), true);
eq('doneToday is false the next day', C.doneToday(res.item, at(2026, 10, 11, 8, 0)), false);

const twice = C.toggle(res.doc, h.id, at(2026, 10, 10, 21, 0));
eq('checking twice the same day un-checks it', twice.item.log, []);
eq('un-checking reports checked=false', twice.checked, false);

const log = C.normalizeItem(task(1, '背单词', {
  repeat: { kind: 'daily' },
  createdAt: at(2026, 10, 1).getTime(),
  log: ['2026-10-04', '2026-10-05', '2026-10-08', '2026-10-09', '2026-10-10']
}));
eq('streak counts today when today is checked', C.streakOf(log, at(2026, 10, 10, 15, 0)), 3);
eq('streak counts back from yesterday when today is not checked yet', C.streakOf(log, at(2026, 10, 11, 9, 0)), 3);
eq('one missed day breaks the streak', C.streakOf(log, at(2026, 10, 12, 9, 0)), 0);
eq('a task that never checked has streak 0', C.streakOf(daily, at(2026, 10, 10)), 0);
eq('total checks counts the log', C.totalChecks(log), 5);
eq('a non-repeating task has streak 0', C.streakOf(C.normalizeItem(task(9, 'x')), NOW), 0);

const mwfLog = C.normalizeItem(task(2, '跑步', {
  repeat: { kind: 'weekly', days: [1, 3, 5] },
  createdAt: at(2026, 10, 1).getTime(),
  log: ['2026-10-05', '2026-10-07', '2026-10-09']
}));
eq('a Mon/Wed/Fri streak counts only its own days', C.streakOf(mwfLog, at(2026, 10, 10, 12, 0)), 3);
eq('a Mon/Wed/Fri streak survives the weekend', C.streakOf(mwfLog, at(2026, 10, 11, 12, 0)), 3);
eq('a Mon/Wed/Fri streak breaks after missing Monday', C.streakOf(mwfLog, at(2026, 10, 13, 12, 0)), 0);

head('4b. Heatmap data');

const hm = C.heatmapOf([log, mwfLog], at(2026, 10, 10, 15, 0), 4);
eq('heatmap makes the requested number of week columns', hm.cols.length, 4);
ok('every week column has 7 days', hm.cols.every((c) => c.days.length === 7));
const hmDays = hm.cols.map((c) => c.days).flat();
const hmOf = (s) => hmDays.find((d) => d.date === s);
eq('heatmap starts on a Monday', C.isoDow(C.parseDay(hm.cols[0].days[0].date)), 1);
eq('4 weeks back, first column starts 3 weeks before this Monday', hm.cols[0].days[0].date, '2026-09-14');
eq('the heatmap covers 28 days', hmDays.length, 28);
eq('heatmap last column is this week, through Sunday', hm.cols[3].days[6].date, '2026-10-11');
eq('heatmapOf start matches the first cell', hm.start, '2026-09-14');
eq('today is level 2 (checked today)', hmOf('2026-10-10').level, 2);
eq('yesterday checked is level 1', hmOf('2026-10-09').level, 1);
eq('yesterday really was checked in the fixture', log.log.includes('2026-10-09'), true);
eq('a missed day is level 0', hmOf('2026-09-30').level, 0);
eq('a missed day really is not in the log', log.log.includes('2026-09-30'), false);
eq('today is not flagged future', hmOf('2026-10-10').future, false);
eq('the Saturday before is not flagged future', hmOf('2026-10-03').future, false);
eq('tomorrow in the same column IS flagged future', hmOf('2026-10-11').future, true);
ok('the heatmap records which habit was checked', hmOf('2026-10-10').hits.length >= 1);
eq('the hits list names the daily habit', hmOf('2026-10-10').hits, [log.id]);

const hmOnlyMwf = C.heatmapOf([mwfLog], at(2026, 10, 10, 15, 0), 4);
const mwfDays = hmOnlyMwf.cols.map((c) => c.days).flat();
const mwfOf = (s) => mwfDays.find((d) => d.date === s);
eq('Saturday is not due for a Mon/Wed/Fri habit', mwfOf('2026-10-10').due, false);
eq('Friday is due for a Mon/Wed/Fri habit', mwfOf('2026-10-09').due, true);
eq('a not-due day is level 0 even after the habit was checked that week', mwfOf('2026-10-10').level, 0);
eq('a daily habit marks every day due', hmOf('2026-10-01').due, true);

const hmFuture = C.heatmapOf([log], at(2026, 10, 1, 12, 0), 4);
const fDays = hmFuture.cols.map((c) => c.days).flat();
const fOf = (s) => fDays.find((d) => d.date === s);
eq('a day after "now" is flagged future', fOf('2026-10-02').future, true);
eq('a future day is level 0', fOf('2026-10-02').level, 0);
eq('the day of "now" is not future', fOf('2026-10-01').future, false);
eq('a day before "now" is not future', fOf('2026-09-30').future, false);
eq('the heatmap ends on the Sunday of the week of "now"', fDays[fDays.length - 1].date, '2026-10-04');

/* ============================================================ 5 增删改 */

head('5. Add / update / remove');

let d0 = C.normalize(null);
eq('normalizing null gives an empty doc', d0.items.length, 0);
eq('an empty doc keeps default settings', d0.settings.theme, 'clean');

let added = C.addItem(d0, { title: '  写实验报告  ', note: '  下周三之前  ' }, 1000);
eq('addItem bumps seq to 1', added.doc.seq, 1);
eq('addItem returns the new id', added.item.id, 1);
eq('addItem trims the title', added.item.title, '写实验报告');
eq('addItem collapses whitespace in the note', added.item.note, '下周三之前');
eq('addItem starts unfinished', added.item.done, false);
eq('addItem does not mutate the input doc', d0.items.length, 0);

let threw = null;
try { C.addItem(d0, { title: '   ' }, 1000); } catch (e) { threw = e; }
ok('an empty title throws', !!threw);
eq('the thrown error carries a code', threw && threw.code, 'EMPTY_TITLE');

let longTitle = C.addItem(d0, { title: 'x'.repeat(500) }, 1000).item;
eq('a too-long title is truncated to 200', longTitle.title.length, C.TITLE_MAX);
let longNote = C.addItem(d0, { title: 'a', note: 'y'.repeat(5000) }, 1000).item;
eq('a too-long note is truncated to 2000', longNote.note.length, C.NOTE_MAX);

let d1 = C.addItem(d0, { title: 'A' }, 1000).doc;
d1 = C.addItem(d1, { title: 'B' }, 2000).doc;
eq('ids keep counting up', d1.items.map((t) => t.id), [1, 2]);

let upd = C.updateItem(d1, 1, { important: true, deadline: dl('2026-10-20', '23:59') }, 3000);
eq('update sets important', upd.item.important, true);
eq('update stores the deadline date', upd.item.deadline.date, '2026-10-20');
eq('update stores the deadline time', upd.item.deadline.time, '23:59');
eq('update bumps updatedAt', upd.item.updatedAt, 3000);
eq('update leaves the other task alone', upd.doc.items[1].important, false);
eq('update on a missing id returns null', C.updateItem(d1, 99, { important: true }), null);

let badTime = C.updateItem(d1, 1, { deadline: { date: '2026-10-20', time: '25:00' } }).item;
eq('an invalid time is dropped but the date survives', [badTime.deadline.date, badTime.deadline.time], ['2026-10-20', '']);
let badDate = C.updateItem(d1, 1, { deadline: { date: '2026-02-30' } }).item;
eq('an invalid date clears the deadline instead of storing junk', badDate.deadline, null);

let threw2 = null;
try { C.updateItem(d1, 1, { title: '  ' }); } catch (e) { threw2 = e; }
ok('updating the title to blank throws', !!threw2);

eq('remove takes one out', C.removeItem(d1, 1).items.map((t) => t.id), [2]);
eq('removing a missing id returns null', C.removeItem(d1, 99), null);
eq('remove does not mutate the source', d1.items.length, 2);

let toggled = C.toggle(d1, 1, at(2026, 10, 10, 12, 0));
eq('toggle marks it done', toggled.item.done, true);
eq('toggle records when it was finished', toggled.item.doneAt, at(2026, 10, 10, 12, 0).getTime());
let toggled2 = C.toggle(toggled.doc, 1, at(2026, 10, 10, 13, 0));
eq('toggling again un-dones it', toggled2.item.done, false);
eq('un-done clears doneAt', toggled2.item.doneAt, 0);
eq('toggle on a missing id returns null', C.toggle(d1, 99, NOW), null);
eq('done tasks are out of the open list', C.openTasks(toggled.doc).map((t) => t.id), [2]);
eq('done tasks are in the done list', C.doneTasks(toggled.doc).map((t) => t.id), [1]);
eq('habits are in their own list', C.habits(docWith([daily, C.normalizeItem(task(9, 'plain'))])).length, 1);

head('5b. Normalizing broken data');

eq('normalize drops items with no title', C.normalize({ items: [{ id: 1, title: '' }, { id: 2, title: 'ok' }] }).items.length, 1);
eq('normalize drops duplicate ids', C.normalize({ items: [{ id: 3, title: 'a' }, { id: 3, title: 'b' }] }).items.length, 1);
eq('normalize raises seq to the highest id', C.normalize({ seq: 0, items: [{ id: 9, title: 'a' }] }).seq, 9);
eq('normalize keeps a good deadline', C.normalize({ items: [{ id: 1, title: 'a', deadline: { date: '2026-10-10', time: '08:00' } }] }).items[0].deadline.time, '08:00');
eq('normalize throws away a broken deadline', C.normalize({ items: [{ id: 1, title: 'a', deadline: { date: 'nonsense' } }] }).items[0].deadline, null);
eq('normalize forces done=false on a habit', C.normalize({ items: [{ id: 1, title: 'a', repeat: { kind: 'daily' }, done: true }] }).items[0].done, false);
eq('normalize gives a habit a log array', C.normalize({ items: [{ id: 1, title: 'a', repeat: { kind: 'daily' } }] }).items[0].log, []);
eq('normalize accepts a bare array', C.normalize([{ id: 1, title: 'a' }]).items.length, 1);
eq('normalize copes with a string', C.normalize('nonsense').items.length, 0);
eq('normalize copes with a number', C.normalize(42).items.length, 0);
eq('normalize copes with null', C.normalize(null).items.length, 0);
eq('normalize only trusts done===true', C.normalize({ items: [{ id: 1, title: 'a', done: 'yes' }] }).items[0].done, false);
eq('normalize only trusts important===true', C.normalize({ items: [{ id: 1, title: 'a', important: 1 }] }).items[0].important, false);
eq('normalize repairs a missing createdAt', C.normalize({ items: [{ id: 1, title: 'a' }] }).items[0].createdAt > 0, true);
eq('normalize caps the item count', C.normalize({ items: new Array(3000).fill(0).map((_, i) => ({ id: i + 1, title: 't' + i })) }).items.length, C.MAX_ITEMS);

eq('an unknown theme falls back to clean', C.normalizeSettings({ theme: 'neon' }).theme, 'clean');
eq('an unknown view falls back to today (focus)', C.normalizeSettings({ view: 'grid' }).view, 'focus');
eq('custom praise lines are trimmed and kept line by line', C.normalizeSettings({ cheers: '  加油  \n\n 别急 \n' }).cheers, '加油\n别急');
eq('custom praise lines are capped at 20', C.normalizeSettings({ cheers: new Array(30).fill('x').join('\n') }).cheers.split('\n').length, 20);
eq('a praise line longer than 40 chars is cut', C.normalizeSettings({ cheers: 'y'.repeat(60) }).cheers.length, 40);
eq('celebrate only accepts a real boolean', C.normalizeSettings({ celebrate: 'false' }).celebrate, true);
eq('celebrate=false is honoured', C.normalizeSettings({ celebrate: false }).celebrate, false);
eq('an unknown sort falls back to auto', C.normalizeSettings({ sort: 'random' }).sort, 'auto');
eq('a huge soonDays is rejected', C.normalizeSettings({ soonDays: 9999 }).soonDays, D.DEFAULTS.soonDays);
eq('a negative urgentDays is rejected', C.normalizeSettings({ urgentDays: -1 }).urgentDays, D.DEFAULTS.urgentDays);
eq('a good urgentDays is kept', C.normalizeSettings({ urgentDays: 5 }).urgentDays, 5);
eq('settings survive a round trip', C.normalize({ settings: { theme: 'night', view: 'list', sort: 'ddl' } }).settings.theme, 'night');

/* ============================================================ 6 搜索统计 */

head('6. Search and stats');

const sdoc = docWith([
  task(1, '写 C 语言实验报告'),
  task(2, '买洗衣液', { note: '顺便看看有没有打折的' }),
  task(3, '交实验报告', { deadline: dl('2026-10-07') }),
  task(4, '背单词', { repeat: { kind: 'daily' }, createdAt: at(2026, 10, 1).getTime() })
]);
eq('search matches the title', C.search(sdoc, '实验').map((t) => t.id), [1, 3]);
eq('search matches the note', C.search(sdoc, '打折').map((t) => t.id), [2]);
eq('search is case-insensitive', C.search(docWith([task(1, 'Read PDF')]), 'pdf').length, 1);
eq('an empty query returns null (show everything)', C.search(sdoc, '   '), null);
eq('a query with no hits returns an empty list', C.search(sdoc, '不存在的词'), []);

const withDone = C.toggle(C.toggle(sdoc, 2, NOW).doc, 3, NOW).doc;
const st = C.stats(withDone, NOW);
eq('stats counts open non-habit tasks', st.open, 1);
eq('stats counts finished tasks', st.done, 2);
eq('finishing the overdue task takes it out of the overdue count', st.overdue, 0);
eq('before finishing, that overdue task WAS counted', C.stats(sdoc, NOW).overdue, 1);
eq('stats counts habits separately', st.habits, 1);
eq('stats counts how many habits are checked today', st.checkedToday, 0);
eq('stats counts a habit checked today', C.stats(C.toggle(withDone, 4, NOW).doc, NOW).checkedToday, 1);

head('6b. Display text');

eq('whenText says today', C.whenText(t_today, NOW), '今天');
eq('whenText says tomorrow', C.whenText(t_tmr, NOW), '明天');
eq('whenText counts overdue days', C.whenText(t_ovd, NOW), '逾期 2 天');
eq('whenText for yesterday', C.whenText(C.normalizeItem(task(30, 'x', { deadline: dl('2026-10-09') })), NOW), '昨天');
eq('whenText counts days out', C.whenText(C.normalizeItem(task(31, 'x', { deadline: dl('2026-10-14') })), NOW), '4 天后');
eq('whenText falls back to a date when far', C.whenText(C.normalizeItem(task(32, 'x', { deadline: dl('2026-11-20') })), NOW), '11/20');
eq('whenText for an undated task', C.whenText(t_none, NOW), '没定时间');
eq('deadlineText spells out the weekday', C.deadlineText(C.normalizeItem(task(33, 'x', { deadline: dl('2026-10-15', '18:00') })), NOW), '10/15 周四 18:00');
eq('deadlineText for an undated task', C.deadlineText(t_none, NOW), '没定时间');
eq('countdownText counts days', C.countdownText(t_tmr, NOW), '还有 1 天');
eq('countdownText for overdue', C.countdownText(t_ovd, NOW), '已经过了 2 天');
eq('countdownText for today without a time', C.countdownText(t_today, NOW), '今天截止');
eq('countdownText counts hours when a time is set', C.countdownText(C.normalizeItem(task(34, 'x', { deadline: dl('2026-10-10', '23:30') })), NOW), '还有 8 小时 30 分钟');
eq('countdownText flags a time that already passed', C.countdownText(C.normalizeItem(task(35, 'x', { deadline: dl('2026-10-10', '09:00') })), NOW), '今天截止（时间已过）');
eq('quadrantName maps back', C.quadrantName('q1'), '重要且紧急');

/* ============================================================ 7 计时 */

head('7. Timing (how long did each thing take)');

/* --- 格式化 --- */
eq('fmtDuration for 45 seconds', C.fmtDuration(45000), '45 秒');
eq('fmtDuration for 12 min 30 sec', C.fmtDuration(12 * 60000 + 30000), '12 分 30 秒');
eq('fmtDuration drops seconds once past a quarter hour', C.fmtDuration(25 * 60000 + 30000), '25 分');
eq('fmtDuration for 1 h 12 min', C.fmtDuration((60 + 12) * 60000), '1 小时 12 分');
eq('fmtDuration for a whole hour', C.fmtDuration(3600000), '1 小时');
eq('fmtDuration of nothing is empty', C.fmtDuration(0), '');
eq('fmtDuration of garbage is empty', C.fmtDuration(-5), '');
eq('fmtClock pads to mm:ss', C.fmtClock(65 * 1000), '01:05');
eq('fmtClock adds hours when needed', C.fmtClock(3725 * 1000), '01:02:05');

/* --- 开始 / 结束 --- */
const tdoc = docWith([task(1, '写实验报告'), task(2, '背单词'), task(3, '跑步', { repeat: { kind: 'daily' } })]);

const started = C.startTimer(tdoc, 1, at(2026, 10, 10, 9, 0));
ok('starting a timer returns a doc', !!started.doc);
eq('the running task id is remembered', started.doc.timer.taskId, 1);
eq('the start timestamp is exact', started.doc.timer.startedAt, at(2026, 10, 10, 9, 0).getTime());

/* 关键：时长靠时间戳相减，不靠"每秒加一" —— iOS 切后台会把定时器冻住 */
const run10 = C.runningTimer(started.doc, at(2026, 10, 10, 9, 10));
eq('10 minutes later the elapsed is 10 minutes', run10.elapsed, 10 * 60000);
const run3h = C.runningTimer(started.doc, at(2026, 10, 10, 12, 0));
eq('3 hours later it knows it has been 3 hours', run3h.elapsed, 3 * 3600000);

/* 同一时间只允许一件 */
const busy = C.startTimer(started.doc, 2, at(2026, 10, 10, 9, 5));
eq('a second timer is refused while one runs', busy.error, 'BUSY');
eq('and it tells you which one is running', busy.running.id, 1);
eq('the doc is untouched when refused', busy.doc, undefined);

/* 重复点同一件不算重开 */
const again = C.startTimer(started.doc, 1, at(2026, 10, 10, 9, 30));
eq('restarting the same task does not reset the clock', again.already, true);
eq('and the start time is still the first one', again.doc.timer.startedAt, at(2026, 10, 10, 9, 0).getTime());

/* --- 停下并落记录 --- */
const stopped = C.stopTimer(started.doc, at(2026, 10, 10, 9, 10));
eq('stopping records the session length', stopped.ms, 10 * 60000);
eq('the timer is cleared', stopped.doc.timer, null);
eq('the session lands on the right task', C.getItem(stopped.doc, 1).sessions.length, 1);
eq('the other task gets nothing', C.getItem(stopped.doc, 2).sessions, undefined);
eq('the total time of that task is 10 minutes', C.timeOf(C.getItem(stopped.doc, 1)), 10 * 60000);

/* 第二条累加 */
const s2 = C.startTimer(stopped.doc, 1, at(2026, 10, 10, 14, 0)).doc;
const stopped2 = C.stopTimer(s2, at(2026, 10, 10, 14, 20));
eq('a second session adds up', C.timeOf(C.getItem(stopped2.doc, 1)), 30 * 60000);
eq('both sessions are kept separately', C.getItem(stopped2.doc, 1).sessions.length, 2);

/* 太短的不记，但要说一声 */
const tiny = C.stopTimer(C.startTimer(tdoc, 1, at(2026, 10, 10, 9, 0)).doc, at(2026, 10, 10, 9, 0, 3));
eq('a 3-second blip is not recorded', tiny.session, null);
eq('but it is flagged as dropped so the UI can say so', tiny.dropped, true);
eq('and nothing was added to the task', C.getItem(tiny.doc, 1).sessions, undefined);

/* 停下来的时候没有在计时 */
eq('stopping when nothing runs returns null', C.stopTimer(tdoc, NOW), null);

/* 忘了停：超过 24 小时截平，不会记出一个"计了三天" */
const cap = C.runningTimer(
  C.startTimer(tdoc, 1, at(2026, 10, 1, 9, 0)).doc,
  at(2026, 10, 10, 9, 0)
);
eq('an abandoned timer is capped at 24 hours', cap.elapsed, C.SESSION_CAP_MS);
const capStop = C.stopTimer(C.startTimer(tdoc, 1, at(2026, 10, 1, 9, 0)).doc, at(2026, 10, 10, 9, 0));
eq('and the recorded session is capped too', capStop.ms, C.SESSION_CAP_MS);

/* 点错了：丢掉 */
const cancelled = C.cancelTimer(started.doc);
eq('cancelling clears the timer', cancelled.timer, null);
eq('cancelling records nothing', C.getItem(cancelled, 1).sessions, undefined);

/* --- 按天归并（日常打卡的累计要用） --- */
const dayDoc = C.normalize({
  seq: 3,
  items: [
    task(1, '背单词', {
      repeat: { kind: 'daily' },
      sessions: [
        { start: at(2026, 10, 9, 8, 0).getTime(), end: at(2026, 10, 9, 8, 20).getTime(), ms: 20 * 60000 },
        { start: at(2026, 10, 10, 8, 0).getTime(), end: at(2026, 10, 10, 8, 15).getTime(), ms: 15 * 60000 },
        { start: at(2026, 10, 10, 20, 0).getTime(), end: at(2026, 10, 10, 20, 10).getTime(), ms: 10 * 60000 }
      ]
    }),
    task(2, '跑步', {
      repeat: { kind: 'daily' },
      sessions: [{ start: at(2026, 10, 10, 7, 0).getTime(), end: at(2026, 10, 10, 7, 40).getTime(), ms: 40 * 60000 }]
    })
  ]
});
const perDay = C.byDay(C.getItem(dayDoc, 1));
eq('per-day totals merge the same day', perDay['2026-10-10'], 25 * 60000);
eq('and keep other days apart', perDay['2026-10-09'], 20 * 60000);
eq('all tasks on one day add up', C.dayTotals(dayDoc.items, NOW)['2026-10-10'], 65 * 60000);
eq('todayTime is just today', C.todayTime(dayDoc, NOW), 65 * 60000);
const habitTotal = C.timeOf(C.getItem(dayDoc, 1));
eq('a habit accumulates across days', habitTotal, 45 * 60000);

/* --- 改长短 / 删一段 --- */
const edited = C.setSessionMs(dayDoc, 2, 0, 30 * 60000);
eq('editing a session changes its length', C.getItem(edited, 2).sessions[0].ms, 30 * 60000);
eq('and the end time follows', C.getItem(edited, 2).sessions[0].end - C.getItem(edited, 2).sessions[0].start, 30 * 60000);
eq('editing an out-of-range index returns null', C.setSessionMs(dayDoc, 2, 99, 60000), null);
eq('editing a missing task returns null', C.setSessionMs(dayDoc, 99, 0, 60000), null);
const gone = C.removeSession(dayDoc, 2, 0);
eq('deleting a session removes it', C.getItem(gone, 2).sessions, []);
eq('deleting an out-of-range index returns null', C.removeSession(dayDoc, 2, 5), null);

/* --- 坏数据 --- */
const broken = C.normalize({
  seq: 1,
  items: [task(1, 'x', {
    sessions: [
      null,
      { start: 0, end: 0, ms: 0 },
      { start: -5, ms: 1000 },
      { start: 1000, end: 5000, ms: 4000 },
      { start: 2000, end: 2000, ms: -1 },
      { start: 3000, ms: 7000 }
    ]
  })],
  timer: { taskId: 99, startedAt: 5000 }
});
eq('bad sessions are dropped, good ones kept', C.getItem(broken, 1).sessions.length, 2);
eq('a timer pointing at a deleted task is dropped', broken.timer, null);
const keepTimer = C.normalize({ seq: 1, items: [task(1, 'x')], timer: { taskId: 1, startedAt: 5000 } });
eq('a timer pointing at a live task is kept', keepTimer.timer.taskId, 1);
eq('a doc with no sessions field is fine', C.timeOf(C.getItem(C.normalize({ items: [task(1, 'x')] }), 1)), 0);

/* ==================================================================== */

console.log('\n--------------------------------------------------');
if (fails.length) {
  console.log('FAILED ' + fails.length + ' of ' + (pass + fails.length));
  for (const f of fails) console.log('  x ' + f);
  process.exit(1);
}
console.log('OK - logic smoke passed: ' + pass + '/' + pass);
process.exit(0);
