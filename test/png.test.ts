import { describe, it, expect } from 'vitest';
import { crc32, encodePng } from '../node/png';
import { readPng } from './helpers/png-read';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IEND_CHUNK = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
const CRC_CHECK_VALUE = 0xcbf43926;
const IHDR_OFFSET = 8;
const IHDR_END = 32;
const IHDR_DATA_LENGTH = 13;
const GRADIENT_SIZE_PX = 256;
const GRAY_STEP = 7;

const small = (): Uint8Array => Uint8Array.from([0, 10, 20, 255, 128, 1]);

describe('crc32 (Req 2.4, 2.5)', () => {
  it('gives the standard check value for "123456789"', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(CRC_CHECK_VALUE);
  });
  it('gives AE426082 for the bytes IEND', () => {
    expect(crc32(new TextEncoder().encode('IEND'))).toBe(0xae426082);
  });
});

describe('encodePng structure (Req 2)', () => {
  it('starts with the signature and holds a 13-byte IHDR with the given size', () => {
    const png = encodePng(3, 2, small());
    expect([...png.subarray(0, 8)]).toEqual(SIGNATURE);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(view.getUint32(IHDR_OFFSET, false)).toBe(IHDR_DATA_LENGTH);
    expect(String.fromCharCode(...png.subarray(IHDR_OFFSET + 4, IHDR_OFFSET + 8))).toBe('IHDR');
    expect(png.length).toBeGreaterThan(IHDR_END);
    const { ihdr } = readPng(png);
    expect(ihdr).toEqual({ width: 3, height: 2, bitDepth: 8, colourType: 0, compression: 0, filter: 0, interlace: 0 });
  });

  it('ends with the IEND chunk whose CRC bytes are AE 42 60 82', () => {
    const png = encodePng(3, 2, small());
    expect([...png.subarray(png.length - 12)]).toEqual(IEND_CHUNK);
  });

  it('has the chunk order IHDR, IDAT, IEND and every stored CRC equals the computed one', () => {
    const read = readPng(encodePng(3, 2, small()));
    expect(read.signatureOk).toBe(true);
    expect(read.chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    for (const c of read.chunks) expect(c.crcOk).toBe(true);
  });

  it('writes scan lines of 1 + width bytes with filter byte 0 and the given pixels', () => {
    const { rows } = readPng(encodePng(3, 2, small()));
    expect(rows.map((r) => [...r])).toEqual([[0, 0, 10, 20], [0, 255, 128, 1]]);
  });

  it('encodes a 1x1 image', () => {
    const read = readPng(encodePng(1, 1, Uint8Array.from([77])));
    expect(read.ihdr.width).toBe(1);
    expect(read.ihdr.height).toBe(1);
    expect([...read.rows[0]]).toEqual([0, 77]);
  });

  it('round-trips a 256x256 gradient', () => {
    const gray = new Uint8Array(GRADIENT_SIZE_PX * GRADIENT_SIZE_PX);
    for (let y = 0; y < GRADIENT_SIZE_PX; y++) {
      for (let x = 0; x < GRADIENT_SIZE_PX; x++) gray[y * GRADIENT_SIZE_PX + x] = (x + y * GRAY_STEP) & 0xff;
    }
    const read = readPng(encodePng(GRADIENT_SIZE_PX, GRADIENT_SIZE_PX, gray));
    expect(read.rows.length).toBe(GRADIENT_SIZE_PX);
    for (let y = 0; y < GRADIENT_SIZE_PX; y++) {
      expect(read.rows[y].length).toBe(1 + GRADIENT_SIZE_PX);
      expect(read.rows[y][0]).toBe(0);
      expect([...read.rows[y].subarray(1)]).toEqual([...gray.subarray(y * GRADIENT_SIZE_PX, (y + 1) * GRADIENT_SIZE_PX)]);
    }
    for (const c of read.chunks) expect(c.crcOk).toBe(true);
  });

  it('does not change the input and gives identical bytes on two calls', () => {
    const gray = small();
    const copy = Uint8Array.from(gray);
    const a = encodePng(3, 2, gray);
    const b = encodePng(3, 2, gray);
    expect([...gray]).toEqual([...copy]);
    expect([...a]).toEqual([...b]);
  });
});

describe('encodePng errors (Req 2.6)', () => {
  it('throws RangeError for width 0, height 0, a non-integer size and a wrong length', () => {
    expect(() => encodePng(0, 2, new Uint8Array(0))).toThrow(RangeError);
    expect(() => encodePng(2, 0, new Uint8Array(0))).toThrow(RangeError);
    expect(() => encodePng(1.5, 2, new Uint8Array(3))).toThrow(RangeError);
    expect(() => encodePng(3, 2, new Uint8Array(5))).toThrow(RangeError);
    expect(() => encodePng(3, 2, new Uint8Array(7))).toThrow(RangeError);
  });
});
