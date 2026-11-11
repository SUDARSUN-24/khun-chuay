// Turn text into a QR code PNG image, entirely inside the worker.
// No outside QR service, so nobody else ever sees the PromptPay number.
import qrcode from "qrcode-generator";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function zlib(data) {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function qrMatrix(text) {
  const qr = qrcode(0, "M"); // 0 = pick the smallest size that fits, M = ~15% damage-proof
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

// 8-bit greyscale PNG, `scale` pixels per QR square, 4-square white border.
export async function qrPng(text, scale = 10) {
  const m = qrMatrix(text);
  const border = 4;
  const size = (m.length + border * 2) * scale;
  const raw = new Uint8Array(size * (size + 1)); // +1 per row: PNG filter byte (0 = none)
  for (let y = 0; y < size; y++) {
    const row = y * (size + 1);
    const my = Math.floor(y / scale) - border;
    for (let x = 0; x < size; x++) {
      const mx = Math.floor(x / scale) - border;
      const dark = my >= 0 && mx >= 0 && my < m.length && mx < m.length && m[my][mx];
      raw[row + 1 + x] = dark ? 0 : 255;
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, size);
  v.setUint32(4, size);
  ihdr.set([8, 0, 0, 0, 0], 8); // bit depth 8, greyscale, default compression/filter/interlace
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", await zlib(raw)),
    chunk("IEND", new Uint8Array()),
  ];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { png.set(p, o); o += p.length; }
  return png;
}
