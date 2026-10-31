// Offline, dependency-free smoke tests for the exact committed ZIP preflight.
// Run with Node >=22.16: node --experimental-strip-types scripts/zip-preflight-smoke.mjs
import { validateEmptyZipCrc } from "../lib/zip-metadata.ts";

const bytes = (n) => new Uint8Array(n);
const view = (a) => new DataView(a.buffer, a.byteOffset, a.byteLength);
const w16 = (a, o, x) => view(a).setUint16(o, x, true);
const w32 = (a, o, x) => view(a).setUint32(o, x >>> 0, true);
const r16 = (a, o) => view(a).getUint16(o, true);
const r32 = (a, o) => view(a).getUint32(o, true);
const ascii = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
function cat(...parts) {
  const out = bytes(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
function makeZip(stream = false, members = [
  ["manifest.json", '{"name":"Smoke","version":"1","manifest_version":3}'],
  ["background.js", "A".repeat(200)],
]) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, body] of members) {
    const nameBytes = ascii(name), data = ascii(body), flags = stream ? 8 : 0;
    const localHeader = bytes(30);
    w32(localHeader, 0, 0x04034b50);
    w16(localHeader, 4, 20);
    w16(localHeader, 6, flags);
    if (!stream) {
      w32(localHeader, 14, 0);
      w32(localHeader, 18, data.length);
      w32(localHeader, 22, data.length);
    }
    w16(localHeader, 26, nameBytes.length);
    const descriptor = bytes(stream ? 16 : 0);
    if (stream) {
      w32(descriptor, 0, 0x08074b50);
      w32(descriptor, 8, data.length);
      w32(descriptor, 12, data.length);
    }
    const local = cat(localHeader, nameBytes, data, descriptor);
    locals.push(local);
    const centralHeader = bytes(46);
    w32(centralHeader, 0, 0x02014b50);
    w16(centralHeader, 4, 20);
    w16(centralHeader, 6, 20);
    w16(centralHeader, 8, flags);
    w32(centralHeader, 20, data.length);
    w32(centralHeader, 24, data.length);
    w16(centralHeader, 28, nameBytes.length);
    w32(centralHeader, 42, offset);
    centrals.push(cat(centralHeader, nameBytes));
    offset += local.length;
  }
  const central = cat(...centrals), eocd = bytes(22);
  w32(eocd, 0, 0x06054b50);
  w16(eocd, 8, members.length);
  w16(eocd, 10, members.length);
  w32(eocd, 12, central.length);
  w32(eocd, 16, offset);
  return cat(...locals, central, eocd);
}
function entries(a) {
  const first = r32(a, a.length - 22 + 16);
  const second = first + 46 + r16(a, first + 28) + r16(a, first + 30) + r16(a, first + 32);
  return { first, second };
}
const results = [];
function check(name, archive, expected) {
  let outcome = "ACCEPT";
  try { validateEmptyZipCrc(archive); }
  catch (error) { outcome = error.message; }
  const passed = expected.test(outcome);
  results.push({ name, outcome, passed });
  if (!passed) throw new Error(name + ": expected " + expected + ", got " + outcome);
}
let a = makeZip();
check("valid classic", a, /^ACCEPT$/);
a = makeZip(true);
check("valid streaming", a, /^ACCEPT$/);
a = makeZip();
{
  const { first } = entries(a), local = r32(a, first + 42);
  w32(a, first + 20, a.length);
  w32(a, local + 18, a.length);
  check("E439 oversized payload reaches bounds gate", a, /local member data exceeds/);
}
a = makeZip();
{
  const { first, second } = entries(a);
  const local = r32(a, first + 42), nextLocal = r32(a, second + 42);
  const dataStart = local + 30 + r16(a, local + 26) + r16(a, local + 28);
  const size = nextLocal - dataStart + 2;
  w32(a, first + 20, size);
  w32(a, local + 18, size);
  check("E440 nonstream overlap reaches overlap gate", a, /Overlapping ZIP local member ranges/);
}
a = makeZip(true);
{
  const { first, second } = entries(a);
  const local = r32(a, first + 42), nextLocal = r32(a, second + 42);
  const start = local + 30 + r16(a, local + 26) + r16(a, local + 28);
  const nextData = nextLocal + 30 + r16(a, nextLocal + 26) + r16(a, nextLocal + 28);
  const descriptor = nextData + 2, size = descriptor - start;
  w32(a, first + 20, size);
  w32(a, descriptor, 0x08074b50);
  w32(a, descriptor + 4, r32(a, first + 16));
  w32(a, descriptor + 8, size);
  w32(a, descriptor + 12, r32(a, first + 24));
  check("E440 streaming overlap reaches overlap gate", a, /Overlapping ZIP local member ranges/);
}
a = makeZip();
{
  const { first, second } = entries(a);
  const local = r32(a, first + 42), nextLocal = r32(a, second + 42);
  const nameEnd = local + 30 + r16(a, local + 26);
  const extraSize = nextLocal - nameEnd + 2;
  w16(a, nameEnd, 0x9999);
  w16(a, nameEnd + 2, extraSize - 4);
  w16(a, local + 28, extraSize);
  check("E440 valid TLV overlap reaches overlap gate", a, /Overlapping ZIP local member ranges/);
}
a = makeZip(false, [["empty.js", ""]]);
{
  const central = r32(a, a.length - 22 + 16);
  w32(a, central + 16, 1);
  w32(a, 14, 1);
  check("E436 empty CRC metadata mismatch", a, /empty member CRC32 mismatch/);
}
a = makeZip(true);
{
  const { first } = entries(a), local = r32(a, first + 42);
  const descriptor = local + 30 + r16(a, local + 26) + r16(a, local + 28) + r32(a, first + 20);
  w32(a, descriptor + 4, 1);
  check("E441 streaming descriptor CRC mismatch", a, /data descriptor CRC32 or sizes mismatch/);
}
a = makeZip();
{
  const { first } = entries(a), local = r32(a, first + 42);
  w32(a, first + 16, 1);
  w32(a, local + 14, 1);
  check("nonempty CRC is deferred, not authenticated by preflight", a, /^ACCEPT$/);
}
const many = (n) => Array.from({ length: n }, (_, i) => ["f" + i + ".js", ""]);
check("E443 accepts exactly 2000 entries", makeZip(false, many(2000)), /^ACCEPT$/);
check("E443 rejects 2001 entries", makeZip(false, many(2001)), /more than 2000 entries/);
console.log(JSON.stringify({ passed: results.length, results }, null, 2));
