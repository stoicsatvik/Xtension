# E490 | Fail closed on unbounded HTTP CRX response buffering

Date: 2026-11-02. Isolated draft-branch security correction.

## Falsifiable defect

The previous lib/fetch-extension.ts checks an optional Content-Length header and then calls response.arrayBuffer() before testing the actual package size. A response with no Content-Length, a misleading short Content-Length, or a chunked body can therefore allocate beyond the advertised 25 MiB limit before rejection. This is a source-level resource-exhaustion risk. No attack against a real service was attempted; remote exploitability is NOT PROVEN.

## Correction

lib/bounded-download.ts enforces a positive safe-integer byte budget while consuming a ReadableStream, rejects malformed or oversized declared lengths, rejects empty bodies, and cancels the upstream reader as soon as the actual byte count would exceed the budget. It assembles accepted bytes only after bounded consumption. fetchAndAnalyzeExtension maps bounded download failures to the existing ExtensionFetchError status contract (413 for oversized, 502 for malformed/empty/transport failures). It continues to fetch only from the fixed Google update endpoint after extension-ID validation, and never executes extension JavaScript.

## Tests and evidence

- Standalone strict TypeScript compilation of the new helper: PASS (ES2022, DOM, strict).
- Node 22 exact-helper tests: 10/10 PASS for exact-limit success, absent-header early stop, false short header, declared oversize before any pull, four malformed length headers, empty response and invalid budget.
- Native repository Vitest regression cases are committed but NOT YET EXECUTED. Full Next.js build/typecheck and exact-head GitHub Actions NOT VERIFIED; no paid CI manually dispatched.
- All test streams are synthetic and use small byte budgets. No live CRX fetch, browser action, deployment or production change occurred.

## Claim boundaries

- SUPPORTED locally: the original response buffering had no streaming byte limit; the new helper enforces the stated cap in tested synthetic streams.
- NOT YET PROVEN: full Next.js integration, real Google CRX compatibility, browser deployment behavior, service-level exploitability or end-to-end memory limits under adversarial transports.
- Next: full Vitest and Next.js build/typecheck in a permitted environment; check real, legitimately accessible CRX compatibility with pinned hashes and an isolated service. Inspect HTTP redirect and fetch-timeout controls separately.
