/* 生成 iPhone「添加到主屏幕」用的图标 icon-180.png
 * 跑法：node tools/make-icon.mjs
 *
 * 为什么自己画：不想给项目塞二进制素材，也不想引依赖。
 * 用 Node 自带的 zlib 手写 PNG，3 倍超采样再降采样，边缘平滑。
 *
 * 图案 = 四象限：白色卡片上分成四块，四块颜色就是 App 里 q1~q4 的配色。
 * 一眼就能认出"这是那个四象限的待办"。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, '..', 'icon-180.png');

const OUT_SIZE = 180;
const SS = 3;                         // 超采样倍数
const SIZE = OUT_SIZE * SS;           // 先画 540×540，最后 3×3 平均成 180

/* 底色跟着 style.css 的 clean 主题（那个靛蓝 --accent:#4f46e5） */
const BG_TOP = [0x63, 0x66, 0xea];
const BG_BOT = [0x43, 0x3c, 0xc8];
const CARD = [0xff, 0xff, 0xff];

/* 四块 = 四象限，颜色和 style.css 里的 --q1..--q4 一致 */
const Q_COLORS = [
  [0xe5, 0x48, 0x4d],   // q1 重要且紧急
  [0x2f, 0x7d, 0xf6],   // q2 重要不紧急
  [0xe0, 0x8a, 0x00],   // q3 紧急不重要
  [0x8b, 0x93, 0xa7]    // q4 都不
];

/* --------------------------------------------------------------- 图形描述 */

const CARD_X0 = 32, CARD_Y0 = 32, CARD_X1 = SIZE - 32, CARD_Y1 = SIZE - 32;
const CARD_R = 30;
const GAP = 12;                        // 四块之间的缝，让"象限"看得出来
const MID_X = (CARD_X0 + CARD_X1) / 2;
const MID_Y = (CARD_Y0 + CARD_Y1) / 2;
const BLK_R = 14;

/** 圆角矩形：点 (x,y) 在不在里面 */
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/* 四块的位置（顺时针，从左上开始就是 q1 → q2 → q3 → q4 的视觉顺序） */
const BLOCKS = [
  { x0: CARD_X0 + GAP, y0: CARD_Y0 + GAP, x1: MID_X - GAP / 2, y1: MID_Y - GAP / 2, c: 0 },
  { x0: MID_X + GAP / 2, y0: CARD_Y0 + GAP, x1: CARD_X1 - GAP, y1: MID_Y - GAP / 2, c: 1 },
  { x0: CARD_X0 + GAP, y0: MID_Y + GAP / 2, x1: MID_X - GAP / 2, y1: CARD_Y1 - GAP, c: 2 },
  { x0: MID_X + GAP / 2, y0: MID_Y + GAP / 2, x1: CARD_X1 - GAP, y1: CARD_Y1 - GAP, c: 3 }
];

/** 返回该点的颜色（底色不透明） */
function sample(x, y) {
  /* 背景：竖直渐变 */
  const t = y / SIZE;
  let r = Math.round(BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * t);
  let g = Math.round(BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * t);
  let b = Math.round(BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * t);

  if (inRoundRect(x, y, CARD_X0, CARD_Y0, CARD_X1, CARD_Y1, CARD_R)) {
    r = CARD[0]; g = CARD[1]; b = CARD[2];
    for (const k of BLOCKS) {
      if (inRoundRect(x, y, k.x0, k.y0, k.x1, k.y1, BLK_R)) {
        const col = Q_COLORS[k.c];
        r = col[0]; g = col[1]; b = col[2];
      }
    }
  }
  return [r, g, b];
}

/* ---------------------------------------------------------------- PNG 编码 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function makePng() {
  const raw = Buffer.alloc(OUT_SIZE * (OUT_SIZE * 4 + 1));
  let p = 0;
  for (let oy = 0; oy < OUT_SIZE; oy++) {
    raw[p++] = 0;                      // filter = 0
    for (let ox = 0; ox < OUT_SIZE; ox++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample(ox * SS + sx + 0.5, oy * SS + sy + 0.5);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = SS * SS;
      raw[p++] = Math.round(r / n);
      raw[p++] = Math.round(g / n);
      raw[p++] = Math.round(b / n);
      raw[p++] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(OUT_SIZE, 0);
  ihdr.writeUInt32BE(OUT_SIZE, 4);
  ihdr[8] = 8;    // 位深
  ihdr[9] = 6;    // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const png = makePng();
fs.writeFileSync(OUT, png);
console.log(`✓ 已生成 ${path.basename(OUT)}（${OUT_SIZE}×${OUT_SIZE}，${(png.length / 1024).toFixed(1)} KB）`);
