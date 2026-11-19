// Test helper: reads a PNG into its chunks, IHDR fields and inflated scan lines.

import { inflateSync } from 'node:zlib';
import { crc32 } from '../../node/png';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const LENGTH_BYTES = 4;
const TYPE_BYTES = 4;
const CRC_BYTES = 4;

export interface PngChunk { type: string; data: Uint8Array; crcStored: number; crcOk: boolean }
export interface PngHeader {
  width: number; height: number; bitDepth: number; colourType: number; compression: number; filter: number; interlace: number;
}
export interface PngRead { signatureOk: boolean; chunks: PngChunk[]; ihdr: PngHeader; rows: Uint8Array[] }

export function readPng(bytes: Uint8Array): PngRead {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signatureOk = SIGNATURE.every((b, i) => bytes[i] === b);
  const chunks: PngChunk[] = [];
  let pos = SIGNATURE.length;
  while (pos + LENGTH_BYTES + TYPE_BYTES + CRC_BYTES <= bytes.length) {
    const length = view.getUint32(pos, false);
    const typeStart = pos + LENGTH_BYTES;
    const dataStart = typeStart + TYPE_BYTES;
    const type = String.fromCharCode(...bytes.subarray(typeStart, dataStart));
    const data = bytes.subarray(dataStart, dataStart + length);
    const crcStored = view.getUint32(dataStart + length, false);
    const crcOk = crc32(bytes.subarray(typeStart, dataStart + length)) === crcStored;
    chunks.push({ type, data, crcStored, crcOk });
    pos = dataStart + length + CRC_BYTES;
  }
  const head = chunks.find((c) => c.type === 'IHDR');
  if (!head) throw new Error('no IHDR chunk');
  const hv = new DataView(head.data.buffer, head.data.byteOffset, head.data.byteLength);
  const ihdr: PngHeader = {
    width: hv.getUint32(0, false), height: hv.getUint32(4, false), bitDepth: head.data[8], colourType: head.data[9],
    compression: head.data[10], filter: head.data[11], interlace: head.data[12],
  };
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = inflateSync(idat);
  const stride = 1 + ihdr.width;
  const rows: Uint8Array[] = [];
  for (let y = 0; y < raw.length / stride; y++) rows.push(new Uint8Array(raw.subarray(y * stride, (y + 1) * stride)));
  return { signatureOk, chunks, ihdr, rows };
}
