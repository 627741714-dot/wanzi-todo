/* 丸梓todo —— 界面
 *
 * 分工：src/data.js 管数据长什么样，src/todo-core.js 管算（纯逻辑、可测），
 * 这个文件只管"画出来"和"怎么点"。所以逻辑的 bug 都能在 node 里测出来。
 *
 * 三个必须知道的约定：
 *   1. nowDate() 是唯一的"现在"。测试和截图用 window.__T.setNow(...) 假装时间，
 *      别的代码一律不许直接 new Date() 取当下 —— 否则截图里的"今天"会随机变。
 *   2. 存设置必须【写进去再读回来比对】，不一致就弹顶部红条。绝不许静默降级。
 *   3. 所有列表的点击都用事件委托挂在容器上（不是每条都绑），
 *      因为重新渲染会把 DOM 整个换掉，绑在旧节点上的监听会一起消失。
 */
(function () {
  'use strict';

  var D = window.TodoData;
  var C = window.TodoCore;
  var META = D.META;

  var LS_KEY = META.storageKey;

  var state = {
    doc: C.normalize(null),
    query: '',
    doneOpen: false,
    sheet: '',          // '' | 'edit' | 'set'
    editing: 0,         // 正在编辑的任务 id，0 表示新建
    nowOverride: null,
    storageOk: true,
    storageMsg: ''
  };

  /* ------------------------------------------------------------------ DOM */

  var el = {};
  [
    'storageWarn', 'storageWarnText', 'hdSub', 'btnSheet', 'tick', 'tickDot', 'tickText', 'tickBars',
    'searchIn', 'searchX', 'pane', 'paneInner', 'hint', 'ftCount',
    'secSoon', 'soon', 'soonN', 'secHabit', 'habits', 'habitN', 'heatWrap', 'heat',
    'secQuad', 'quads', 'secSearchResult', 'searchHits',
    'secDone', 'doneHead', 'doneN', 'doneTri', 'doneList',
    'fab',
    'editMask', 'edit', 'edTitle', 'edClose', 'edTitleIn', 'edNote', 'edImp', 'impNote',
    'fldDeadline', 'edQuick', 'edDate', 'edTime', 'dlNote', 'edRepeat', 'edDays', 'edEvery',
    'edEveryN', 'repNote', 'edErr', 'edSave', 'edToggle', 'edDel',
    'setMask', 'set', 'setClose', 'themeChips', 'viewChips', 'sortChips', 'sortNote',
    'urgentChips', 'legend', 'bkExport', 'bkCopy', 'bkText', 'bkPick', 'bkMerge', 'bkReplace',
    'bkFile', 'bkMsg', 'setDone'
  ].forEach(function (id) { el[id] = document.getElementById(id); });

  /**
   * 启动前先把"该有的节点"点一遍名。
   * 少一个节点的话，症状会是某处莫名其妙的 "Cannot read properties of undefined"，
   * 找起来很费劲 —— 这里直接说清楚是哪个 id 没了。改 HTML 时如果删了某个 id，
   * 这句会立刻告诉你。
   */
  function assertNodes() {
    var missing = [];
    for (var k in el) {
      if (!Object.prototype.hasOwnProperty.call(el, k)) continue;
      if (!el[k]) missing.push(k);
    }
    if (missing.length) {
      throw new Error('页面上缺少这些节点：' + missing.join(', ') + '（检查 丸梓todo.html 里的 id）');
    }
  }

  function nowDate() {
    return state.nowOverride ? new Date(state.nowOverride.getTime()) : new Date();
  }

  /* -------------------------------------------------------------- 存与读 */

  var KEY_SETTINGS = 'settings';
  var KEY_DOC = 'doc';

  /* 一份只读的"设置快照"，用来做"写进去再读回来"的校验 */
  function settingsSnapshot() {
    return {
      theme: state.doc.settings.theme,
      view: state.doc.settings.view,
      sort: state.doc.settings.sort,
      urgentDays: state.doc.settings.urgentDays,
      soonDays: state.doc.settings.soonDays
    };
  }

  function save() {
    var payload = { version: 1, seq: state.doc.seq, items: state.doc.items, settings: state.doc.settings };
    var text = JSON.stringify(payload);
    try {
      window.localStorage.setItem(LS_KEY, text);
      /* 写进去再读回来，逐字节比对。不同就说明存储被限制了，必须让用户看见。 */
      var back = window.localStorage.getItem(LS_KEY);
      if (back !== text) throw new Error('写进去的和读回来的不一样');
      if (!state.storageOk) { state.storageOk = true; state.storageMsg = ''; paintWarn(); }
      return true;
    } catch (e) {
      state.storageOk = false;
      state.storageMsg = '这个浏览器不让存数据（可能是隐私模式，或者存储被禁了）。页面能用，但你一关就全丢。请先点右上角，把数据导出成文件收好。';
      paintWarn();
      return false;
    }
  }

  /**
   * 探一次存储：写进去 -> 读回来逐字节比对 -> 删掉。
   *
   * 为什么要主动探：只靠 save() 里的校验的话，一个【空清单】的新用户（从来没存过
   * 任何东西）在隐私模式下打开页面，会看到一切正常、一条警告都没有 —— 直到他辛苦
   * 加了一堆任务才发现存不住。必须在打开的那一刻就告诉他。
   */
  function probeStorage() {
    var probe = LS_KEY + '.probe';
    var token = 'ok-' + Date.now();
    try {
      window.localStorage.setItem(probe, token);
      var back = window.localStorage.getItem(probe);
      window.localStorage.removeItem(probe);
      if (back !== token) throw new Error('写进去的和读回来的不一样');
      state.storageOk = true;
      state.storageMsg = '';
    } catch (e) {
      state.storageOk = false;
      state.storageMsg = '这个浏览器不让存数据（可能是隐私模式，或者存储被禁了）。页面能用，但你一关就全丢。请先点右上角，把数据导出成文件收好。';
    }
  }

  function load() {
    var raw = null;
    try {
      raw = window.localStorage.getItem(LS_KEY);
    } catch (e) {
      if (state.storageOk) {
        state.storageOk = false;
        state.storageMsg = '这个浏览器不让读数据（可能是隐私模式，或者存储被禁了）。页面能用，但你一关就全丢。请先点右上角，把数据导出成文件收好。';
      }
      return;
    }
    if (!raw) return;
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    state.doc = C.normalize(parsed);
  }

  function paintWarn() {
    if (!el.storageWarn) return;
    el.storageWarn.hidden = state.storageOk;
    if (!state.storageOk && el.storageWarnText) el.storageWarnText.textContent = state.storageMsg;
  }

  /* ------------------------------------------------------------ 小工具 */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.6 16.6 5 12l-1.6 1.6 6.2 6.2L20.8 8.6 19.2 7 9.6 16.6Z" fill="currentColor"/></svg>';

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  /* ================================================================ 画 */

  function render() {
    var now = nowDate();
    renderHeader();
    renderTick(now);
    renderSoon(now);
    renderHabits(now);
    renderQuads(now);
    renderSearch(now);
    renderDone(now);
    renderFooter();
    paintSheet();
  }

  function renderHeader() {
    el.hdSub.textContent = META.tagline;
  }

  /* ------------------------------------------------------------ 提示条 */

  function renderTick(now) {
    var overdue = C.overdueTasks(state.doc, now);
    var soon = C.soonTasks(state.doc, now);
    var habits = C.habits(state.doc);
    var checkedToday = habits.filter(function (h) { return C.doneToday(h, now); }).length;
    var st = C.stats(state.doc, now);

    var text = '';
    var cls = '';

    if (overdue.length) {
      var worst = overdue[0];
      text = '<b>' + esc(worst.title) + '</b> 已经逾期 ' + (-C.daysLeftOf(worst, now)) + ' 天' +
        (overdue.length > 1 ? '（还有 ' + (overdue.length - 1) + ' 件逾期的）' : '');
      cls = 'is-alert';
    } else if (soon.length) {
      var next = soon[0];
      text = '最近要交：<b>' + esc(next.title) + '</b> · ' + C.countdownText(next, now);
      cls = C.urgencyOf(next, now) === 'today' || C.urgencyOf(next, now) === 'overdue' ? 'is-alert' : '';
    } else if (habits.length) {
      if (checkedToday === habits.length) {
        text = '今天的日常全打卡了，' + habits.length + '/' + habits.length + ' ✓';
        cls = 'is-good';
      } else {
        text = '日常还没打卡：' + (habits.length - checkedToday) + ' 件等着你';
      }
    } else if (st.open) {
      text = '手上有 <b>' + st.open + '</b> 件没做完，都没定时间';
    } else {
      text = '一条待办都没有，清静 ✓';
      cls = 'is-good';
    }

    el.tick.className = 'tick' + (cls ? ' ' + cls : '');
    el.tickText.innerHTML = text;

    /* 进度条：每一格是一件没做完的事，做完的格子亮起来 */
    var total = st.open + st.done + st.habits;
    var cells = Math.min(20, Math.max(0, total));
    var onCells = total ? Math.round(cells * ((st.done + st.checkedToday) / total)) : 0;
    var html = '';
    for (var i = 0; i < cells; i++) html += '<i class="' + (i < onCells ? 'on' : '') + '"></i>';
    el.tickBars.innerHTML = html;
  }

  /* ------------------------------------------------------ 最近要交的 */

  function renderSoon(now) {
    var list = C.soonTasks(state.doc, now);
    if (!list.length) { el.secSoon.hidden = true; el.soon.innerHTML = ''; return; }
    el.secSoon.hidden = false;
    el.soonN.textContent = list.length + ' 件';
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      var u = C.urgencyOf(it, now);
      html += '<button class="soon-card t-' + u + '" type="button" data-open="' + it.id + '">' +
        '<span class="soon-t">' + (it.important ? '<span class="tk-star">★</span>' : '') + esc(it.title) + '</span>' +
        '<span class="soon-w">' + esc(C.whenText(it, now)) +
        (it.deadline && it.deadline.time ? ' ' + esc(it.deadline.time) : '') + '</span>' +
        '</button>';
    }
    el.soon.innerHTML = html;
  }

  /* ------------------------------------------------------------ 日常 */

  function renderHabits(now) {
    var list = C.habits(state.doc);
    if (!list.length) { el.secHabit.hidden = true; el.habits.innerHTML = ''; return; }
    el.secHabit.hidden = false;

    /* 今天该做的排前面，然后是还没勾的，最后按 id 稳定 */
    var dueToday = [];
    var rest = [];
    for (var i = 0; i < list.length; i++) {
      if (C.dueOn(list[i], now)) dueToday.push(list[i]);
      else rest.push(list[i]);
    }
    dueToday.sort(function (a, b) {
      var da = C.doneToday(a, now) ? 1 : 0, db = C.doneToday(b, now) ? 1 : 0;
      if (da !== db) return da - db;
      return a.id - b.id;
    });
    rest.sort(function (a, b) { return a.id - b.id; });
    var ordered = dueToday.concat(rest);

    var doneN = 0, dueN = 0;
    var html = '';
    for (var j = 0; j < ordered.length; j++) {
      var h = ordered[j];
      var on = C.doneToday(h, now);
      var due = C.dueOn(h, now);
      if (due) { dueN++; if (on) doneN++; }
      var streak = C.streakOf(h, now);
      html += '<div class="habit' + (on ? ' is-on' : '') + '" data-habit="' + h.id + '">' +
        '<button class="tk-check' + (on ? ' on' : '') + '" type="button" data-habit="' + h.id + '" aria-label="打卡">' + CHECK_SVG + '</button>' +
        '<div class="habit-main">' +
        '<span class="habit-t">' + esc(h.title) + '</span>' +
        '<div class="habit-meta">' +
        '<span class="tk-rep">' + esc(C.repeatText(h)) + '</span>' +
        (due ? '' : '<span>今天不用做</span>') +
        (streak >= 2 ? '<span>连着 ' + streak + ' 次了</span>' : '') +
        '</div></div>' +
        '<div class="habit-streak"><b>' + streak + '</b>连续</div>' +
        '</div>';
    }
    el.habits.innerHTML = html;
    el.habitN.textContent = dueN ? (doneN + '/' + dueN + ' 今天') : '今天都歇着';

    el.heatWrap.hidden = false;
    el.heat.innerHTML = heatHtml(now);
  }

  function heatHtml(now) {
    var hm = C.heatmapOf(state.doc.items, now, 20);
    var html = '';
    for (var c = 0; c < hm.cols.length; c++) {
      for (var r = 0; r < 7; r++) {
        var d = hm.cols[c].days[r];
        var cls = 'heat-cell';
        if (d.level === 1) cls += ' lv1';
        else if (d.level === 2) cls += ' lv2';
        else if (d.due && !d.future) cls += ' due';
        if (d.future) cls += ' future';
        html += '<i class="' + cls + '" title="' + esc(d.date) + '"></i>';
      }
    }
    return html;
  }

  /* --------------------------------------------------------- 四象限 */

  function renderQuads(now) {
    if (state.doc.settings.view === 'list') { renderFlat(now); return; }
    var groups = C.byQuadrant(state.doc, now);
    var html = '';
    for (var i = 0; i < D.QUADRANTS.length; i++) {
      var q = D.QUADRANTS[i];
      var list = groups[q.key];
      html += '<div class="quad ' + q.key + '">' +
        '<h3 class="quad-h">' +
        '<span class="quad-no">' + q.no + '</span>' +
        '<span class="quad-t">' + esc(q.title) + '</span>' +
        '<span class="quad-help">' + esc(q.advice) + '</span>' +
        '<span class="quad-n">' + list.length + '</span>' +
        '</h3><div class="quad-body">';
      if (!list.length) {
        html += '<div class="quad-empty">' + quadEmptyText(q, now) + '</div>';
      } else {
        for (var j = 0; j < list.length; j++) html += taskHtml(list[j], now);
      }
      html += '</div></div>';
    }
    el.quads.innerHTML = html;
    el.secQuad.hidden = false;
  }

  function quadEmptyText(q, now) {
    if (q.key === 'q1') return '没有火烧眉毛的事，挺好';
    if (q.key === 'q2') return '这里空着说明你只在救火';
    if (q.key === 'q3') {
      var undated = C.openTasks(state.doc).filter(function (t) {
        return !t.important && C.daysLeftOf(t, now) === null;
      }).length;
      return undated ? '没填时间的都落在④了，紧急的事一件没有' : '眼下没有急着交的杂事';
    }
    return '空的 —— 保持';
  }

  function renderFlat(now) {
    var list = C.flatList(state.doc, now);
    var html = '';
    if (!list.length) {
      html = '<div class="empty"><b>一条待办都没有</b>点右下角的 ＋ 加一件试试</div>';
    } else {
      for (var i = 0; i < list.length; i++) html += taskHtml(list[i], now);
    }
    el.quads.innerHTML = html;
    el.secQuad.hidden = false;
  }

  /**
   * 一条任务。左边的色条 = 象限，别把整张卡染色（三屏看下来会晕）。
   * --tk-tone 由 .q1/.q2/.q3/.q4 决定。
   */
  function taskHtml(it, now) {
    var q = C.quadrantOf(it, now, state.doc.settings.urgentDays);
    var u = C.urgencyOf(it, now);
    var left = C.daysLeftOf(it, now);
    var cls = 'tk ' + q.key + (u === 'overdue' ? ' is-overdue' : '');
    var when = C.whenText(it, now);
    var extra = '';
    if (it.deadline && it.deadline.time && left !== null && left >= 0) extra = ' ' + esc(it.deadline.time);
    if (left !== null && C.urgencyOf(it, now) !== 'later') extra = '';

    var meta = '<div class="tk-meta">' +
      '<span class="tk-when t-' + u + '">' + esc(when) + extra + '</span>';
    if (it.deadline) meta += '<span>' + esc(C.deadlineText(it, now)) + '</span>';
    if (it.note) meta += '<span>·</span><span>' + esc(it.note.length > 18 ? it.note.slice(0, 18) + '…' : it.note) + '</span>';
    meta += '</div>';

    return '<div class="' + cls + '" data-tk="' + it.id + '">' +
      '<button class="tk-check" type="button" data-check="' + it.id + '" aria-label="完成">' + CHECK_SVG + '</button>' +
      '<div class="tk-main">' +
      '<span class="tk-t">' + esc(it.title) + (it.important ? '<span class="tk-star">★</span>' : '') + '</span>' +
      (it.note ? '<p class="tk-note">' + esc(it.note) + '</p>' : '') +
      meta +
      '</div></div>';
  }

  /* --------------------------------------------------------- 搜索 */

  function renderSearch(now) {
    if (!state.query) {
      el.secSearchResult.hidden = true;
      el.searchHits.innerHTML = '';
      el.searchX.hidden = true;
      return;
    }
    el.searchX.hidden = false;
    var hits = C.search(state.doc, state.query) || [];
    el.secSearchResult.hidden = false;
    /* 搜索时把四象限和日常藏起来，只留结果 —— 不然翻半天找不到命中的那条 */
    el.secQuad.hidden = true;
    el.secHabit.hidden = true;
    el.secSoon.hidden = true;
    el.secDone.hidden = true;

    var html = '';
    if (!hits.length) {
      html = '<div class="empty"><b>没搜到「' + esc(state.query) + '」</b>换个词试试，或者清空搜索看全部</div>';
    } else {
      html = '<div class="sec-h"><span>搜到 ' + hits.length + ' 条</span></div>';
      for (var i = 0; i < hits.length; i++) {
        var it = hits[i];
        var q = C.quadrantOf(it, now, state.doc.settings.urgentDays);
        html += '<div class="tk ' + q.key + (it.done ? ' is-done' : '') + '" data-tk="' + it.id + '">' +
          '<button class="tk-check' + ((it.done || C.doneToday(it, now)) ? ' on' : '') + '" type="button" data-check="' + it.id + '" aria-label="完成">' + CHECK_SVG + '</button>' +
          '<div class="tk-main"><span class="tk-t">' + mark(it.title, state.query) + (it.important ? '<span class="tk-star">★</span>' : '') + '</span>' +
          (it.note ? '<p class="tk-note">' + mark(it.note, state.query) + '</p>' : '') +
          '<div class="tk-meta">' +
          (C.isRepeat(it) ? '<span class="tk-rep">' + esc(C.repeatText(it)) + '</span>' : '<span class="tk-when t-' + C.urgencyOf(it, now) + '">' + esc(C.whenText(it, now)) + '</span>') +
          (it.deadline ? '<span>' + esc(C.deadlineText(it, now)) + '</span>' : '') +
          '</div></div></div>';
      }
    }
    el.searchHits.innerHTML = html;
  }

  function mark(text, q) {
    var safe = esc(text);
    var key = String(q).trim();
    if (!key) return safe;
    var re = new RegExp('(' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return safe.replace(re, '<mark>$1</mark>');
  }

  /* --------------------------------------------------------- 已完成 */

  function renderDone(now) {
    if (state.query) return;
    var list = C.doneTasks(state.doc).slice().sort(function (a, b) { return (b.doneAt || 0) - (a.doneAt || 0); });
    if (!list.length) { el.secDone.hidden = true; el.doneList.innerHTML = ''; return; }
    el.secDone.hidden = false;
    el.doneN.textContent = list.length + ' 条';
    el.doneTri.textContent = state.doneOpen ? '▴' : '▾';
    el.doneList.hidden = !state.doneOpen;
    if (!state.doneOpen) { el.doneList.innerHTML = ''; return; }
    var html = '';
    var shown = list.slice(0, 50);
    for (var i = 0; i < shown.length; i++) {
      var it = shown[i];
      html += '<div class="done-item" data-tk="' + it.id + '">' +
        '<button class="tk-check on" type="button" data-check="' + it.id + '" aria-label="恢复">' + CHECK_SVG + '</button>' +
        '<div class="done-item-main">' +
        '<div class="done-t">' + esc(it.title) + '</div>' +
        '<div class="done-meta">' + (it.doneAt ? '完成于 ' + fmtDone(it.doneAt) : '已完成') + '</div>' +
        '</div></div>';
    }
    if (list.length > shown.length) html += '<p class="hint">还有 ' + (list.length - shown.length) + ' 条更早的没显示</p>';
    el.doneList.innerHTML = html;
  }

  function fmtDone(ms) {
    var d = new Date(ms);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /* ------------------------------------------------------------ 页脚 */

  function renderFooter() {
    var n = state.doc.items.length;
    el.ftCount.textContent = n + ' 条';
    el.hint.textContent = state.doc.settings.view === 'list'
      ? '排序：' + sortName(state.doc.settings.sort) + ' · 点任务可以改 DDL 和重要性'
      : '四象限：①马上做 ②安排时间做 ③快速做完 ④能不做就不做 · 点任务能改';
  }

  function sortName(key) {
    for (var i = 0; i < D.SORTS.length; i++) if (D.SORTS[i].key === key) return D.SORTS[i].name;
    return key;
  }

  /* ================================================================ 改 */

  function commit(fn) {
    var out = fn();
    if (!out) return false;
    state.doc = out;
    save();
    render();
    return true;
  }

  function toggleItem(id) {
    commit(function () { return (C.toggle(state.doc, id, nowDate()) || {}).doc || null; });
  }

  /* ================================================================ 弹层 */

  function paintSheet() {
    var editing = state.sheet === 'edit';
    var setting = state.sheet === 'set';
    el.edit.hidden = !editing;
    el.editMask.hidden = !editing;
    el.set.hidden = !setting;
    el.setMask.hidden = !setting;
    document.body.classList.toggle('sheet-open', editing || setting);
  }

  function openSheet(which) {
    state.sheet = which;
    paintSheet();
    if (which === 'edit') el.edTitleIn.focus();
  }

  function closeSheet() {
    state.sheet = '';
    state.editing = 0;
    el.edErr.hidden = true;
    paintSheet();
  }

  /* ---------------------------------------------------- 编辑一条任务 */

  var form = {
    important: false,
    date: '',
    time: '',
    repeat: null,
    days: []
  };

  function openEdit(id) {
    state.editing = id || 0;
    el.edErr.hidden = true;
    if (id) {
      var it = C.getItem(state.doc, id);
      if (!it) return;
      form.important = !!it.important;
      form.date = it.deadline ? it.deadline.date : '';
      form.time = it.deadline ? (it.deadline.time || '') : '';
      form.repeat = it.repeat ? it.repeat.kind : null;
      form.days = it.repeat && it.repeat.kind === 'weekly' ? it.repeat.days.slice() : [];
      el.edTitle.textContent = '改这一条';
      el.edTitleIn.value = it.title;
      el.edNote.value = it.note || '';
      el.edEveryN.value = it.repeat && it.repeat.kind === 'every' ? it.repeat.n : 2;
      el.edToggle.hidden = C.isRepeat(it);
      el.edToggle.textContent = it.done ? '还没做完' : '完成';
      el.edDel.hidden = false;
      el.fldDeadline.hidden = C.isRepeat(it);
    } else {
      form.important = false;
      form.date = '';
      form.time = '';
      form.repeat = null;
      form.days = [];
      el.edTitle.textContent = '加一条';
      el.edTitleIn.value = '';
      el.edNote.value = '';
      el.edEveryN.value = 2;
      el.edToggle.hidden = true;
      el.edDel.hidden = true;
      el.fldDeadline.hidden = false;
    }
    paintForm();
    openSheet('edit');
  }

  function paintForm() {
    /* 重要性 */
    var impChips = el.edImp.querySelectorAll('.chip');
    for (var i = 0; i < impChips.length; i++) {
      impChips[i].classList.toggle('is-on', (impChips[i].getAttribute('data-imp') === '1') === !!form.important);
    }
    /* 重复 */
    var repChips = el.edRepeat.querySelectorAll('.chip');
    for (var j = 0; j < repChips.length; j++) {
      var k = repChips[j].getAttribute('data-rep');
      repChips[j].classList.toggle('is-on', (k === 'none' && !form.repeat) || k === form.repeat);
    }
    el.edDays.hidden = form.repeat !== 'weekly';
    el.edEvery.hidden = form.repeat !== 'every';
    var dws = el.edDays.querySelectorAll('.dw');
    for (var m = 0; m < dws.length; m++) {
      dws[m].classList.toggle('is-on', form.days.indexOf(+dws[m].getAttribute('data-d')) >= 0);
    }
    /* DDL */
    var quick = el.edQuick.querySelectorAll('.chip');
    for (var n = 0; n < quick.length; n++) {
      var q = quick[n].getAttribute('data-q');
      var match = false;
      var now = nowDate();
      if (q === 'none') match = !form.date;
      else if (q === 'today') match = form.date === C.ymd(now);
      else if (q === 'tomorrow') match = form.date === C.ymd(C.addDays(now, 1));
      else if (q === 'week') match = form.date === C.ymd(C.addDays(C.mondayOf(now), 6));
      quick[n].classList.toggle('is-on', match);
    }
    el.edDate.value = form.date;
    el.edTime.value = form.time;
    paintDeadlineNote();
  }

  function paintDeadlineNote() {
    if (!form.date) {
      el.dlNote.className = 'fld-note';
      el.dlNote.textContent = '没定时间的事排在所有定了时间的事后面（哪怕你标了重要）。';
      return;
    }
    var d = C.parseDay(form.date);
    var left = C.daysBetween(d, nowDate());
    var txt = C.fmtMd(d) + ' ' + C.DAY_NAMES[C.isoDow(d)];
    if (left < 0) txt += '，已经过了 ' + (-left) + ' 天';
    else if (left === 0) txt += '，今天截止';
    else txt += '，还有 ' + left + ' 天';
    if (form.time) txt += ' ' + form.time;
    else txt += '（只到日期，不填时间不算晚）';
    el.dlNote.className = 'fld-note' + (left < 0 ? ' is-warn' : '');
    el.dlNote.textContent = txt;
  }

  function saveForm() {
    var title = el.edTitleIn.value.trim();
    if (!title) {
      el.edErr.hidden = false;
      el.edErr.textContent = '先给这件事起个名字吧';
      el.edTitleIn.focus();
      return;
    }
    if (form.repeat === 'weekly' && !form.days.length) {
      el.edErr.hidden = false;
      el.edErr.textContent = '「每周的几天」至少要选一天';
      return;
    }
    var repeat = null;
    if (form.repeat === 'daily') repeat = { kind: 'daily' };
    else if (form.repeat === 'weekly') repeat = { kind: 'weekly', days: form.days.slice() };
    else if (form.repeat === 'every') {
      var n = Math.round(Number(el.edEveryN.value));
      if (!(n >= 1) || n > 365) {
        el.edErr.hidden = false;
        el.edErr.textContent = '「每隔几天」要填 1 到 365 之间的整数';
        return;
      }
      repeat = { kind: 'every', n: n };
    }
    var input = {
      title: title,
      note: el.edNote.value,
      important: !!form.important,
      deadline: form.date ? { date: form.date, time: form.time } : null,
      repeat: repeat
    };
    var okGo = false;
    /* 逻辑层也会挡一道（requireTitle 会抛），这里接住它变成人话，
       免得任何意外都变成控制台里一条看不懂的红字。 */
    try {
      if (state.editing) {
        var out = C.updateItem(state.doc, state.editing, input);
        if (out) { state.doc = out.doc; okGo = true; }
      } else {
        var added = C.addItem(state.doc, input);
        state.doc = added.doc;
        okGo = true;
      }
    } catch (e) {
      el.edErr.hidden = false;
      el.edErr.textContent = e && e.code === 'EMPTY_TITLE' ? '先给这件事起个名字吧' : '存不下来：' + (e && e.message ? e.message : '原因不明');
      return;
    }
    if (okGo) { save(); closeSheet(); render(); }
  }

  /* -------------------------------------------------------- 设置抽屉 */

  function paintChips() {
    var s = state.doc.settings;
    el.themeChips.innerHTML = D.THEMES.map(function (t) {
      return '<button class="chip' + (t.key === s.theme ? ' is-on' : '') + '" type="button" data-theme="' + t.key + '">' + esc(t.name) + '</button>';
    }).join('');
    el.viewChips.innerHTML = D.VIEWS.map(function (v) {
      return '<button class="chip' + (v.key === s.view ? ' is-on' : '') + '" type="button" data-view="' + v.key + '">' + esc(v.name) + '</button>';
    }).join('');
    el.sortChips.innerHTML = D.SORTS.map(function (v) {
      return '<button class="chip' + (v.key === s.sort ? ' is-on' : '') + '" type="button" data-sort="' + v.key + '">' + esc(v.name) + '</button>';
    }).join('');
    el.urgentChips.innerHTML = [0, 1, 3, 5, 7].map(function (n) {
      return '<button class="chip' + (n === s.urgentDays ? ' is-on' : '') + '" type="button" data-urgent="' + n + '">' + (n === 0 ? '只有今天' : n + ' 天内') + '</button>';
    }).join('');
    /* 当前排序的说明 */
    var cur = null;
    for (var i = 0; i < D.SORTS.length; i++) if (D.SORTS[i].key === s.sort) cur = D.SORTS[i];
    el.sortNote.textContent = cur ? cur.note + (s.sort === 'auto' ? '：分数 = (999 − 剩余天数) × 100 +（重要加 50）。没填 DDL 的一律 0 分，永远垫底。' : '') : '';
    el.legend.innerHTML = D.QUADRANTS.map(function (q) {
      return '<div class="lg ' + q.key + '"><i></i><span>' + q.no + ' ' + esc(q.title) + '</span><span class="lg-help">' + esc(q.advice) + '</span></div>';
    }).join('');
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.doc.settings.theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', themeColorOf(state.doc.settings.theme));
  }

  function themeColorOf(key) {
    /* 和 style.css 里每个 --theme-color 一一对应。硬编码是因为 meta 拿不到 CSS 变量。 */
    if (key === 'paper') return '#fbf6ee';
    if (key === 'night') return '#101218';
    return '#f6f7fb';
  }

  function setSetting(patch) {
    var s = state.doc.settings;
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) s[k] = patch[k];
    save();
    applyTheme();
    paintChips();
    render();
  }

  /* ================================================================ 备份 */

  var BK_KIND = META.backupKind;
  var BK_VERSION = META.backupVersion;

  function fingerprint() {
    return { appName: META.appName, count: state.doc.items.length, seq: state.doc.seq };
  }

  function makeBackup() {
    return {
      kind: BK_KIND,
      version: BK_VERSION,
      exportedAt: new Date().toISOString(),
      app: META.appName,
      fingerprint: fingerprint(),
      doc: { version: 1, seq: state.doc.seq, items: state.doc.items, settings: state.doc.settings }
    };
  }

  function bkSay(msg, bad) {
    el.bkMsg.hidden = false;
    el.bkMsg.className = 'fld-msg ' + (bad ? 'is-bad' : 'is-good');
    el.bkMsg.textContent = msg;
  }

  var DROP_NAMES = { theme: '外观', view: '默认视图', sort: '排序方式', urgentDays: '紧急界线', soonDays: '最近要交的天数' };

  function parseBackup(text) {
    var raw = String(text == null ? '' : text).trim();
    if (!raw) return { ok: false, error: '还没有内容 —— 先选一个备份文件，或者把备份内容粘贴进来。' };
    var obj = null;
    try { obj = JSON.parse(raw); } catch (e) {
      return { ok: false, error: '这段内容不是合法的 JSON，看看是不是复制漏了。' };
    }
    if (!obj || typeof obj !== 'object') return { ok: false, error: '备份内容的格式不对。' };
    if (obj.kind !== BK_KIND) return { ok: false, error: '这看起来不是「' + META.appName + '」的备份。' };
    if (!obj.doc || typeof obj.doc !== 'object') return { ok: false, error: '备份里没有任务内容。' };

    var doc = C.normalize(obj.doc);
    var dropped = [];
    var rawSettings = obj.doc.settings;
    if (rawSettings && typeof rawSettings === 'object') {
      if (rawSettings.theme && rawSettings.theme !== doc.settings.theme) dropped.push(DROP_NAMES.theme);
      if (rawSettings.view && rawSettings.view !== doc.settings.view) dropped.push(DROP_NAMES.view);
      if (rawSettings.sort && rawSettings.sort !== doc.settings.sort) dropped.push(DROP_NAMES.sort);
      if (rawSettings.urgentDays !== undefined && Math.round(Number(rawSettings.urgentDays)) !== doc.settings.urgentDays) dropped.push(DROP_NAMES.urgentDays);
      if (rawSettings.soonDays !== undefined && Math.round(Number(rawSettings.soonDays)) !== doc.settings.soonDays) dropped.push(DROP_NAMES.soonDays);
    }

    var note = '';
    var fp = obj.fingerprint;
    if (fp && typeof fp === 'object' && fp.appName && fp.appName !== META.appName) {
      note = '这份备份来自「' + fp.appName + '」，能用，但内容可能对不上。';
    }

    return { ok: true, doc: doc, dropped: dropped, note: note, exportedAt: obj.exportedAt || '' };
  }

  function applyDoc(doc) {
    state.doc = doc;
    save();
    applyTheme();
    paintChips();
    render();
  }

  /** 合并：备份里的任务按 id 去重补进来，现有的保留。设置用备份的。 */
  function mergeDocs(cur, incoming) {
    var base = C.normalize(cur);
    var seen = {};
    for (var i = 0; i < base.items.length; i++) seen[base.items[i].id] = 1;
    var added = 0;
    for (var j = 0; j < incoming.items.length; j++) {
      var it = incoming.items[j];
      if (seen[it.id]) continue;
      seen[it.id] = 1;
      base.items.push(it);
      added++;
      if (it.id > base.seq) base.seq = it.id;
    }
    base.settings = incoming.settings;
    return { doc: C.normalize(base), added: added, total: base.items.length };
  }

  function bkRestore(mode) {
    el.bkMsg.hidden = true;   /* 上一次的话先收起来，免得看到的是旧消息 */
    var parsed = parseBackup(el.bkText.value);
    if (!parsed.ok) { bkSay(parsed.error, true); return; }
    var msg = '';
    if (mode === 'replace') {
      if (!window.confirm('完全替换？\n\n这台设备上现在的任务会被全部删掉，只用备份里的内容。')) return;
      applyDoc(parsed.doc);
      msg = '已用备份替换：现在有 ' + parsed.doc.items.length + ' 条任务。';
    } else {
      var out = mergeDocs(state.doc, parsed.doc);
      applyDoc(out.doc);
      msg = '已合并：新增 ' + out.added + ' 条，现在一共 ' + out.total + ' 条。';
    }
    if (parsed.note) msg += ' ' + parsed.note;
    if (parsed.dropped.length) msg += ' 不认识的设置项丢掉了：' + parsed.dropped.join('、') + '。';
    bkSay(msg, false);
  }

  function bkExport() {
    var text = JSON.stringify(makeBackup(), null, 2);
    el.bkText.value = text;
    var stamp = C.ymd(nowDate());
    try {
      var blob = new Blob([text], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = META.appName + '-备份-' + stamp + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      bkSay('备份文件开始下载了，找个地方收好。内容也留在下面的框里了。', false);
    } catch (e) {
      bkSay('下载没成功，但备份内容已经填在下面的框里 —— 长按全选复制，存到备忘录里。', true);
    }
  }

  function bkCopy() {
    var text = el.bkText.value || JSON.stringify(makeBackup(), null, 2);
    el.bkText.value = text;
    var done = function () { bkSay('备份内容已复制，粘到备忘录或者「文件传输助手」里存着。', false); };
    var fail = function () {
      el.bkText.focus();
      el.bkText.select();
      bkSay('这个浏览器不让自动复制 —— 内容已经选中了，长按复制一下。', true);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fail);
    } else {
      fail();
    }
  }

  function bkReadFile(file) {
    if (file.size > 256 * 1024) { bkSay('这个文件太大了（超过 256KB），不像是一个待办备份。', true); return; }
    var reader = new FileReader();
    reader.onload = function () {
      el.bkText.value = String(reader.result);
      bkSay('文件读进来了，点「合并恢复」或者「完全替换」。', false);
    };
    reader.onerror = function () {
      bkSay('这个文件读不出来。换个办法：把备份内容粘贴到下面的框里。', true);
    };
    reader.readAsText(file);
  }

  /* ================================================================ 交互 */

  function bind() {
    /* 表头 */
    el.btnSheet.addEventListener('click', function () { openSheet('set'); });
    el.setClose.addEventListener('click', closeSheet);
    el.setDone.addEventListener('click', closeSheet);
    el.setMask.addEventListener('click', closeSheet);
    el.edClose.addEventListener('click', closeSheet);
    el.editMask.addEventListener('click', closeSheet);

    /* 加一条 */
    el.fab.addEventListener('click', function () { openEdit(0); });

    /* 列表点击（事件委托 —— 重渲染会换掉 DOM，绑在旧节点上会失效） */
    el.pane.addEventListener('click', function (ev) {
      var t = ev.target;
      var node = t.closest ? t.closest('[data-check]') : null;
      if (node) {
        ev.stopPropagation();
        toggleItem(+node.getAttribute('data-check'));
        return;
      }
      var hit = t.closest ? t.closest('[data-habit]') : null;
      if (hit) {
        ev.stopPropagation();
        toggleItem(+hit.getAttribute('data-habit'));
        return;
      }
      var open = t.closest ? t.closest('[data-open]') : null;
      if (open) {
        openEdit(+open.getAttribute('data-open'));
        return;
      }
      var tk = t.closest ? t.closest('[data-tk]') : null;
      if (tk) {
        openEdit(+tk.getAttribute('data-tk'));
        return;
      }
      if (t.closest && t.closest('#doneHead')) {
        state.doneOpen = !state.doneOpen;
        renderDone(nowDate());
      }
    });

    /* 搜索 */
    el.searchIn.addEventListener('input', function () {
      state.query = el.searchIn.value.trim();
      render();
    });
    el.searchX.addEventListener('click', function () {
      el.searchIn.value = '';
      state.query = '';
      render();
    });

    /* 表单里的 chip */
    el.edImp.addEventListener('click', function (ev) {
      var c = ev.target.closest('.chip');
      if (!c) return;
      form.important = c.getAttribute('data-imp') === '1';
      paintForm();
    });
    el.edQuick.addEventListener('click', function (ev) {
      var c = ev.target.closest('.chip');
      if (!c) return;
      var q = c.getAttribute('data-q');
      var now = nowDate();
      if (q === 'none') { form.date = ''; form.time = ''; }
      else if (q === 'today') { form.date = C.ymd(now); form.preserveTime = form.time; }
      else if (q === 'tomorrow') { form.date = C.ymd(C.addDays(now, 1)); }
      else if (q === 'week') { form.date = C.ymd(C.addDays(C.mondayOf(now), 6)); }
      paintForm();
    });
    el.edDate.addEventListener('change', function () {
      form.date = el.edDate.value || '';
      if (!form.date) form.time = '';
      paintForm();
    });
    el.edTime.addEventListener('change', function () {
      form.time = el.edTime.value || '';
      paintForm();
    });
    el.edRepeat.addEventListener('click', function (ev) {
      var c = ev.target.closest('.chip');
      if (!c) return;
      var k = c.getAttribute('data-rep');
      form.repeat = k === 'none' ? null : k;
      if (form.repeat === 'weekly' && !form.days.length) {
        form.days = [C.isoDow(nowDate())];
      }
      paintForm();
    });
    el.edDays.addEventListener('click', function (ev) {
      var b = ev.target.closest('.dw');
      if (!b) return;
      var d = +b.getAttribute('data-d');
      var at = form.days.indexOf(d);
      if (at >= 0) form.days.splice(at, 1);
      else form.days.push(d);
      form.days.sort(function (a, b2) { return a - b2; });
      paintForm();
    });
    el.edSave.addEventListener('click', saveForm);
    el.edToggle.addEventListener('click', function () {
      if (!state.editing) return;
      toggleItem(state.editing);
      closeSheet();
    });
    el.edDel.addEventListener('click', function () {
      if (!state.editing) return;
      var it = C.getItem(state.doc, state.editing);
      if (!it) return;
      if (!window.confirm('删掉「' + it.title + '」？删了就找不回来了。')) return;
      var next = C.removeItem(state.doc, state.editing);
      if (next) { state.doc = next; save(); closeSheet(); render(); }
    });

    /* 设置 */
    el.themeChips.addEventListener('click', function (ev) {
      var c = ev.target.closest('.chip');
      if (!c) return;
      setSetting({ theme: c.getAttribute('data-theme') });
    });
    el.viewChips.addEventListener('click', function (ev) {
      var c = ev.target.closest('.chip');
      if (!c) return;
      setSetting({ view: c.getAttribute('data-view') });
    });
    el.sortChips.addEventListener('click', function (ev) {
      var c = ev.target.closest('.chip');
      if (!c) return;
      setSetting({ sort: c.getAttribute('data-sort') });
    });
    el.urgentChips.addEventListener('click', function (ev) {
      var c = ev.target.closest('.chip');
      if (!c) return;
      setSetting({ urgentDays: +c.getAttribute('data-urgent') });
    });

    /* 备份 */
    el.bkExport.addEventListener('click', bkExport);
    el.bkCopy.addEventListener('click', bkCopy);
    el.bkMerge.addEventListener('click', function () { bkRestore('merge'); });
    el.bkReplace.addEventListener('click', function () { bkRestore('replace'); });
    el.bkPick.addEventListener('click', function () {
      el.bkFile.value = '';
      el.bkFile.click();
    });
    el.bkFile.addEventListener('change', function () {
      if (el.bkFile.files && el.bkFile.files[0]) bkReadFile(el.bkFile.files[0]);
    });

    /* 回车即保存 */
    el.edTitleIn.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); saveForm(); }
    });

    /* Esc 关弹层 */
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && state.sheet) closeSheet();
    });
  }

  /* -------------------------------------------------------------- 心跳 */

  var lastKey = '';

  function tick() {
    var d = nowDate();
    var key = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate() + ' ' + d.getHours() + ':' + d.getMinutes();
    if (key === lastKey) return;
    lastKey = key;
    render();
  }

  /* -------------------------------------------------------------- 启动 */

  function boot() {
    assertNodes();
    probeStorage();
    load();
    applyTheme();
    paintChips();
    paintWarn();
    render();
    bind();
    lastKey = '';
    tick();

    /* iOS 回前台会把定时器冻住，回来先补一次 */
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) tick();
    });
    window.addEventListener('resize', function () { /* 布局靠 CSS，重画一次保证"今天"是对的 */ tick(); });
    setInterval(tick, 20000);
  }

  /**
   * 直接启动，不等 DOMContentLoaded。
   *
   * 为什么：这个 script 标签是写在页面最后，执行到这一行时它上面的
   * 节点都已经解析完了，所以"现在就跑"是安全的。而等 DOMContentLoaded 会带来
   * 一个隐蔽的坑 —— 测试脚本 eval 完三个 js 之后立刻查 state，会看到一份
   * 空的初始文档（因为 load() 还没跑），然后开始怀疑是 normalize 坏了。
   * 同步启动之后，eval 一返回页面就是就绪状态。
   */
  var booted = false;
  function bootOnce() {
    if (booted) return;
    booted = true;
    boot();
  }

  if (document.readyState === 'loading') {
    /* 正常打开时 body 已经解析到这一行了（这是页面最后一个 script）；
       而 jsdom 里测试脚本是 eval 这三个 js 的，DOMContentLoaded 可能永远不会来，
       所以两边都要照顾：先立刻启动，同时留一个"万一之后再触发"的兜底。 */
    bootOnce();
    document.addEventListener('DOMContentLoaded', bootOnce);
  } else {
    bootOnce();
  }

  /* 给测试和截图脚本用的钩子 */
  window.__T = {
    state: state,
    data: D,
    core: C,
    render: render,
    tick: tick,
    save: save,
    openEdit: openEdit,
    openSheet: openSheet,
    closeSheet: closeSheet,
    setSetting: setSetting,
    makeBackup: makeBackup,
    parseBackup: parseBackup,
    bkRestore: bkRestore,
    mergeDocs: mergeDocs,
    applyDoc: applyDoc,
    heatHtml: heatHtml,
    form: form,
    setNow: function (d) {
      state.nowOverride = d ? new Date(d) : null;
      lastKey = '';
      render();
    },
    isReady: function () { return true; }
  };
})();
