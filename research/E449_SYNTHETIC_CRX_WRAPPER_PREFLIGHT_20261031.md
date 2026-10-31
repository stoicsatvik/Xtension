# E449: Synthetic CRX2/CRX3 wrapper-to-ZIP preflight regression

Date: 2026-10-31. Status: draft research, no merge/deployment.

## Question
Do the existing `stripCrxHeader` and E436-E448 ZIP metadata preflight accept correctly offset synthetic CRX2/CRX3 wrappers, reject oversized wrapper lengths, and reject malformed empty-member ZIP CRC metadata *after* stripping? This checks a previously untested composition boundary, **not** real signed CRX compatibility.

## Inputs and exact-source offline execution
- Retrieved `lib/analyzer.ts` Git blob `c1e3091a3f4ddd6fe894033d06fe78e63678edab` and `lib/zip-metadata.ts` blob `747606b773c61d5c5ddff248766e9420d284a273` from the E448 head.
- Extracted the unchanged `stripCrxHeader` function and mechanically removed TypeScript-only annotations from the exact metadata preflight, then evaluated them in an isolated V8 runtime.
- Constructed a deterministic classic ZIP with one genuinely empty `empty.js` entry and consistent local/central metadata; wrapped it with CRX2 (4-byte key, 3-byte signature) and CRX3 (7-byte header) synthetic prefixes.
- Executed six focused assertions: CRX2 and CRX3 correct strip plus preflight acceptance (2); oversized wrapper-header rejection (2); matching-but-invalid local/central empty-member CRC rejection after stripping (2). **6/6 passed**.
- Preserved a negative fixture observation: mutating *only* the central CRC is rejected at E444's local/central agreement gate, not the E436 empty-member CRC gate. Both metadata fields must be changed to reach the intended latter gate.

## Repository regression changes
Appended six parameterized Vitest integration cases in `tests/analyzer.test.ts`. Unlike the isolated experiment, these cases call the full `analyzePackage` path with JSZip-generated STORE packages and test actual analyzer report fields. They are deliberately named *synthetic* CRX wrapper tests. No production source was changed.

## Limits and next gate
- **The six new Vitest cases have not run.** Full repository Vitest, full typecheck, production build, exact-head CI, and authorized real signed CRX2/CRX3 compatibility remain unverified.
- Isolated V8 execution validated exact-source strip and preflight functions but **did not** execute JSZip or `analyzePackage`. It is not equivalent to the committed integration tests.
- These wrappers contain arbitrary header bytes, not valid CRX cryptographic signatures. This is parsing and integrity-gate evidence, not authenticity or real-world Chrome Web Store compatibility.
- No external outreach, paid Actions workflow, merge, or deployment. PR #38 remains draft and stacked on #37/#36.
- Next: run repository Vitest and real authorized CRX fixtures in verified no-charge capacity before considering integration.
