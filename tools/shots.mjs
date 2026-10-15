/* 真截图：用 Edge 无头模式 + CDP 设备模拟，把页面按 iPhone 宽度打开，自己"看"图
 * 跑法：node tools/shots.mjs          截图写进 预览/
 *       node tools/shots.mjs --check  只自检（能不能渲染、有没有报错），不写图
 *
 * 两个必须绕开的坑：
 *  1) --screenshot 会丢掉 URL 的 query string，没法用 ?demo= 传参。
 *     做法：把一小段「驱动脚本」注入到 </body> 之前（一定晚于应用脚本），
 *     让它读 location.search、假装"现在是几点"、把测量结果写进 window.__SHOT。
 *  2) Windows 上 Edge 无头窗口最小宽度被钳到约 518px，--window-size=390 无效，
 *     套 390px 的 iframe 也没用（iframe 一样被撑到 518）。
 *     做法：用 CDP 的 Emulation.setDeviceMetricsOverride 强制 390×844，这是唯一靠谱的。
 *
 * 截的是【打包后的单文件版】，不是源码 html：
 *  ① 截出来的就是真正交付的那个文件；
 *  ② 单文件版没有任何相对引用，临时 html 放到哪都能跑。
 *     （踩过的坑：把源码 html 拷到 .shots/ 下截，<script src="src/app.js"> 会去
 *      .shots/src/ 找，找不到就静默不执行 —— 页面空白，还查不出原因。）
 *
 * 演示数据（下面 SEED）用 `Page.addScriptToEvaluateOnNewDocument` 在页面脚本跑之前
 * 写进 localStorage —— 这样它是"真的从存档读出来的"，不是硬塞进内存的假状态。
 * 存档格式必须和 src/app.js 的 save() 一致：{ version, seq, items, settings }。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSingle } from './build-single.mjs';
import { launchBrowser, connectToTarget, createTarget, sleep } from './cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const SHOT_DIR = path.join(root, '预览');
const TMP_DIR = path.join(root, '.shots');
const PHONE_W = 390;                    // iPhone 14/15/16 的逻辑宽度
const PHONE_H = 844;
const DEBUG_PORT = 9334;
const CHECK_ONLY = process.argv.includes('--check');
/* 演示数据里的"今天"是固定的一天，而"哪些任务算今天到期"是应用自己按日期算的。
   截图要表现"今天的事全清了"，就得按日期去勾 —— 所以传 check=due，由驱动脚本
   在渲染之后现找"已经欠着的"和"今天截止"两组里的勾，而不是把任务 id 写死。 */

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];

function findBrowser() {
  for (const p of EDGE_CANDIDATES) if (fs.existsSync(p)) return p;
  return null;
}

/** 本机绝对路径 → file:/// URL */
function fileUrl(p) {
  return 'file:///' + p.replace(/\\/g, '/').replace(/ /g, '%20');
}

/* --------------------------------------------------------------- 演示数据 */

/* 基准时刻：截图里"现在"就是 2026-10-10 15:10（周六）。
   所有日期都是照着这个点手算好的，一眼能看出"逾期 / 今天 / 三天内 / 以后"。 */
const NOW = { y: 2026, m: 10, d: 10, hh: 15, mm: 10 };

