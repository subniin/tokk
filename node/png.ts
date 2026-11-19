// PNG encoder for 8-bit grayscale images. Uses only node:zlib; the CRC32 is written by hand.

import { deflateSync } from 'node:zlib';

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BIT_DEPTH = 8;
const COLOUR_TYPE_GRAY = 0;
const COMPRESSION_METHOD = 0;
const FILTER_METHOD = 0;
const INTERLACE_NONE = 0;
const FILTER_TYPE_NONE = 0;
const IHDR_LENGTH = 13;
const CRC_POLYNOMIAL = 0xedb88320;
const CRC_MASK = 0xffffffff;
const CRC_TABLE_SIZE = 256;
const BITS_PER_BYTE = 8;
const BYTE_MASK = 0xff;
const UINT32_BYTES = 4;

const CRC_TABLE = (() => {
  const table = new Uint32Array(CRC_TABLE_SIZE);
  for (let n = 0; n < CRC_TABLE_SIZE; n++) {
    let c = n;
    for (let k = 0; k < BITS_PER_BYTE; k++) c = c & 1 ? CRC_POLYNOMIAL ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

// CRC32 as used by PNG. Returns an unsigned 32-bit number.
export function crc32(bytes: Uint8Array): number {
  let c = CRC_MASK;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & BYTE_MASK] ^ (c >>> BITS_PER_BYTE);
  return (c ^ CRC_MASK) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(UINT32_BYTES + UINT32_BYTES + data.length + UINT32_BYTES);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < type.length; i++) out[UINT32_BYTES + i] = type.charCodeAt(i);
  out.set(data, 2 * UINT32_BYTES);
  const typeAndData = out.subarray(UINT32_BYTES, 2 * UINT32_BYTES + data.length);
  view.setUint32(2 * UINT32_BYTES + data.length, crc32(typeAndData), false);
  return out;
}

function isSize(n: number): boolean {
  return Number.isInteger(n) && n >= 1;
}

// Row 0 of `gray` is the top row. Throws RangeError for a bad size or a length that is not width * height.
export function encodePng(width: number, height: number, gray: Uint8Array): Uint8Array {
  if (!isSize(width) || !isSize(height)) {
    throw new RangeError(`width and height must be integers of at least 1, got ${width} and ${height}`);
  }
  if (gray.length !== width * height) {
    throw new RangeError(`gray must hold width * height = ${width * height} values, got ${gray.length}`);
  }
  const stride = 1 + width;
  const raw = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = FILTER_TYPE_NONE;
    raw.set(gray.subarray(y * width, (y + 1) * width), y * stride + 1);
  }
  const ihdr = new Uint8Array(IHDR_LENGTH);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false);
  view.setUint32(UINT32_BYTES, height, false);
  ihdr[8] = BIT_DEPTH;
  ihdr[9] = COLOUR_TYPE_GRAY;
  ihdr[10] = COMPRESSION_METHOD;
  ihdr[11] = FILTER_METHOD;
  ihdr[12] = INTERLACE_NONE;
  const parts = [SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}
