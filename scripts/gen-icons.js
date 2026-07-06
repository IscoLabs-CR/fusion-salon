// Genera los iconos PWA de Fusion Salon (destello turquesa + dorado sobre negro,
// en línea con el logo) sin dependencias. Uso:  node scripts/gen-icons.js [carpeta]
// Por defecto escribe en ./public. Corré esto una vez al generar el proyecto.
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const OUT = process.argv[2] || path.join(process.cwd(), "public");

const BG = [0x0b, 0x12, 0x10]; // negro del logo
const TEAL = [0x1f, 0xd4, 0xc6]; // turquesa del logo
const GOLD = [0xc1, 0x9a, 0x4b]; // dorado del logo
const WHITE = [0xff, 0xff, 0xff];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// 4-point sparkle (astroid): |u|^(2/3) + |v|^(2/3) <= 1
function inSparkle(x, y, cx, cy, r) {
  if (r <= 0) return false;
  const u = Math.abs((x - cx) / r);
  const v = Math.abs((y - cy) / r);
  return Math.pow(u, 2 / 3) + Math.pow(v, 2 / 3) <= 1;
}

function drawIcon(N, opts = {}) {
  const {
    mono = false,
    bg = BG,
    mainR = 0.42,
    accent = true,
  } = opts;
  const buf = Buffer.alloc(N * N * 4);
  const cx = N / 2;
  const cy = N / 2;
  const mR = N * mainR;
  const aCx = N * 0.70;
  const aCy = N * 0.30;
  const aR = N * 0.15;
  const SS = 3; // supersampling for smooth edges

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          let col = null;
          if (mono) {
            if (inSparkle(px, py, cx, cy, mR)) col = WHITE;
          } else if (accent && inSparkle(px, py, aCx, aCy, aR)) {
            col = GOLD;
          } else if (inSparkle(px, py, cx, cy, mR)) {
            col = TEAL;
          } else if (bg) {
            col = bg;
          }
          if (col) {
            r += col[0];
            g += col[1];
            b += col[2];
            a += 255;
          }
        }
      }
      const n = SS * SS;
      const i = (y * N + x) * 4;
      if (a === 0) {
        buf[i] = buf[i + 1] = buf[i + 2] = buf[i + 3] = 0;
      } else {
        // Promedia sobre las submuestras cubiertas para un borde suave.
        const cov = a / (n * 255);
        buf[i] = Math.round(r / (n * cov));
        buf[i + 1] = Math.round(g / (n * cov));
        buf[i + 2] = Math.round(b / (n * cov));
        buf[i + 3] = Math.round(255 * cov);
      }
    }
  }
  return encodePng(N, N, buf);
}

const targets = [
  ["icon-192.png", 192, { mainR: 0.42, accent: true }],
  ["icon-512.png", 512, { mainR: 0.42, accent: true }],
  ["icon-maskable-512.png", 512, { mainR: 0.34, accent: true }], // safe zone
  ["apple-touch-icon.png", 180, { mainR: 0.42, accent: true }],
  ["badge.png", 96, { mono: true, bg: null, mainR: 0.44, accent: false }],
];

fs.mkdirSync(OUT, { recursive: true });
for (const [name, size, opts] of targets) {
  fs.writeFileSync(path.join(OUT, name), drawIcon(size, opts));
  console.log("wrote", path.join(OUT, name));
}