function iso(y, m, d) {
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

/* 2026-09-10 是周四 —— 用来给"每周的几天"任务当锚点（打卡记录要能对上日子） */
const T = (y, m, d, hh, mm) => new Date(y, m - 1, d, hh || 0, mm || 0).getTime();

const SEED_ITEMS = [
  { id: 1, title: 'C 语言实验报告', note: '第三章：链表。要交电子版 + 打印一份', important: true, done: false,
    deadline: { date: '2026-10-08', time: '18:00' }, repeat: null, log: [],
    createdAt: T(2026, 10, 1, 9, 12), updatedAt: T(2026, 10, 1, 9, 12) },
  { id: 2, title: '工科数学分析 期中复习', note: '第七、八章是重点，上次小测就栽在级数上', important: true, done: false,
    deadline: { date: '2026-10-12', time: '20:00' }, repeat: null, log: [],
    createdAt: T(2026, 10, 2, 14, 5), updatedAt: T(2026, 10, 2, 14, 5) },
  { id: 3, title: '把班群通知转发给室友', note: '', important: false, done: false,
    deadline: { date: '2026-10-10', time: '23:00' }, repeat: null, log: [],
    createdAt: T(2026, 10, 10, 8, 30), updatedAt: T(2026, 10, 10, 8, 30) },
  { id: 4, title: '去菜鸟驿站取快递', note: '取件码 8-2-3041（今天最后一天）', important: false, done: false,
    deadline: { date: '2026-10-11', time: '21:00' }, repeat: null, log: [],
    createdAt: T(2026, 10, 9, 19, 40), updatedAt: T(2026, 10, 9, 19, 40) },
  { id: 5, title: '把工科数学的笔记整理成电子版', note: '一章一个文件，学期末能直接拿来复习', important: true, done: false,
    deadline: { date: '2026-10-20', time: '' }, repeat: null, log: [],
    createdAt: T(2026, 10, 4, 16, 22), updatedAt: T(2026, 10, 4, 16, 22) },
  { id: 6, title: '还图书馆的书', note: '《C 程序设计语言》', important: true, done: false,
    deadline: { date: '2026-10-25', time: '' }, repeat: null, log: [],
    createdAt: T(2026, 10, 5, 11, 2), updatedAt: T(2026, 10, 5, 11, 2) },
  { id: 7, title: '背单词', note: '', important: false, done: false,
    deadline: null, repeat: { kind: 'daily', days: [], n: null },
    log: ['2026-09-20', '2026-10-08', '2026-10-09', '2026-10-10'],
    createdAt: T(2026, 9, 10, 7, 30), updatedAt: T(2026, 10, 10, 7, 35) },
  { id: 8, title: '操场跑 3 公里', note: '', important: false, done: false,
    deadline: null, repeat: { kind: 'weekly', days: [1, 3, 5], n: null },
    log: ['2026-09-28', '2026-10-02', '2026-10-05', '2026-10-07', '2026-10-09'],
    createdAt: T(2026, 9, 10, 7, 0), updatedAt: T(2026, 10, 9, 21, 10) },
  { id: 9, title: '给耳机换硅胶套', note: '', important: false, done: false,
    deadline: null, repeat: null, log: [],
    createdAt: T(2026, 9, 30, 22, 15), updatedAt: T(2026, 9, 30, 22, 15) },
  { id: 10, title: '把手机相册备份到电脑', note: '', important: false, done: false,
    deadline: null, repeat: null, log: [],
    createdAt: T(2026, 10, 3, 20, 45), updatedAt: T(2026, 10, 3, 20, 45) },
  { id: 11, title: '给自行车打气', note: '', important: false, done: true,
    deadline: { date: '2026-10-09', time: '' }, repeat: null, log: [],
    createdAt: T(2026, 10, 6, 12, 0), updatedAt: T(2026, 10, 9, 8, 5) },
  { id: 12, title: '交体育课的心率记录表', note: '', important: true, done: true,
    deadline: { date: '2026-10-07', time: '12:00' }, repeat: null, log: [],
    createdAt: T(2026, 10, 1, 10, 10), updatedAt: T(2026, 10, 6, 9, 0) }
];

const SEED = {
  version: 1,
  seq: 12,
  items: SEED_ITEMS,
  settings: { theme: 'clean', view: 'quad', sort: 'auto', soonDays: 7, urgentDays: 3 }
};

/* ------------------------------------------------------------------ 驱动脚本 */

/** 注入到页面最后：控制"假装现在几点"，并把测量结果写成 window.__SHOT */
export function driverScript() {
  return `
<script>
(function () {
  var q = new URLSearchParams(location.search);
  window.__err = 'none';
  window.addEventListener('error', function (e) { window.__err = (e.message || '') + ' @' + (e.lineno || 0); });
  window.__SHOT = { ok: false, err: 'none' };
  var NOW = { y: ` + NOW.y + `, m: ` + NOW.m + `, d: ` + NOW.d + `, hh: ` + NOW.hh + `, mm: ` + NOW.mm + ` };

  function apply() {
    var T = window.__T;
    /* 先把"现在"钉死，再动别的 —— 不然"今天/逾期"会跟着真实时间漂 */
    T.setNow(new Date(NOW.y, NOW.m - 1, NOW.d, NOW.hh, NOW.mm));
    /* 配色走"点 chip"的路子，别直接改 data-theme ——
       直接改属性只动了 DOM，state.theme 还是默认值，设置抽屉里亮着的 chip
       就会和页面实际配色对不上（截图会拍出这种自相矛盾的状态）。 */
    if (q.get('pickTheme')) {
      var tc = document.querySelector('#themeChips .chip[data-theme="' + q.get('pickTheme') + '"]');
      if (tc) tc.click();
    }
    /* 视图必须显式指定：演示存档（下面 SEED）里存的是 view:'quad'，
       不指定就会照着存档画四象限 —— 而 01~04 要拍的是默认的"今天"那一屏。 */
    if (q.get('view')) T.setSetting({ view: q.get('view') });
    if (q.get('cheers')) T.setSetting({ cheers: q.get('cheers') });
    if (q.get('check')) {                      /* 勾掉几件（今天这一屏的进度/庆祝） */
      var wanted = q.get('check');
      if (wanted === 'due') {
        /* 今天的事全清了：把"已经欠着的"和"今天截止"两组里的都勾上。
           每勾一次都会重画 DOM，前面缓存下来的节点就作废了，所以每一轮都重新找。 */
        for (var guard = 0; guard < 30; guard++) {
          var open = null;
          var groups = document.querySelectorAll('#today .tgroup');
          for (var gi = 0; gi < groups.length && !open; gi++) {
            var tx = groups[gi].textContent;
            if (tx.indexOf('今天截止') < 0 && tx.indexOf('已经欠着') < 0) continue;
            open = groups[gi].querySelector('[data-check]');
          }
          if (!open) break;
          open.click();
        }
      } else {
        wanted.split(',').forEach(function (id) {
          var box = document.querySelector('#paneInner [data-check="' + id + '"]');
          if (box) box.click();
        });
      }
    }
    if (q.get('sort')) T.setSetting({ sort: q.get('sort') });
    if (q.get('urgent')) T.setSetting({ urgentDays: +q.get('urgent') });
    if (q.get('done')) {                       /* 展开"已完成"归档区 */
      var dh = document.getElementById('doneHead');
      if (dh) dh.click();
    }
    if (q.get('search')) {
      var si = document.getElementById('searchIn');
      si.value = q.get('search');
      si.dispatchEvent(new Event('input'));
    }
    if (q.get('sheet')) T.openSheet(q.get('sheet'));   /* set | edit */
    if (q.get('sheetBottom')) {
      var sh = document.getElementById('set');
      if (sh) sh.scrollTop = sh.scrollHeight;
    }
    if (q.get('edit')) T.openEdit(+q.get('edit'));
    if (q.get('prefill')) {                    /* 开一个"新建"表单，填上字 */
      T.openEdit(0);
      document.getElementById('edTitleIn').value = q.get('prefill');
      var imp = document.querySelector('#edImp .chip[data-imp="1"]');
      if (imp) imp.click();
      var d = document.getElementById('edDate');
      d.value = '2026-10-15';
      d.dispatchEvent(new Event('change'));
    }
  }

  var tries = 0;
  (function wait() {
    if (window.__T && window.__T.isReady && window.__T.isReady()) {
      try { apply(); } catch (e) { window.__err = 'apply() 抛错：' + ((e && e.message) || e); }
      var doc = window.__T.state.doc;
      var ph = document.querySelector('.phone');
      var pane = document.querySelector('.pane');
      var sheet = document.querySelector('.sheet:not([hidden])');
      /* 内容那一块的真实高度：整页截图要按它算（.phone 是 100dvh，不撑就被截断）。
         .pane 是唯一滚动区，scrollHeight 不受自身裁剪影响，正是整页要的高度。
         抽屉开着的时候，抽屉自己也可能比屏幕高，两个取大的。 */
      var paneH = pane ? pane.scrollHeight : 0;
      var sheetH = sheet ? sheet.scrollHeight : 0;
      var contentH = Math.max(paneH, sheetH);
      var chromeH = ph ? Math.max(0, ph.getBoundingClientRect().height - (pane ? pane.getBoundingClientRect().height : 0)) : 0;

      /* 有没有横向溢出（手机上最常见的问题：某一行太宽把整页撑出一道横向滚动条）。
         注意不能拿"元素右边超出视口"当判据 —— 「最近要交的」那一条是**横向滚动**的
         卡片带，后面的卡片天生就在视口外面，那是设计、不是 bug。
         真正要抓的是**整页**被撑宽：根元素的 scrollWidth 比视口宽。 */
      var over = '';
      var rootW = document.documentElement.scrollWidth;
      if (rootW > window.innerWidth + 1) {
        over = '整页宽 ' + rootW + 'px（视口 ' + window.innerWidth + 'px）';
        var parts = [];
        Array.prototype.forEach.call(document.querySelectorAll('.tk, .habit, .soon-card, .search, .hd, .tick, .sheet'), function (n) {
          var r = n.getBoundingClientRect();
          if (r.right > window.innerWidth + 0.5) parts.push(n.className + ':' + Math.round(r.left) + '~' + Math.round(r.right));
        });
        if (parts.length) over += ' | ' + parts.slice(0, 4).join(' | ');
      }

      window.__SHOT = {
        ok: true,
        err: String(window.__err),
        items: doc.items.length,
        open: doc.items.filter(function (i) { return !i.done; }).length,
        done: doc.items.filter(function (i) { return !!i.done; }).length,
        theme: window.__T.state.doc.settings.theme,
        view: window.__T.state.doc.settings.view,
        cards: document.querySelectorAll('#quads .tk').length,
        today: document.querySelectorAll('#today .tgroup, #today .tk').length,
        settle: !!(document.getElementById('settle') && !document.getElementById('settle').hidden),
        cheer: document.querySelectorAll('.cheer').length,
        habits: document.querySelectorAll('#habits .habit').length,
        heat: document.querySelectorAll('#heat .heat-cell').length,
        soon: document.querySelectorAll('#soon .soon-card').length,
        lines: document.querySelectorAll('#paneInner .tk, #habits .habit').length,
        h: document.documentElement.scrollHeight,
        vw: window.innerWidth,
        phoneW: ph ? Math.round(ph.getBoundingClientRect().width) : 0,
        contentH: contentH,
        fullH: Math.round(contentH + chromeH + 8),
        sheetOpen: !!sheet,
        sheetH: Math.round(sheetH),
        overflow: over,
        ticker: ((document.getElementById('tickText') || {}).textContent || ''),
        footer: ((document.getElementById('ftCount') || {}).textContent || '')
      };
      document.title = 'READY ' + window.__SHOT.cards;
      return;
    }
    if (++tries > 80) {
      document.title = 'DRIVER-FAIL ' + String(window.__err) + ' readyState=' + document.readyState;
      window.__SHOT = { ok: false, err: String(window.__err) };
      return;
    }
    setTimeout(wait, 50);
  })();
})();
<\/script>
`;
}

/* ------------------------------------------------------------------ 截一张 */

async function shoot(browser, cfg) {
  const tmpHtml = path.join(TMP_DIR, 'shot-' + cfg.name + '.html');

  let html = buildSingle({ write: false }).html;
  if (html.indexOf('</body>') < 0) return { name: cfg.name, error: '源码里没有 </body>，注入不了驱动脚本' };
  html = html.replace('</body>', driverScript() + '</body>');
  fs.writeFileSync(tmpHtml, html, 'utf8');

  /* 每张图开一个新标签页，互不干扰（localStorage 也不会串） */
  const targetId = await createTarget(browser.cdp);
  const page = await connectToTarget(DEBUG_PORT, targetId);

  try {
    await page.send('Page.enable');
    await page.send('Runtime.enable');

    /* 在页面脚本执行【之前】把演示存档写进 localStorage —— 等价于"用户早就存好了" */
    const seedJson = JSON.stringify(cfg.seed === 0 ? { version: 1, seq: 0, items: [], settings: SEED.settings } : SEED);
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: 'try { window.localStorage.setItem("wanziTodo.v1", ' + JSON.stringify(seedJson) + '); } catch (e) {}'
    });

    /* 关键一步：强制手机视口，否则 Edge 会钳到 518px */
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: PHONE_W, height: PHONE_H, deviceScaleFactor: 1, mobile: true
    });
    await page.send('Page.navigate', { url: fileUrl(tmpHtml) + (cfg.query ? '?' + cfg.query : '') });

    /* 轮询驱动脚本的完成标记 */
    let shot = null;
    for (let i = 0; i < 120; i++) {
      const r = await page.send('Runtime.evaluate', {
        expression: 'JSON.stringify(window.__SHOT || null)', returnByValue: true
      });
      const v = r && r.result && r.result.value;
      if (v) {
        const parsed = JSON.parse(v);
        if (parsed && parsed.ok) { shot = parsed; break; }
        if (parsed && parsed.ok === false && parsed.err && parsed.err !== 'none') {
          return { name: cfg.name, error: '页面报错：' + parsed.err };
        }
      }
      await sleep(100);
    }
    if (!shot) {
      const t = await page.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
      return { name: cfg.name, error: '驱动脚本没跑完（title=' + (t.result && t.result.value) + '）' };
    }

    const problems = [];
    if (!shot.cards && !shot.lines && !shot.today && !cfg.allowEmpty) problems.push('页面里既没有四象限任务卡，也没有列表行或今天这一屏的内容');
    if (shot.h < 200) problems.push('整页高度只有 ' + shot.h + 'px，明显没渲染出来');
    if (shot.err && shot.err !== 'none') problems.push('页面报错：' + shot.err);
    if (shot.vw !== PHONE_W) problems.push('视口宽度是 ' + shot.vw + '，不是 ' + PHONE_W);
    if (!shot.items && !cfg.allowEmpty) problems.push('存档没读进来（items = 0）—— 演示数据没种上');
    if (shot.overflow) problems.push('横向溢出了：' + shot.overflow);
    if (problems.length) {
      return { name: cfg.name, error: problems.join('；') + `（卡片 ${shot.cards}，列表行 ${shot.lines}）` };
    }

    const info = `${shot.items} 条存档（待办 ${shot.open} / 已完成 ${shot.done}），四象限卡 ${shot.cards}，` +
      `今天这一屏 ${shot.today} 块 [${shot.view}]${shot.settle ? '（结算条已亮）' : ''}${shot.cheer ? '（庆祝气泡 ' + shot.cheer + ' 个）' : ''}，` +
      `打卡 ${shot.habits}，热力图 ${shot.heat} 格，整页 ${shot.fullH}px，视口 ${shot.vw}px` +
      (shot.sheetOpen ? `，抽屉 ${shot.sheetH}px` : '');
    if (CHECK_ONLY) return { name: cfg.name, ok: true, note: info };

    /* 整页截图：先把手机视口撑到整页高（.phone 是 100dvh，不撑就会被截断），
       再用 captureBeyondViewport + clip 取整页 */
    const capH = Math.min(Math.max(shot.fullH, PHONE_H), 2600);
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: PHONE_W, height: capH, deviceScaleFactor: 1, mobile: true
    });
    /* 庆祝气泡只活 1600ms，等太久就拍不到了，所以勾过东西的那几张要快 */
    await sleep(cfg.query.indexOf('check=') >= 0 ? 40 : 120);
    const cap = await page.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: PHONE_W, height: capH, scale: 1 }
    });
    const png = path.join(SHOT_DIR, cfg.name + '.png');
    fs.writeFileSync(png, Buffer.from(cap.data, 'base64'));
    const kb = (fs.statSync(png).size / 1024).toFixed(0);
    return { name: cfg.name, ok: true, kb: kb, file: png, note: info + '；' + shot.ticker };
  } finally {
    try { await browser.cdp.send('Target.closeTarget', { targetId: targetId }); } catch (e) { /* 忽略 */ }
    page.close();
  }
}

