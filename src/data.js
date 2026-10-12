/* 丸梓todo —— 数据层
 *
 * 这里只放"数据长什么样"和"预设值"，不含任何 DOM 操作。
 * 所有日期一律用【本地时间】构造（new Date(y, m-1, d)），
 * 绝不用 new Date('2026-10-10') —— 那会被当成 UTC 午夜，东八区整体偏一天。
 * 日期一律存成 'YYYY-MM-DD' 字符串，时间存成 'HH:MM' 字符串：
 * 这样字符串直接比大小就是时间先后，不用解析、也不会被时区啃一口。
 */
(function (root) {
  'use strict';

  var META = {
    appName: '丸梓todo',
    owner: '丸梓',
    tagline: '先做重要的，再做紧急的',
    storageKey: 'wanziTodo.v1',
    backupKind: 'wanzi-todo',
    backupVersion: 1
  };

  /* ---------------------------------------------------------------- 四象限 */

  /* 重要 × 紧急 的 2×2。紧急的界线见 URGENT_DAYS：
     剩余天数 <= 3（含已逾期）算"紧急"。 */
  var URGENT_DAYS = 3;

  /* 四象限的固定顺序（列表就按这个顺序分区），以及每区的说法。
     advice 用的是四象限法则（艾森豪威尔矩阵）的标准处理原则。 */
  var QUADRANTS = [
    {
      key: 'q1',
      no: '①',
      title: '重要且紧急',
      advice: '马上做',
      important: true,
      urgent: true,
      tone: 'q1'
    },
    {
      key: 'q2',
      no: '②',
      title: '重要不紧急',
      advice: '安排时间做',
      important: true,
      urgent: false,
      tone: 'q2'
    },
    {
      key: 'q3',
      no: '③',
      title: '紧急不重要',
      advice: '快速做完',
      important: false,
      urgent: true,
      tone: 'q3'
    },
    {
      key: 'q4',
      no: '④',
      title: '不紧急不重要',
      advice: '能不做就不做',
      important: false,
      urgent: false,
      tone: 'q4'
    }
  ];

  /* 紧迫程度分档。key 用来上色，也用来做"离 DDL 还有多久"的文案。
     max 是"剩余天数 <= max"的上界，最后一档用 null 表示兜底。 */
  var URGENCY_BUCKETS = [
    { key: 'overdue', name: '已逾期', max: -1 },
    { key: 'today', name: '今天截止', max: 0 },
    { key: 'tomorrow', name: '明天截止', max: 1 },
    { key: 'urgent', name: '3 天内', max: 3 },
    { key: 'week', name: '本周内', max: 7 },
    { key: 'later', name: '还早', max: null }
  ];

  /* ------------------------------------------------------------ 重复规则 */

  /* 日常任务的重复方式。kind 决定表单里长什么样：
     daily  = 每天
     weekly = 每周固定的几天（days 是 1..7，1=周一、7=周日）
     every  = 每隔 n 天 */
  var REPEAT_KINDS = [
    { key: 'daily', name: '每天' },
    { key: 'weekly', name: '每周的几天' },
    { key: 'every', name: '每隔几天' }
  ];

  /* ---------------------------------------------------------------- 外观 */

  var THEMES = [
    { key: 'clean', name: '清爽', note: '白底大留白，白天用' },
    { key: 'paper', name: '纸感', note: '米色底，像笔记本' },
    { key: 'night', name: '暗夜', note: '深色，晚上看不刺眼' }
  ];

  /* 分区视图：按四象限分开。清单视图：全部按分数排成一条。 */
  var VIEWS = [
    { key: 'quad', name: '分区', note: '按四象限分开，一眼看出该先碰哪件' },
    { key: 'list', name: '清单', note: '全部按急迫程度排成一条' }
  ];

  var SORTS = [
    { key: 'auto', name: '自动算分', note: '按 DDL 倒计时算急迫度，重要的稍加分' },
    { key: 'ddl', name: '只看 DDL', note: '严格按截止时间先后，不看重要性' },
    { key: 'created', name: '按添加时间', note: '新加的排在上面' }
  ];

  /* 首页"最近要交的"区块：剩余天数 <= 这个值就顶上首页。 */
  var SOON_DAYS = 7;

  var DEFAULTS = {
    theme: 'clean',
    view: 'quad',
    sort: 'auto',
    soonDays: SOON_DAYS,
    urgentDays: URGENT_DAYS
  };

  /* 空文档。每次读写都过一遍 normalize，坏数据不会把页面搞崩。 */
  var EMPTY = {
    version: 1,
    seq: 0,
    items: [],
    settings: DEFAULTS
  };

  var API = {
    META: META,
    QUADRANTS: QUADRANTS,
    URGENCY_BUCKETS: URGENCY_BUCKETS,
    REPEAT_KINDS: REPEAT_KINDS,
    THEMES: THEMES,
    VIEWS: VIEWS,
    SORTS: SORTS,
    URGENT_DAYS: URGENT_DAYS,
    SOON_DAYS: SOON_DAYS,
    DEFAULTS: DEFAULTS,
    EMPTY: EMPTY
  };

  root.TodoData = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
