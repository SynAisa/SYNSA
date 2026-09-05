// One-off generator for the app's icons: a solid teal circle on a
// transparent background, hand-built as PNG/ICO so we don't need an image
// library just to make one small dot. Run with `node generate-icon.js`.
//
// Produces two files from the same shape at different sizes:
//   - assets/tray-icon.png (32x32) — used for the tray icon and window icon.
//   - assets/app-icon.ico (16/32/48/256, PNG-compressed frames) — used for
//     the installer/uninstaller and the installed app's .exe icon.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const RADIUS_RATIO = 13 / 32; // keeps the circle's proportions identical at every size
const COLOR = [0x35, 0xc9, 0xa8]; // --accent teal

function buildPng(size) {
  const radius = Math.round(size * RADIUS_RATIO);
  const center = size / 2;
  const raw = Buffer.alloc(size * (1 + size * 4));
  let offset = 0;

  for (let y = 0; y < size; y++) {
    raw[offset++] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - center;
      const dy = y + 0.5 - center;
      const inside = dx * dx + dy * dy <= radius * radius;
      raw[offset++] = COLOR[0];
      raw[offset++] = COLOR[1];
      raw[offset++] = COLOR[2];
      raw[offset++] = inside ? 255 : 0;
    }
  }

  const idat = zlib.deflateSync(raw);

  const chunks = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])]; // PNG signature
  chunks.push(makeChunk('IHDR', ihdr(size)));
  chunks.push(makeChunk('IDAT', idat));
  chunks.push(makeChunk('IEND', Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

function ihdr(size) {
  const buf = Buffer.alloc(13);
  buf.writeUInt32BE(size, 0);
  buf.writeUInt32BE(size, 4);
  buf[8] = 8; // bit depth
  buf[9] = 6; // color type: RGBA
  buf[10] = 0; // compression
  buf[11] = 0; // filter
  buf[12] = 0; // interlace
  return buf;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

// ICO container holding PNG-compressed frames — supported since Vista and
// the simplest way to reuse the PNG encoder above instead of also writing a
// BMP/DIB encoder just for the installer icon.
function buildIco(sizes) {
  const images = sizes.map(buildPng);
  const headerSize = 6 + 16 * images.length;
  let offset = headerSize;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  images.forEach((png, i) => {
    const entry = Buffer.alloc(16);
    const size = sizes[i];
    entry[0] = size >= 256 ? 0 : size; // width, 0 means 256
    entry[1] = size >= 256 ? 0 : size; // height, 0 means 256
    entry[2] = 0; // color count
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entry.copy(header, 6 + 16 * i);
    offset += png.length;
  });

  return Buffer.concat([header, ...images]);
}

const assetsDir = path.join(__dirname, 'assets');
fs.mkdirSync(assetsDir, { recursive: true });

const trayPath = path.join(assetsDir, 'tray-icon.png');
fs.writeFileSync(trayPath, buildPng(32));
console.log(`Wrote ${trayPath}`);

const icoPath = path.join(assetsDir, 'app-icon.ico');
fs.writeFileSync(icoPath, buildIco([16, 32, 48, 256]));
console.log(`Wrote ${icoPath}`);