/* ------------------------------------------------------------------ 截哪些 */

/* 用了 pickTheme 而不是直接改 data-theme：见上面 apply() 里的说明。
   注意：01-04 故意【不】传 view —— 它们拍的就是"用户第一次打开会看到什么"（默认今天视图）。 */
const SHOTS = [
  { name: '01-今天-清爽', query: 'pickTheme=clean&view=focus' },
  { name: '02-今天-勾掉一件（庆祝）', query: 'pickTheme=clean&view=focus&check=1' },
  { name: '03-今天-收工结算', query: 'pickTheme=clean&view=focus&check=due' },
  { name: '04-今天-暗夜', query: 'pickTheme=night&view=focus&check=1' },
  { name: '05-四象限-清爽', query: 'pickTheme=clean&view=quad' },
  { name: '06-四象限-暗夜', query: 'pickTheme=night&view=quad' },
  { name: '07-四象限-纸感', query: 'pickTheme=paper&view=quad' },
  { name: '08-清单', query: 'pickTheme=clean&view=list' },
  { name: '09-只按 DDL 排', query: 'pickTheme=clean&view=list&sort=ddl' },
  { name: '10-搜索-实验', query: 'pickTheme=clean&search=' + encodeURIComponent('实验') },
  { name: '11-新建一条', query: 'pickTheme=clean&prefill=' + encodeURIComponent('周五之前订好回家的票') },
  { name: '12-改一条', query: 'pickTheme=clean&edit=2' },
  { name: '13-设置', query: 'pickTheme=clean&sheet=set' },
  { name: '14-设置-鼓励的话', query: 'pickTheme=clean&sheet=set&cheers=' + encodeURIComponent('你已经比昨天往前走了一点\n不用一次做完，做一件算一件') },
  { name: '15-设置-备份', query: 'pickTheme=clean&sheet=set&sheetBottom=1' },
  { name: '16-已完成归档', query: 'pickTheme=clean&view=list&done=1' },
  { name: '17-今天-紧急界线改 7 天', query: 'pickTheme=clean&view=focus&urgent=7' },
  { name: '18-空清单', query: 'pickTheme=clean&view=focus', seed: 0, allowEmpty: true }
];

