/**
 * Check central-directory CRC for zero-length ZIP members before JSZip loads them.
 * JSZip 3.10.x discards the CRC metadata of empty loaded entries, so a
 * subsequent streamed read cannot check it. This parses metadata only;
 * it does not decompress files or authenticate archive contents.
 */
export function validateEmptyZipCrc(zipBytes: Uint8Array): void {
  const length = zipBytes.byteLength;
  if (length < 22) throw new Error("ZIP end-of-central-directory record missing");
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, length);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);
  let eocd = -1;
  // ZIP comments are at most 65,535 bytes. Require the EOCD comment to end
  // at the archive boundary, so a signature inside payload is not trusted.
  for (let pos = length - 22; pos >= Math.max(0, length - 22 - 0xffff); pos--) {
    if (u32(pos) === 0x06054b50 && pos + 22 + u16(pos + 20) === length) {
      eocd = pos;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP end-of-central-directory record missing");
  const count = u16(eocd + 10);
  const centralBytes = u32(eocd + 12);
  const centralStart = u32(eocd + 16);
  if (u16(eocd + 4) !== 0 || u16(eocd + 6) !== 0 ||
      u16(eocd + 8) !== count || count === 0xffff ||
      centralBytes === 0xffffffff || centralStart === 0xffffffff) {
    throw new Error("Unsupported split or ZIP64 central directory");
  }
  if (centralStart > eocd || centralBytes > eocd - centralStart ||
      centralStart + centralBytes !== eocd) {
    throw new Error("ZIP central-directory boundaries are inconsistent");
  }
  const end = centralStart + centralBytes;
  let pos = centralStart;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || u32(pos) !== 0x02014b50) {
      throw new Error("Malformed ZIP central-directory entry");
    }
    const next = pos + 46 + u16(pos + 28) + u16(pos + 30) + u16(pos + 32);
    if (next > end) throw new Error("Truncated ZIP central-directory entry");
    if (u32(pos + 24) === 0 && u32(pos + 16) !== 0) {
      throw new Error("ZIP empty member CRC32 mismatch");
    }
    pos = next;
  }
  if (pos !== end) throw new Error("ZIP central-directory entry count mismatch");
}
