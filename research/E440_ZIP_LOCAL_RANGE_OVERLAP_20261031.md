# E440 | Disallow overlapping ZIP local member ranges (2026-10-31)

## Continuity and question
E439 checked each local header and compressed payload against the beginning of the central directory, but did not check **one member against another**. Can a central-directory record claim compressed bytes belonging to the next member's local header without exceeding the central-directory boundary? Yes.

This is a synthetic metadata-integrity counterexample, not proof of a real-world exploit.

## Expected-red reproduction
Used the exact E439 `lib/zip-metadata.ts` source (Git blob `28f300ab0e7472268b5c9a960f172b810bdc566d`) compiled with TypeScript 5.8.3, plus Python `zipfile` fixtures. Two ordinary/nonseekable data-descriptor ZIP layouts each had four deliberately malformed variations:
- Three central compressed-size changes extending the first payload 1, 4, or 12 bytes into the next local header.
- One local extra-field length change extending the first member into the next header.

All **8/8 malformed fixtures were accepted** by the original E439 helper. This demonstrates a preflight inconsistency, not that JSZip would successfully parse all malformed archives.

## Correction
Track half-open intervals `[localHeaderOffset, compressedPayloadEnd)` for each central-directory member, sort by start, and reject any overlap with the preceding interval. Each interval includes the 30-byte local header, filename, extra field, and declared compressed payload. Existing checks still reject central-directory overflow, duplicate offsets, unsafe names, conflicting methods/flags and invalid empty CRC metadata. No decompression or network access is added.

## Executed offline validation
- **8/8** intentionally overlapping ZIP fixtures rejected by corrected helper.
- **42/42** valid ZIP fixtures accepted, including ordinary and nonseekable data-descriptor layouts, and 40 varied archives with 1–40 members.
- Strict standalone TypeScript compilation passed (Node 22.16.0, TypeScript 5.8.3).
- Exact committed corrected helper Git blob: `62ce67fe3bf06458ad1eedcb0de702fbcc90e6a2`, matching the local source used for these checks.
- Four new repository Vitest cases were committed but **not run**.

## Negative boundaries and integration gates
- This interval check does not parse or authenticate optional ZIP data descriptors, so it does not prove that descriptor bytes are disjoint from later headers.
- Unicode extra-field interpretation and filename-decoding aliases are not covered.
- Real CRX compatibility, repository Vitest, full typecheck, Next.js build, and exact-head CI remain **unverified**. The previously exhausted included GitHub Actions minutes were not intentionally charged.
- Conservative rejection may exclude some nonconforming ZIP producers; test authorized real CRX samples before integration.
- CRC32 is not cryptographic authentication. This branch is stacked on E435 #37 and E434 #36 and must remain draft/unmerged pending full validation.

## Next falsifiable experiment
Construct a data-descriptor ZIP whose descriptor overlaps the next local header while compressed payload intervals remain disjoint; determine whether the archive is valid under the ZIP specification and whether JSZip interprets it differently. Separately test Unicode path extra-field collisions using real CRX fixtures.

No external outreach, production data, deployments, payments or account settings were changed.
