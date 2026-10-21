/* 丸梓todo —— 纯逻辑层
 *
 * 这个文件不碰 DOM、不碰 localStorage，只吃数据吐数据 —— 所以 node 能直接
 * require 进来做冒烟测试（tools/smoke.mjs）。
 *
 * 三条硬规矩，改代码时别破：
 *   1. 一律用【本地时间】。new Date(y, m-1, d) 可以，new Date('2026-10-10')
 *      不行 —— 后者按 UTC 午夜解析，东八区会整体偏一天。
 *   2. 所有日期比较都先把时间截到当天 00:00 再算差值，不然"今天 09:00 的
 *      DDL"和"现在 15:00"会算出 0.75 天这种小数，四象限的界线就会飘。
 *   3. 分数一律是【整数】。浮点会出现 0.30000000000000004 那种鬼东西，
 *      排序结果不稳定，也没法写死断言。
 */
(function (root) {
  'use strict';

  var D = root.TodoData;
  if (!D && typeof require === 'function') D = require('./data.js');
  var META = D.META;
  var QUADRANTS = D.QUADRANTS;
  var BUCKETS = D.URGENCY_BUCKETS;

  var DAY_NAMES = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  var MS_DAY = 86400000;

  /* ==================================================================
     日期小工具
     ================================================================== */

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  /** Date → 'YYYY-MM-DD'（本地时区，不用 toISOString —— 那是 UTC） */
  function ymd(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** Date → 'HH:MM' */
  function hm(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }

  /** 'YYYY-MM-DD' → Date（本地 00:00）。格式不对返回 null，不抛错。 */
  function parseDay(s) {
    if (typeof s !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2], da = +m[3];
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    var d = new Date(y, mo - 1, da);
    /* 杀 2 月 30 日这种输入：Date 会自己滚到 3 月，滚过就说明原日期不合法 */
    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
    return d;
  }

  /** 'HH:MM' → 当天的分钟数（0..1439）。格式不对返回 null。 */
  function parseHm(s) {
    if (typeof s !== 'string') return null;
    var m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
    if (!m) return null;
    var h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }

  /** 把任意 Date 截到当天 00:00（本地） */
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  /** a - b，按【整天】算（都先截到 00:00）。跨月跨年跨闰月都对。 */
  function daysBetween(a, b) {
    return Math.round((startOfDay(a) - startOfDay(b)) / MS_DAY);
  }

  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }

  /** 周几：1=周一 … 7=周日。注意 getDay() 的周日是 0，别直接拿来当周几用。 */
  function isoDow(d) { var w = d.getDay(); return w === 0 ? 7 : w; }

  /** 这一周的周一（本地 00:00） */
  function mondayOf(d) { return addDays(startOfDay(d), -(isoDow(d) - 1)); }

  /* ==================================================================
     排序分数与紧迫度
     ================================================================== */

  /** 截断到 [-999, 999]：超过 999 天一律当 999（约 2.7 年后的事不分先后） */
  function clampDays(n) {
    if (n > 999) return 999;
    if (n < -999) return -999;
    return n;
  }

  /**
   * 排序分数 —— 越大越靠前。整数，没有浮点。
   *
   *     score = (999 - clamp(daysLeft, ±999)) * 100 + (重要 ? 50 : 0)
   *
   * 这样：
   *   · 没填 DDL            → 0（永远垫底，不管多重要 —— 没有日期就真的算不出急不急）
   *   · 已逾期 1 天 + 重要   → 100050
   *   · 今天截止            → 99900
   *   · 明天截止 + 重要     → 99850（+50 让"同样明天"时重要的压过不重要的）
   *   · 999 天后            → 0 + 50 —— 会被下面那条 tiebreak 排到没 DDL 的那批后面
   *
   * 注意"重要"只值 50 分 = 半天。这是故意的：四象限的排序由 DDL 主导，
   * 重要性只在"截止日相同"时起作用。
   */
  function scoreOf(item, now) {
    var dl = item.deadline;
    if (!dl || !dl.date) return 0;
    var d = parseDay(dl.date);
    if (!d) return 0;
    var left = daysBetween(d, now || new Date());
    return (999 - clampDays(left)) * 100 + (item.important ? 50 : 0);
  }

  /** 剩余天数。没 DDL / 坏日期 → null（注意：不是 0，0 是"今天截止"） */
  function daysLeftOf(item, now) {
    var dl = item.deadline;
    if (!dl || !dl.date) return null;
    var d = parseDay(dl.date);
    if (!d) return null;
    return daysBetween(d, now || new Date());
  }

  /** 紧迫度分档：'overdue' / 'today' / 'tomorrow' / 'urgent' / 'week' / 'later' / 'none' */
  function urgencyOf(item, now) {
    var left = daysLeftOf(item, now);
    if (left === null) return 'none';
    for (var i = 0; i < BUCKETS.length; i++) {
      var b = BUCKETS[i];
      if (b.max === null) return b.key;
      if (left <= b.max) return b.key;
    }
    return 'later';
  }

  /** 是否紧急：未完成 + 有 DDL + 剩余天数 <= urgentDays（含已逾期） */
  function isUrgent(item, now, urgentDays) {
    if (item.done) return false;
    var left = daysLeftOf(item, now);
    if (left === null) return false;
    var lim = typeof urgentDays === 'number' ? urgentDays : D.URGENT_DAYS;
    return left <= lim;
  }

  /** 落在哪个象限，返回 QUADRANTS 里的那一项。没 DDL 不算紧急 → 落 q2/q4。 */
  function quadrantOf(item, now, urgentDays) {
    var important = !!item.important;
    var urgent = isUrgent(item, now, urgentDays);
    for (var i = 0; i < QUADRANTS.length; i++) {
      var q = QUADRANTS[i];
      if (q.important === important && q.urgent === urgent) return q;
    }
    return QUADRANTS[3];
  }

  /* ==================================================================
     重复规则（日常任务）
     ================================================================== */

  function normalizeRepeat(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var kind = raw.kind;
    if (kind === 'daily') return { kind: 'daily' };
    if (kind === 'weekly') {
      var days = [];
      if (Object.prototype.toString.call(raw.days) === '[object Array]') {
        for (var i = 0; i < raw.days.length; i++) {
          var d = Math.round(Number(raw.days[i]));
          if (d >= 1 && d <= 7 && days.indexOf(d) < 0) days.push(d);
        }
      }
      days.sort(function (a, b) { return a - b; });
      if (!days.length) return null;
      return { kind: 'weekly', days: days };
    }
    if (kind === 'every') {
      var n = Math.round(Number(raw.n));
      if (!(n >= 1) || n > 365) return null;
      return { kind: 'every', n: n };
    }
    return null;
  }

  /** 是不是"日常"（有合法的重复规则） */
  function isRepeat(item) { return !!(item && item.repeat); }

  /**
   * 这一天该不该做这件事。
   * every 的锚点：任务创建那天（createdAt 的日期）。没有 createdAt 就当第 0 天是锚。
   */
  function dueOn(item, day) {
    var rep = item && item.repeat;
    if (!rep) return false;
    if (rep.kind === 'daily') return true;
    if (rep.kind === 'weekly') return rep.days.indexOf(isoDow(day)) >= 0;
    if (rep.kind === 'every') {
      var anchor = startOfDay(new Date(item.createdAt || Date.now()));
      var n = daysBetween(day, anchor);
      /* n < 0（比创建日还早）时 JS 的 % 会给负数，+n 再取模修回来 */
      return ((n % rep.n) + rep.n) % rep.n === 0;
    }
    return false;
  }

  /** 重复规则的中文说法，例如 '每天' / '每周 一、三、五' / '每隔 3 天' */
  function repeatText(item) {
    var rep = item && item.repeat;
    if (!rep) return '';
    if (rep.kind === 'daily') return '每天';
    if (rep.kind === 'every') return '每隔 ' + rep.n + ' 天';
    if (rep.kind === 'weekly') {
      var names = rep.days.map(function (d) { return DAY_NAMES[d].slice(1); });
      return '每周 ' + names.join('、');
    }
    return '';
  }

  /* ==================================================================
     打卡记录（日常任务的完成历史）
     ================================================================== */

  function normalizeLog(raw) {
    var out = [];
    if (Object.prototype.toString.call(raw) === '[object Array]') {
      var seen = {};
      for (var i = 0; i < raw.length; i++) {
        var s = raw[i];
        if (typeof s !== 'string' || !parseDay(s) || seen[s]) continue;
        seen[s] = 1;
        out.push(s);
      }
    }
    out.sort();
    return out;
  }

  /** 这一天勾过了吗 */
  function doneOn(item, day) {
    if (!item || !item.log) return false;
    return item.log.indexOf(ymd(day)) >= 0;
  }

  /** 今天这一格勾了没有（日常任务在列表里就显示这个） */
  function doneToday(item, now) { return doneOn(item, now || new Date()); }

  /**
   * 当前连续天数。
   * 从今天往回数：今天勾了就从今天算，今天还没勾就从昨天算（今天还没过完，
   * 不该把连续打断）。中间只要哪天该做而没做，就断。
   */
  function streakOf(item, now) {
    if (!isRepeat(item)) return 0;
    var today = startOfDay(now || new Date());
    var start = doneOn(item, today) ? today : addDays(today, -1);
    var n = 0;
    var cursor = start;
    /* 上限 3650 天，防止哪天数据坏了把浏览器转死 */
    for (var i = 0; i < 3650; i++) {
      if (!dueOn(item, cursor)) { cursor = addDays(cursor, -1); continue; }
      if (!doneOn(item, cursor)) break;
      n++;
      cursor = addDays(cursor, -1);
    }
    return n;
  }

  /** 历史上总共勾了多少次 */
  function totalChecks(item) { return item && item.log ? item.log.length : 0; }

  /**
   * 热力图数据：最近 weeks 周、每列一周（周一在上）、每天一格。
   * 返回 { start, cols: [{ days: [{ date, level, due, future }] }] }
   *   level 0 = 没做 / 1..2 = 做了（今天的格子给 2，看起来更醒目）
   *   due   false 表示那天本来就不用做（按重复规则算）
   *   future true 表示那天还没到
   */
  function heatmapOf(items, now, weeks) {
    var ref = startOfDay(now || new Date());
    var w = weeks > 0 ? weeks : 20;
    var monday = mondayOf(ref);
    /* 从 ref 往前数 (w-1) 个完整的周，再加上本周 —— 所以首列是这个周一
       往回 (w-1) 周，末列就是本周（含本周剩下的几天，"未来"用 future 标出来）。 */
    var first = addDays(monday, -(w - 1) * 7);
    var habits = [];
    for (var i = 0; i < items.length; i++) if (isRepeat(items[i])) habits.push(items[i]);

    var cols = [];
    for (var c = 0; c < w; c++) {
      var days = [];
      for (var r = 0; r < 7; r++) {
        var day = addDays(first, c * 7 + r);
        var due = false;
        var hits = [];
        for (var h = 0; h < habits.length; h++) {
          if (!dueOn(habits[h], day)) continue;
          due = true;
          if (doneOn(habits[h], day)) hits.push(habits[h].id);
        }
        /* 比"今天"晚就算未来。直接比 Date，别用 daysBetween —— 那个是"整天差"，
           会把今天也算成 0，语义上不够清楚。 */
        var future = day.getTime() > ref.getTime();
        /* 这一天在习惯上花了多少时间。计时按【开始时刻】归天，
           跟 byDay() 的规则一致，不然跨零点的那一段会劈成两半。 */
        var key = ymd(day);
        var ms = 0;
        for (var t = 0; t < habits.length; t++) {
          var ss = habits[t].sessions || [];
          for (var q = 0; q < ss.length; q++) {
            if (ymd(new Date(ss[q].start)) === key) ms += ss[q].ms;
          }
        }
        days.push({
          date: key,
          level: hits.length ? (day.getTime() === ref.getTime() ? 2 : 1) : 0,
          due: due,
          future: future,
          ms: ms,
          /* 时长热力：0 = 没做，1..4 = 越来越久（10 分钟 / 半小时 / 1 小时 / 2 小时以上） */
          tlvl: ms <= 0 ? 0 : (ms < 10 * 60000 ? 1 : ms < 30 * 60000 ? 2 : ms < 60 * 60000 ? 3 : 4),
          hits: hits
        });
      }
      cols.push({ days: days });
    }
    return { start: ymd(first), cols: cols };
  }

  /* ==================================================================
     鼓励的话 & 今天这一屏（用户要的"激励感"）
     ================================================================== */

  /**
   * 可以用哪些鼓励话。
   * 用户在设置里写了（按行分隔）就【只用】他写的 —— 自己写的话被随机换成
   * 系统自带的那句，比没有还烦人。没写就用 D 里自带的两池子。
   */
  function cheerPool(settings, kind) {
    var raw = settings && typeof settings.cheers === 'string' ? settings.cheers : '';
    var mine = [];
    var lines = raw.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].replace(/\s+/g, ' ').trim();
      if (t) mine.push(t.length > 40 ? t.slice(0, 40) : t);
    }
    if (mine.length) return mine;
    if (kind === 'day') return D.CHEERS_DAY.slice();
    if (kind === 'streak') return D.CHEERS_STREAK.slice();
    return D.CHEERS_TASK.slice();
  }

  /**
   * 挑一句鼓励。kind: 'task' | 'day' | 'streak'
   * seed 传进来的话就是确定性的（测试里用，也保证同一件事不会因为重渲染换台词）；
   * 不传就随机。
   * {n} 会被替换成 n（连续天数用）。
   */
  function cheerFor(settings, kind, seed, n) {
    var pool = cheerPool(settings, kind);
    if (!pool.length) return '';
    var idx;
    if (typeof seed === 'number' && isFinite(seed)) {
      idx = Math.abs(Math.round(seed)) % pool.length;
    } else {
      idx = Math.floor(Math.random() * pool.length) % pool.length;
    }
    var s = pool[idx];
    return s.replace(/\{n\}/g, n === undefined || n === null ? '' : String(n));
  }

  /** 做到了 n 次时有没有值得单说一句的（里程碑），没有返回 '' */
  function milestoneText(n) {
    for (var i = 0; i < D.MILESTONES.length; i++) {
      if (D.MILESTONES[i] === n) return '第 ' + n + ' 次打卡';
    }
    return '';
  }

  /**
   * 今天这一屏要显示哪些任务。
   * 和"四象限"的区别：四象限是给分析用的，这里只回答"我现在要碰什么"。
   * 返回 [{ key, title, hint, items }]，空组会被丢掉。
   */
  function focusGroups(doc, now) {
    var ref = startOfDay(now || new Date());
    var open = openTasks(doc);
    var over = [], today = [], tomorrow = [], later = [], someday = [];
    var i;
    for (i = 0; i < open.length; i++) {
      var it = open[i];
      if (isRepeat(it)) continue;              /* 日常在打卡区，不在这 */
      var left = daysLeftOf(it, ref);
      if (it.deadline && left !== null) {
        if (left < 0) over.push(it);
        else if (left === 0) today.push(it);
        else if (left === 1) tomorrow.push(it);
        else if (left <= 7) later.push(it);
        else someday.push(it);
      } else {
        someday.push(it);
      }
    }
    /* 组内按同一套算分排，保证顺序稳定、和别处一致 */
    [over, today, tomorrow, later, someday].forEach(function (arr) {
      arr.sort(comparator(doc.settings, ref));
    });

    var groups = [
      { key: 'over', title: '已经欠着的', hint: '先处理这些', items: over },
      { key: 'today', title: '今天截止', hint: '', items: today },
      { key: 'tomorrow', title: '明天截止', hint: '今天能先做就做掉', items: tomorrow },
      { key: 'later', title: '这周内', hint: '', items: later },
      { key: 'someday', title: '没定时间的', hint: '有空再碰', items: someday }
    ];
    var out = [];
    for (i = 0; i < groups.length; i++) if (groups[i].items.length) out.push(groups[i]);
    return out;
  }

  /**
   * 今天该碰的一共几件、还剩几件（进度条用）。
   * 只算"有期限且到期日 <= 今天"的和今天标记要做的 —— 不算明天以后的，
   * 否则进度条永远从 20% 开始，看着就泄气。
   */
  function todayProgress(doc, now) {
    var ref = startOfDay(now || new Date());
    var items = doc && doc.items ? doc.items : [];
    var due = 0, left = 0, done = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (isRepeat(it)) continue;
      var leftDays = daysLeftOf(it, ref);
      if (!it.deadline || leftDays === null || leftDays > 0) continue;
      due++;
      if (it.done) done++; else left++;
    }
    return { due: due, done: done, left: left };
  }

  /**
   * 今天过完了吗、值不值得说一句。
   * 返回 { n, text } —— n 是今天完成/打卡的总件数，text 是那句话（没有就 ''）。
   */
  function daySummary(doc, now) {
    var ref = startOfDay(now || new Date());
    var items = doc && doc.items ? doc.items : [];
    var stamp = ymd(ref);
    var doneToday = 0, checkedToday = 0, dueToday = 0, overdueLeft = 0;
    var i;
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      if (isRepeat(it)) {
        if (doneOn(it, ref)) checkedToday++;
        continue;
      }
      if (it.done) {
        /* doneAt 是时间戳；同一天算今天完成的 */
        if (it.doneAt && ymd(new Date(it.doneAt)) === stamp) doneToday++;
        continue;
      }
      var leftDays = daysLeftOf(it, ref);
      if (it.deadline && leftDays !== null) {
        if (leftDays < 0) overdueLeft++;
        else if (leftDays === 0) dueToday++;
      }
    }
    var n = doneToday + checkedToday;
    var text = '';
    if (overdueLeft === 0 && dueToday === 0 && n > 0) {
      text = cheerFor(doc && doc.settings, 'day', n);
    }
    return { n: n, doneToday: doneToday, checkedToday: checkedToday, dueToday: dueToday, overdueLeft: overdueLeft, text: text };
  }

  /**
   * 连着多少天有"完成记录"（完成任务或打卡）。今天还没做就从昨天算，
   * 不然早上一睁眼就显示 0，像被清零了。
   */
  function doneStreak(doc, now) {
    var ref = startOfDay(now || new Date());
    var items = doc && doc.items ? doc.items : [];
    function activeOn(day) {
      var stamp = ymd(day);
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.log && it.log.indexOf(stamp) >= 0) return true;
        if (it.doneAt && ymd(new Date(it.doneAt)) === stamp) return true;
      }
      return false;
    }
    var start = activeOn(ref) ? ref : addDays(ref, -1);
    var n = 0;
    var cursor = start;
    for (var k = 0; k < 3650; k++) {
      if (!activeOn(cursor)) break;
      n++;
      cursor = addDays(cursor, -1);
    }
    return n;
  }

  /* ==================================================================
     计时（每件事做了多久 / 日常打卡累计）
     ================================================================== */

  /* 一条计时记录的时长上限：24 小时。超过就当是"忘了停"，截平。
     （真有人一件小事做 24 小时吗？没有。但"忘了停"一觉睡醒是很常见的。） */
  var SESSION_CAP_MS = 24 * 3600 * 1000;
  /* 小于 5 秒的不记 —— 手滑点一下也会产生一条，攒多了全是噪音 */
  var SESSION_MIN_MS = 5 * 1000;

  /** 毫秒 → '1 小时 12 分' / '12 分 30 秒' / '45 秒'。传 0 返回 ''。 */
  function fmtDuration(ms) {
    var n = Math.round(Number(ms));
    if (!(n > 0)) return '';
    var totalSec = Math.floor(n / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    if (h > 0) return h + ' 小时' + (m > 0 ? ' ' + m + ' 分' : '');
    /* 分钟数小的时候把秒也带上（"12 分 30 秒"比"12 分"更有实感），
       过了一刻钟就只说分钟 —— 那时候秒已经不重要了。 */
    if (m > 0) return m + ' 分' + (s >= 1 && m < 15 ? ' ' + s + ' 秒' : '');
    return s + ' 秒';
  }

  /** 专注屏上用的大字：'01:12:05' / '12:05'。 */
  function fmtClock(ms) {
    var totalSec = Math.max(0, Math.floor(Number(ms) / 1000));
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    return (h > 0 ? pad2(h) + ':' : '') + pad2(m) + ':' + pad2(s);
  }

  /** 一条计时记录清洗。返回 null 表示丢掉。 */
  function normalizeSession(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var start = Math.round(Number(raw.start));
    if (!(start > 0)) return null;
    var end = Math.round(Number(raw.end));
    if (!(end > start)) end = start + Math.min(SESSION_CAP_MS, Math.max(0, Math.round(Number(raw.ms)) || 0));
    var ms = Math.round(Number(raw.ms));
    if (!(ms > 0)) ms = end - start;
    if (!(ms > 0)) return null;
    if (ms > SESSION_CAP_MS) ms = SESSION_CAP_MS;
    return { start: start, end: end, ms: ms };
  }

  function normalizeSessions(raw) {
    var out = [];
    if (Object.prototype.toString.call(raw) !== '[object Array]') return out;
    for (var i = 0; i < raw.length && out.length < 20000; i++) {
      var s = normalizeSession(raw[i]);
      if (s) out.push(s);
    }
    out.sort(function (a, b) { return a.start - b.start; });
    return out;
  }

  /** 一件任务一共花了多久（毫秒）。日常任务按"每天一条"累计。 */
  function timeOf(item) {
    if (!item || !item.sessions) return 0;
    var n = 0;
    for (var i = 0; i < item.sessions.length; i++) n += item.sessions[i].ms;
    return n;
  }

  /** 这件任务带得动文字版本的时长吗（没有就返回 ''，调用处好判断） */
  function timeTextOf(item) {
    return fmtDuration(timeOf(item));
  }

  /**
   * 日常任务：把 sessions 按【本地日期】归并成 { 'YYYY-MM-DD': ms }。
   * 用开始时刻所在的日期归天 —— 跨零点的那一次算在开始那天，
   * 不然一笔 25 分钟的计时会因为跨了零点被劈成两天。
   */
  function byDay(item) {
    var out = {};
    if (!item || !item.sessions) return out;
    for (var i = 0; i < item.sessions.length; i++) {
      var s = item.sessions[i];
      var key = ymd(new Date(s.start));
      out[key] = (out[key] || 0) + s.ms;
    }
    return out;
  }

  /** 所有任务在某一天各花了多久，返回 { 'YYYY-MM-DD': ms } */
  function dayTotals(items, now) {
    var out = {};
    var list = items || [];
    for (var i = 0; i < list.length; i++) {
      var d = byDay(list[i]);
      for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k)) out[k] = (out[k] || 0) + d[k];
    }
    return out;
  }

  /** 今天一共计了多久（毫秒），可以把正在走的那一段也算进去 */
  function todayTime(doc, now) {
    var ref = startOfDay(now || new Date());
    var key = ymd(ref);
    var totals = dayTotals((doc && doc.items) || [], ref);
    return totals[key] || 0;
  }

  /**
   * 正在计时的那个任务和已经走了多久。
   * 一律用【时间戳相减】算，不靠"每秒加一" —— iOS 上切后台/锁屏会把
   * setInterval 冻住，靠累加会少算一大截。返回 { id, item, startedAt, elapsed } 或 null。
   */
  function runningTimer(doc, now) {
    var t = doc && doc.timer;
    if (!t || !t.taskId) return null;
    var item = getItem(doc, t.taskId);
    if (!item) return null;
    var at = Math.round(Number(t.startedAt));
    if (!(at > 0)) return null;
    var ms = Math.max(0, (now || new Date()).getTime() - at);
    return { id: t.taskId, item: item, startedAt: at, elapsed: Math.min(ms, SESSION_CAP_MS) };
  }

  /**
   * 开始给某件事计时。同一时间只允许一件 —— 已经在计另一件就返回 { error }。
   * 返回 { doc, timer }。
   */
  function startTimer(doc, taskId, now) {
    var at = (now || new Date()).getTime();
    var item = getItem(doc, taskId);
    if (!item) return { error: 'NOT_FOUND' };
    var run = runningTimer(doc, now || new Date());
    if (run && run.id === taskId) return { doc: doc, timer: doc.timer, already: true };
    if (run) return { error: 'BUSY', running: run };
    var next = clone(doc);
    next.timer = { taskId: taskId, startedAt: at };
    return { doc: next, timer: next.timer };
  }

  /**
   * 结束计时并落一条记录。
   * 返回 { doc, ms, session, dropped }：dropped=true 表示太短（<5 秒）没记。
   */
  function stopTimer(doc, now) {
    var at = (now || new Date()).getTime();
    var run = runningTimer(doc, now || new Date());
    if (!run) return null;
    var next = clone(doc);
    next.timer = null;
    var ms = Math.min(SESSION_CAP_MS, Math.max(0, at - run.startedAt));
    var dropped = ms < SESSION_MIN_MS;
    var session = null;
    if (!dropped) {
      session = { start: run.startedAt, end: at, ms: ms };
      for (var i = 0; i < next.items.length; i++) {
        if (next.items[i].id !== run.id) continue;
        if (!next.items[i].sessions) next.items[i].sessions = [];
        next.items[i].sessions.push(session);
        next.items[i].updatedAt = at;
        break;
      }
    }
    return { doc: next, ms: ms, session: session, dropped: dropped };
  }

  /** 丢掉正在计时的那一段（点错了 / 不想记） */
  function cancelTimer(doc) {
    var next = clone(doc);
    next.timer = null;
    return next;
  }

  /** 改某一条记录的长短（分钟）。返回新文档；找不到返回 null。 */
  function setSessionMs(doc, taskId, index, ms) {
    var next = clone(doc);
    for (var i = 0; i < next.items.length; i++) {
      if (next.items[i].id !== taskId) continue;
      var list = next.items[i].sessions || [];
      if (index < 0 || index >= list.length) return null;
      var n = Math.round(Number(ms));
      if (!(n > 0)) n = 1000;
      if (n > SESSION_CAP_MS) n = SESSION_CAP_MS;
      list[index].ms = n;
      list[index].end = list[index].start + n;
      next.items[i].updatedAt = Date.now();
      return next;
    }
    return null;
  }

  /** 删掉某一条记录 */
  function removeSession(doc, taskId, index) {
    var next = clone(doc);
    for (var i = 0; i < next.items.length; i++) {
      if (next.items[i].id !== taskId) continue;
      if (!next.items[i].sessions || index < 0 || index >= next.items[i].sessions.length) return null;
      next.items[i].sessions.splice(index, 1);
      next.items[i].updatedAt = Date.now();
      return next;
    }
    return null;
  }

  /* ==================================================================
     规范化（坏数据不许把页面搞崩）
     ================================================================== */

  var TITLE_MAX = 200;
  var NOTE_MAX = 2000;
  var MAX_ITEMS = 2000;

  function cleanText(s, max) {
    if (typeof s !== 'string') return '';
    var t = s.replace(/\s+/g, ' ').trim();
    if (t.length > max) t = t.slice(0, max);
    return t;
  }

  /** 单条任务清洗。返回 null 表示这条救不回来，直接丢掉。 */
  function normalizeItem(raw, fallbackId) {
    if (!raw || typeof raw !== 'object') return null;
    var id = Math.round(Number(raw.id));
    if (!(id > 0)) id = fallbackId;
    if (!(id > 0)) return null;
    var title = cleanText(raw.title, TITLE_MAX);
    if (!title) return null;

    var createdAt = Math.round(Number(raw.createdAt));
    if (!(createdAt > 0)) createdAt = Date.now();
    var updatedAt = Math.round(Number(raw.updatedAt));
    if (!(updatedAt > 0)) updatedAt = createdAt;

    var deadline = null;
    if (raw.deadline && typeof raw.deadline === 'object') {
      var dstr = typeof raw.deadline.date === 'string' && parseDay(raw.deadline.date)
        ? raw.deadline.date.trim()
        : null;
      if (dstr) {
        var hstr = parseHm(raw.deadline.time) !== null ? raw.deadline.time.trim() : '';
        deadline = { date: dstr, time: hstr };
      }
    }

    var repeat = normalizeRepeat(raw.repeat);
    var done = raw.done === true;
    var doneAt = Math.round(Number(raw.doneAt));
    if (!(doneAt > 0)) doneAt = 0;
    /* 日常任务不用 done 表示状态（它每天重新开始），所以强制抹掉 */
    if (repeat) { done = false; doneAt = 0; }

    var item = {
      id: id,
      title: title,
      note: cleanText(raw.note, NOTE_MAX),
      important: raw.important === true,
      deadline: deadline,
      repeat: repeat,
      done: done,
      doneAt: doneAt,
      createdAt: createdAt,
      updatedAt: updatedAt
    };
    if (repeat) item.log = normalizeLog(raw.log);
    /* 计时记录：普通任务和日常都可能有时长（日常是每天一条） */
    var sessions = normalizeSessions(raw.sessions);
    if (sessions.length) item.sessions = sessions;
    return item;
  }

  var THEME_KEYS = D.THEMES.map(function (t) { return t.key; });
  var VIEW_KEYS = D.VIEWS.map(function (v) { return v.key; });
  var SORT_KEYS = D.SORTS.map(function (s) { return s.key; });

  function normalizeSettings(raw) {
    var out = {
      theme: D.DEFAULTS.theme,
      view: D.DEFAULTS.view,
      sort: D.DEFAULTS.sort,
      soonDays: D.DEFAULTS.soonDays,
      urgentDays: D.DEFAULTS.urgentDays,
      cheers: D.DEFAULTS.cheers,
      celebrate: D.DEFAULTS.celebrate
    };
    if (!raw || typeof raw !== 'object') return out;
    if (THEME_KEYS.indexOf(raw.theme) >= 0) out.theme = raw.theme;
    if (VIEW_KEYS.indexOf(raw.view) >= 0) out.view = raw.view;
    if (SORT_KEYS.indexOf(raw.sort) >= 0) out.sort = raw.sort;
    var sd = Math.round(Number(raw.soonDays));
    if (sd >= 1 && sd <= 60) out.soonDays = sd;
    var ud = Math.round(Number(raw.urgentDays));
    if (ud >= 0 && ud <= 30) out.urgentDays = ud;
    /* 自己写的鼓励话：只留非空行，每行截 40 字，最多 20 行 */
    if (typeof raw.cheers === 'string') {
      var keep = [];
      var lines = raw.cheers.split('\n');
      for (var i = 0; i < lines.length && keep.length < 20; i++) {
        var t = lines[i].replace(/\s+/g, ' ').trim();
        if (t) keep.push(t.length > 40 ? t.slice(0, 40) : t);
      }
      out.cheers = keep.join('\n');
    }
    /* 只认真正的布尔值：'false' 这种字符串不能被当成 true */
    if (typeof raw.celebrate === 'boolean') out.celebrate = raw.celebrate;
    return out;
  }

  /**
   * 整份文档清洗：丢重复 id、丢空标题、把 seq 抬到不小于最大 id。
   * 兼容两种输入：{seq, items, settings} 或直接一个 items 数组。
   */
  function normalize(raw) {
    var seq = 0, items = [], settings = raw && raw.settings;
    var timer = null;
    if (Object.prototype.toString.call(raw) === '[object Array]') {
      items = raw;
    } else if (raw && typeof raw === 'object') {
      seq = Math.round(Number(raw.seq));
      if (!(seq > 0)) seq = 0;
      if (Object.prototype.toString.call(raw.items) === '[object Array]') items = raw.items;
      /* 正在计时的那一段。taskId 指向不存在的任务就当没有（任务被删了） */
      if (raw.timer && typeof raw.timer === 'object') {
        var tid = Math.round(Number(raw.timer.taskId));
        var sat = Math.round(Number(raw.timer.startedAt));
        if (tid > 0 && sat > 0) timer = { taskId: tid, startedAt: sat };
      }
    }

    var out = [];
    var seen = {};
    for (var i = 0; i < items.length && out.length < MAX_ITEMS; i++) {
      var it = normalizeItem(items[i], 0);
      if (!it) continue;
      if (seen[it.id]) continue;
      seen[it.id] = 1;
      out.push(it);
      if (it.id > seq) seq = it.id;
    }

    var doc = { version: 1, seq: seq, items: out, settings: normalizeSettings(settings), timer: null };
    if (timer && seen[timer.taskId]) doc.timer = timer;
    return doc;
  }

  /* ==================================================================
     增删改 —— 都是「吃旧文档、吐新文档」，不改传进来的对象
     ================================================================== */

  function clone(doc) { return normalize(doc); }

  function requireTitle(title) {
    var t = cleanText(title, TITLE_MAX);
    if (!t) {
      var err = new Error('任务名字不能是空的');
      err.code = 'EMPTY_TITLE';
      throw err;
    }
    return t;
  }

  function buildItem(input, id) {
    var now = Date.now();
    var item = {
      id: id,
      title: requireTitle(input.title),
      note: cleanText(input.note, NOTE_MAX),
      important: input.important === true,
      deadline: null,
      repeat: normalizeRepeat(input.repeat),
      done: false,
      doneAt: 0,
      createdAt: now,
      updatedAt: now
    };
    if (input.deadline && typeof input.deadline === 'object' && input.deadline.date) {
      var dstr = parseDay(input.deadline.date) ? input.deadline.date.trim() : null;
      if (dstr) {
        item.deadline = {
          date: dstr,
          time: parseHm(input.deadline.time) !== null ? input.deadline.time.trim() : ''
        };
      }
    }
    if (item.repeat) item.log = [];
    return item;
  }

  function addItem(doc, input, nowMs) {
    var next = clone(doc);
    var id = next.seq + 1;
    var item = buildItem(input || {}, id);
    if (typeof nowMs === 'number') { item.createdAt = nowMs; item.updatedAt = nowMs; }
    next.seq = id;
    next.items.push(item);
    return { doc: next, item: item };
  }

  /** 局部修改。title 传空字符串会被拒（跟新增一样严）。 */
  function updateItem(doc, id, patch, nowMs) {
    var next = clone(doc);
    for (var i = 0; i < next.items.length; i++) {
      if (next.items[i].id !== id) continue;
      var it = next.items[i];
      var p = patch || {};
      if ('title' in p) it.title = requireTitle(p.title);
      if ('note' in p) it.note = cleanText(p.note, NOTE_MAX);
      if ('important' in p) it.important = p.important === true;
      if ('deadline' in p) {
        it.deadline = null;
        if (p.deadline && p.deadline.date && parseDay(p.deadline.date)) {
          it.deadline = {
            date: p.deadline.date.trim(),
            time: parseHm(p.deadline.time) !== null ? p.deadline.time.trim() : ''
          };
        }
      }
      if ('repeat' in p) {
        it.repeat = normalizeRepeat(p.repeat);
        if (it.repeat) {
          it.done = false;
          it.doneAt = 0;
          if (!it.log) it.log = [];
        } else {
          delete it.log;
        }
      }
      it.updatedAt = typeof nowMs === 'number' ? nowMs : Date.now();
      return { doc: next, item: it };
    }
    return null;
  }

  function removeItem(doc, id) {
    var next = clone(doc);
    var before = next.items.length;
    next.items = next.items.filter(function (it) { return it.id !== id; });
    return next.items.length === before ? null : next;
  }

  function getItem(doc, id) {
    for (var i = 0; i < doc.items.length; i++) if (doc.items[i].id === id) return doc.items[i];
    return null;
  }

  /**
   * 勾 / 取消勾。
   *   · 普通任务：done 取反。
   *   · 日常任务：把【今天】加进 / 移出 log，done 字段永远保持 false。
   * 返回 { doc, item, checked } 或 null（找不到 id）。
   */
  function toggle(doc, id, now) {
    var next = clone(doc);
    var day = now || new Date();
    for (var i = 0; i < next.items.length; i++) {
      if (next.items[i].id !== id) continue;
      var it = next.items[i];
      it.updatedAt = day.getTime();
      if (isRepeat(it)) {
        var key = ymd(day);
        var at = it.log.indexOf(key);
        if (at >= 0) it.log.splice(at, 1);
        else it.log.push(key);
        it.log.sort();
        return { doc: next, item: it, checked: at < 0 };
      }
      it.done = !it.done;
      it.doneAt = it.done ? day.getTime() : 0;
      return { doc: next, item: it, checked: it.done };
    }
    return null;
  }

  /* ==================================================================
     挑与排
     ================================================================== */

  /** 普通任务（不含日常）、未完成、不在归档里 */
  function openTasks(doc) {
    return doc.items.filter(function (it) { return !isRepeat(it) && !it.done; });
  }

  function doneTasks(doc) {
    return doc.items.filter(function (it) { return !isRepeat(it) && it.done; });
  }

  function habits(doc) {
    return doc.items.filter(function (it) { return isRepeat(it); });
  }

  var WEIGHT_IMPORTANT = 50;

  /**
   * 排序器。返回一个 comparator，直接丢给 Array.prototype.sort。
   * 一律先按分数（大到小），分数相同时按"谁先加的"（早的在前），
   * 最后用 id 兜底 —— 保证同一批数据排出来的顺序永远一样（比较器必须稳定，
   * 否则截图和测试都会随机飘）。
   */
  function comparator(doc, sortKey, now) {
    var s = sortKey || doc.settings.sort || 'auto';
    return function (a, b) {
      if (s === 'auto') {
        var d = scoreOf(b, now) - scoreOf(a, now);
        if (d) return d;
      } else if (s === 'ddl') {
        var da = a.deadline ? a.deadline.date + (a.deadline.time || '') : '\uffff';
        var db = b.deadline ? b.deadline.date + (b.deadline.time || '') : '\uffff';
        if (da !== db) return da < db ? -1 : 1;
      } else if (s === 'created') {
        if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
      }
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.id - b.id;
    };
  }

  /**
   * 分成四象限 + 没 DDL 的一堆。
   * 没填 DDL 的落 q2（重要）或 q4（不重要），它们本来就在那个象限里，
   * 只是排序时被分数压到最后 —— 这是设计如此，不是 bug。
   */
  function byQuadrant(doc, now) {
    var out = { q1: [], q2: [], q3: [], q4: [] };
    var cmp = comparator(doc, 'auto', now);
    var list = openTasks(doc).slice().sort(cmp);
    for (var i = 0; i < list.length; i++) {
      out[quadrantOf(list[i], now, doc.settings.urgentDays).key].push(list[i]);
    }
    return out;
  }

  /** 一条平整的清单（按当前排序设置） */
  function flatList(doc, now) {
    return openTasks(doc).slice().sort(comparator(doc, doc.settings.sort, now));
  }

  /** 逾期没做的（不管重不重要），最新的逾期排前面 */
  function overdueTasks(doc, now) {
    return openTasks(doc).filter(function (it) {
      var left = daysLeftOf(it, now);
      return left !== null && left < 0;
    }).sort(comparator(doc, 'auto', now));
  }

  /** 最近要交的：还有 soonDays 天以内（含逾期）的未完成任务 */
  function soonTasks(doc, now) {
    var lim = doc.settings.soonDays;
    return openTasks(doc).filter(function (it) {
      var left = daysLeftOf(it, now);
      return left !== null && left <= lim;
    }).sort(comparator(doc, 'auto', now));
  }

  function search(doc, q) {
    var key = cleanText(q, 100).toLowerCase();
    if (!key) return null;
    return doc.items.filter(function (it) {
      return it.title.toLowerCase().indexOf(key) >= 0 ||
        (it.note && it.note.toLowerCase().indexOf(key) >= 0);
    });
  }

  function stats(doc, now) {
    var open = openTasks(doc);
    var done = doneTasks(doc);
    var hs = habits(doc);
    var overdue = 0, todayDue = 0;
    for (var i = 0; i < open.length; i++) {
      var left = daysLeftOf(open[i], now);
      if (left === null) continue;
      if (left < 0) overdue++;
      else if (left === 0) todayDue++;
    }
    var checkedToday = 0;
    for (var h = 0; h < hs.length; h++) if (doneToday(hs[h], now)) checkedToday++;
    return {
      open: open.length,
      done: done.length,
      overdue: overdue,
      todayDue: todayDue,
      habits: hs.length,
      checkedToday: checkedToday
    };
  }

  /* ==================================================================
     显示用的文案
     ================================================================== */

  /** '10/5' */
  function fmtMd(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }

  /** '2026-10-10' → '10/10'；今天/明天/昨天特殊说法 */
  function whenText(item, now) {
    var left = daysLeftOf(item, now);
    if (left === null) return '没定时间';
    if (left === 0) return '今天';
    if (left === 1) return '明天';
    if (left === -1) return '昨天';
    if (left < 0) return '逾期 ' + (-left) + ' 天';
    if (left < 7) return left + ' 天后';
    var d = parseDay(item.deadline.date);
    return fmtMd(d);
  }

  /** DDL 完整说法：'10/10 今天 23:59' / '10/15 周四 18:00' / '没定时间' */
  function deadlineText(item, now) {
    if (!item.deadline) return '没定时间';
    var d = parseDay(item.deadline.date);
    if (!d) return '没定时间';
    var s = fmtMd(d) + ' ' + DAY_NAMES[isoDow(d)];
    if (item.deadline.time) s += ' ' + item.deadline.time;
    return s;
  }

  /** 距离 DDL 还有多久，给提示条用：'还有 3 天 4 小时' */
  function countdownText(item, now) {
    var left = daysLeftOf(item, now);
    if (left === null) return '';
    if (left < 0) return '已经过了 ' + (-left) + ' 天';
    var t = now || new Date();
    if (left === 0) {
      if (!item.deadline.time) return '今天截止';
      var mins = parseHm(item.deadline.time) - (t.getHours() * 60 + t.getMinutes());
      if (mins <= 0) return '今天截止（时间已过）';
      return '还有 ' + Math.floor(mins / 60) + ' 小时 ' + (mins % 60) + ' 分钟';
    }
    return '还有 ' + left + ' 天';
  }

  function quadrantName(key) {
    for (var i = 0; i < QUADRANTS.length; i++) if (QUADRANTS[i].key === key) return QUADRANTS[i].title;
    return '';
  }

  /* ==================================================================
     导出
     ================================================================== */

  var API = {
    /* 日期 */
    pad2: pad2, ymd: ymd, hm: hm, parseDay: parseDay, parseHm: parseHm,
    startOfDay: startOfDay, daysBetween: daysBetween, addDays: addDays,
    isoDow: isoDow, mondayOf: mondayOf, DAY_NAMES: DAY_NAMES,

    /* 分数与象限 */
    scoreOf: scoreOf, daysLeftOf: daysLeftOf, urgencyOf: urgencyOf,
    isUrgent: isUrgent, quadrantOf: quadrantOf, clampDays: clampDays,
    WEIGHT_IMPORTANT: WEIGHT_IMPORTANT,

    /* 重复与打卡 */
    normalizeRepeat: normalizeRepeat, isRepeat: isRepeat, dueOn: dueOn,
    repeatText: repeatText, normalizeLog: normalizeLog, doneOn: doneOn,
    doneToday: doneToday, streakOf: streakOf, totalChecks: totalChecks,
    heatmapOf: heatmapOf,

    /* 规范化 */
    normalizeItem: normalizeItem, normalizeSettings: normalizeSettings,
    normalize: normalize, cleanText: cleanText,
    TITLE_MAX: TITLE_MAX, NOTE_MAX: NOTE_MAX, MAX_ITEMS: MAX_ITEMS,

    /* 增删改 */
    addItem: addItem, updateItem: updateItem, removeItem: removeItem,
    getItem: getItem, toggle: toggle,

    /* 挑与排 */
    comparator: comparator, byQuadrant: byQuadrant, flatList: flatList,
    openTasks: openTasks, doneTasks: doneTasks, habits: habits,
    overdueTasks: overdueTasks, soonTasks: soonTasks, search: search, stats: stats,

    /* 鼓励 & 今天这一屏 */
    cheerPool: cheerPool, cheerFor: cheerFor, milestoneText: milestoneText,
    focusGroups: focusGroups, todayProgress: todayProgress,
    daySummary: daySummary, doneStreak: doneStreak,

    /* 计时 */
    fmtDuration: fmtDuration, fmtClock: fmtClock,
    normalizeSession: normalizeSession, normalizeSessions: normalizeSessions,
    timeOf: timeOf, timeTextOf: timeTextOf, byDay: byDay, dayTotals: dayTotals,
    todayTime: todayTime, runningTimer: runningTimer,
    startTimer: startTimer, stopTimer: stopTimer, cancelTimer: cancelTimer,
    setSessionMs: setSessionMs, removeSession: removeSession,
    SESSION_CAP_MS: SESSION_CAP_MS, SESSION_MIN_MS: SESSION_MIN_MS,

    /* 文案 */
    fmtMd: fmtMd, whenText: whenText, deadlineText: deadlineText,
    countdownText: countdownText, quadrantName: quadrantName
  };

  root.TodoCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
