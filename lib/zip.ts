// Uncompressed streaming ZIP64 with verified sizes and CRCs in each header;
// only the current file and central-directory metadata are held in memory.
const encoder = new TextEncoder();
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); return n >>> 0; });
const crc32 = (bytes: Uint8Array) => { let crc = 0xffffffff; for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]; return (crc ^ 0xffffffff) >>> 0; };
function header(size: number, values: [number, number | bigint, number][]) { const bytes = new Uint8Array(size), view = new DataView(bytes.buffer); for (const [offset, value, width] of values) { if (width === 2) view.setUint16(offset, Number(value), true); else if (width === 4) view.setUint32(offset, Number(value), true); else view.setBigUint64(offset, BigInt(value), true); } return bytes; }
export type ZipEntry = { name: string; bytes: () => Promise<Uint8Array> };
export async function* zipEntries(entries: ZipEntry[]): AsyncGenerator<Uint8Array> {
  let offset = BigInt(0); const central: Uint8Array[] = [];
  for (const entry of entries) {
    const name = encoder.encode(entry.name), start = offset, bytes = await entry.bytes(), crc = crc32(bytes), size = bytes.length;
    const local = header(30, [[0, 0x04034b50, 4], [4, 45, 2], [6, 0x0800, 2], [14, crc, 4], [18, size, 4], [22, size, 4], [26, name.length, 2]]);
    yield local; yield name; yield bytes; offset += BigInt(local.length + name.length + size);
    const extra = header(12, [[0, 1, 2], [2, 8, 2], [4, start, 8]]);
    central.push(header(46, [[0, 0x02014b50, 4], [4, 45, 2], [6, 45, 2], [8, 0x0800, 2], [16, crc, 4], [20, size, 4], [24, size, 4], [28, name.length, 2], [30, extra.length, 2], [42, 0xffffffff, 4]]), name, extra);
  }
  const directoryOffset = offset; for (const bytes of central) { yield bytes; offset += BigInt(bytes.length); }
  const directorySize = offset - directoryOffset;
  yield header(56, [[0, 0x06064b50, 4], [4, 44, 8], [12, 45, 2], [14, 45, 2], [24, entries.length, 8], [32, entries.length, 8], [40, directorySize, 8], [48, directoryOffset, 8]]);
  yield header(20, [[0, 0x07064b50, 4], [8, offset, 8], [16, 1, 4]]);
  yield header(22, [[0, 0x06054b50, 4], [8, 0xffff, 2], [10, 0xffff, 2], [12, 0xffffffff, 4], [16, 0xffffffff, 4]]);
}
export function zipStream(entries: ZipEntry[]) {
  const iterator = zipEntries(entries);
  return new ReadableStream<Uint8Array>({ async pull(controller) { try { const result = await iterator.next(); if (result.done) controller.close(); else controller.enqueue(result.value); } catch (error) { controller.error(error); } }, async cancel() { await iterator.return(undefined); } });
}