/* -------------------------------------------------------------------- 主流程 */

/* 包在 main() 里并且只在"直接运行这个文件"时调用 ——
   否则别的脚本 import 一下（比如为了拿 driverScript）就会把 13 张截图跑一遍。
   这个坑真的踩过：写探针脚本时 import 了本文件，结果 node 开始截图。 */
async function main() {
  const browserExe = findBrowser();
  if (!browserExe) {
    console.log('✗ 没找到 Edge，跳过截图（不影响交付，只是没有预览图）');
    process.exit(0);
  }

  fs.mkdirSync(TMP_DIR, { recursive: true });
  if (!CHECK_ONLY) fs.mkdirSync(SHOT_DIR, { recursive: true });

  console.log('浏览器：' + browserExe);
  console.log(CHECK_ONLY ? '模式：只自检\n' : '模式：截图 → 预览/\n');

  const browser = await launchBrowser({
    exe: browserExe,
    port: DEBUG_PORT,
    userDataDir: path.join(TMP_DIR, 'edge-profile')
  });

  let bad = 0;
  try {
    for (const cfg of SHOTS) {
      let r;
      try { r = await shoot(browser, cfg); }
      catch (e) { r = { name: cfg.name, error: (e && e.message) || String(e) }; }
      if (r.error) { bad++; console.log('  ✗ ' + r.name + ' —— ' + r.error); }
      else if (CHECK_ONLY) console.log('  ✓ ' + r.name + ' —— ' + r.note);
      else console.log('  ✓ ' + r.name + '.png（' + r.kb + ' KB）—— ' + r.note);
    }
  } finally {
    browser.kill();
    for (const f of fs.readdirSync(TMP_DIR)) {
      if (/^shot-.*\.html$/.test(f)) fs.unlinkSync(path.join(TMP_DIR, f));
    }
  }

  console.log('');
  if (bad) { console.log('✗ ' + bad + ' 张有问题'); process.exit(1); }
  console.log(CHECK_ONLY ? '✓ 全部自检通过' : '✓ ' + SHOTS.length + ' 张截图已写入 预览/');
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
