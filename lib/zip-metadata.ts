/**
 * Validate classic ZIP metadata before JSZip loads members, including
 * empty-member CRC32 and streaming data descriptors. JSZip 3.10.x discards
 * empty-member CRC metadata, so a later streamed read cannot check it.
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
  const names = new Set<string>();
  const localOffsets = new Set<number>();
  const memberRanges: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || u32(pos) !== 0x02014b50) {
      throw new Error("Malformed ZIP central-directory entry");
    }
    const next = pos + 46 + u16(pos + 28) + u16(pos + 30) + u16(pos + 32);
    if (next > end) throw new Error("Truncated ZIP central-directory entry");
    const nameStart = pos + 46;
    const nameEnd = nameStart + u16(pos + 28);
    // Byte-exact keys avoid text-decoder replacement collisions on malformed names.
    const rawName = Array.from(zipBytes.subarray(nameStart, nameEnd), (b) =>
      String.fromCharCode(b)).join("");
    // JSZip normalizes ../ path segments when loading. Reject ambiguous names
    // before that normalization can silently alias another central entry.
    // ASCII separator checks operate on raw bytes, preserving Unicode names.
    if (rawName.length === 0 || rawName.startsWith("/") ||
        rawName.includes("\\") || rawName.includes("\0") ||
        rawName.includes("//") || /(^|\/)\.{1,2}(\/|$)/.test(rawName)) {
      throw new Error("Unsafe ZIP central-directory filename");
    }
    if (names.has(rawName)) throw new Error("Duplicate ZIP central-directory filename");
    names.add(rawName);

    const localStart = u32(pos + 42);
    if (localOffsets.has(localStart)) throw new Error("Duplicate ZIP local-header offset");
    localOffsets.add(localStart);
    if (localStart > centralStart || centralStart - localStart < 30 ||
        u32(localStart) !== 0x04034b50) {
      throw new Error("ZIP local-header offset or signature mismatch");
    }
    const localNameStart = localStart + 30;
    const localNameLength = u16(localStart + 26);
    const localNameEnd = localNameStart + localNameLength;
    if (localNameEnd > centralStart || localNameLength !== nameEnd - nameStart) {
      throw new Error("ZIP local/central filename mismatch");
    }
    for (let j = 0; j < localNameLength; j++) {
      if (zipBytes[localNameStart + j] !== zipBytes[nameStart + j]) {
        throw new Error("ZIP local/central filename mismatch");
      }
    }
    // The local and central headers must agree on encoding and data layout.
    // Data-descriptor archives still carry matching flags and method fields.
    if (u16(localStart + 6) !== u16(pos + 8) ||
        u16(localStart + 8) !== u16(pos + 10)) {
      throw new Error("ZIP local/central flags or compression method mismatch");
    }
    // Neither a local extra field nor a declared compressed payload may
    // extend into the central directory. Use the central compressed size,
    // since data-descriptor ZIPs can leave local size fields as zero.
    const dataStart = localNameEnd + u16(localStart + 28);
    if (dataStart > centralStart || u32(pos + 20) > centralStart - dataStart) {
      throw new Error("ZIP local member data exceeds central-directory boundary");
    }
    // Each local header, name, extra field, and compressed payload must be
    // disjoint from every other member. E439 checked only the central boundary.
    const dataEnd = dataStart + u32(pos + 20);
    let memberEnd = dataEnd;
    // A streaming member (bit 3) has a descriptor after its payload.
    // Match CRC32 and both sizes to the central directory, and reserve its
    // bytes against overlap with any subsequent local member.
    if ((u16(pos + 8) & 0x0008) !== 0) {
      const matches = (at: number) =>
        at <= centralStart && centralStart - at >= 12 &&
        u32(at) === u32(pos + 16) &&
        u32(at + 4) === u32(pos + 20) &&
        u32(at + 8) === u32(pos + 24);
      // Unsigned descriptors are legal. If their CRC equals the optional
      // signature magic, still accept the 12-byte interpretation.
      const signed = dataEnd <= centralStart && centralStart - dataEnd >= 4 &&
        u32(dataEnd) === 0x08074b50 && matches(dataEnd + 4);
      const unsigned = matches(dataEnd);
      if (!signed && !unsigned) {
        throw new Error("ZIP data descriptor CRC32 or sizes mismatch");
      }
      memberEnd = dataEnd + (signed ? 16 : 12);
    }
    memberRanges.push({ start: localStart, end: memberEnd });
    if (u32(pos + 24) === 0 && u32(pos + 16) !== 0) {
      throw new Error("ZIP empty member CRC32 mismatch");
    }
    pos = next;
  }
  if (pos !== end) throw new Error("ZIP central-directory entry count mismatch");
  memberRanges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < memberRanges.length; i++) {
    if (memberRanges[i].start < memberRanges[i - 1].end) {
      throw new Error("Overlapping ZIP local member ranges");
    }
  }
}
