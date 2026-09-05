// One-off generator for the tray icon: a solid teal circle on a
// transparent background, hand-built as a PNG so we don't need an image
// library just to make one small dot. Run with `node generate-icon.js`.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 32;
const RADIUS = 13;
const CENTER = SIZE / 2;
const COLOR = [0x35, 0xc9, 0xa8]; // --accent teal

function buildPng() {
  const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
  let offset = 0;

  for (let y = 0; y < SIZE; y++) {
    raw[offset++] = 0; // filter type: none
    for (let x = 0; x < SIZE; x++) {
      const dx = x + 0.5 - CENTER;
      const dy = y + 0.5 - CENTER;
      const inside = dx * dx + dy * dy <= RADIUS * RADIUS;
      raw[offset++] = COLOR[0];
      raw[offset++] = COLOR[1];
      raw[offset++] = COLOR[2];
      raw[offset++] = inside ? 255 : 0;
    }
  }

  const idat = zlib.deflateSync(raw);

  const chunks = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])]; // PNG signature
  chunks.push(makeChunk('IHDR', ihdr()));
  chunks.push(makeChunk('IDAT', idat));
  chunks.push(makeChunk('IEND', Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

function ihdr() {
  const buf = Buffer.alloc(13);
  buf.writeUInt32BE(SIZE, 0);
  buf.writeUInt32BE(SIZE, 4);
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

const outPath = path.join(__dirname, 'assets', 'tray-icon.png');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, buildPng());
console.log(`Wrote ${outPath}`);
