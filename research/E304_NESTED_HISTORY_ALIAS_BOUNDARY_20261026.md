# E304 | Nested browsing-URL alias export boundary (2026-10-26)

## Question
Does E283's allowlisted-storage-key privacy guard reject raw browsing-page URLs
when they appear under ordinary nested object keys rather than Chrome's
canonical `historyUrls`, `visits`, or `url`+`visitCount` shapes?

## Reproducible counterexamples and correction
Inspection of the E283 implementation found that its recursive validator
accepted nested `pageUrl`, `href`+`visitTime`, and a generic `url`
without visit counters. These are synthetic records, not actual user history.
The test fixtures contain a deliberately fake private.example URL.

E304 adds fail-closed handling of ambiguous page-URL aliases and recognizable
Chrome visit metadata under every approved evidence storage key. It preserves
explicit extension metadata keys such as `homepageUrl`, `optionsUrl`, and
`hostPermissions`, plus ordinary non-visit trial transition labels.
The shared `snapshotLocalEvidence` function now structured-clones and
validates each accepted object before it is returned by local JSON export
or added to the local MCP sync snapshot.

The prior validator's acceptance follows directly from its old field
sets. Do not claim a captured red CI run: the original test-only commit
did not have an E304 workflow, and unrelated E213–E264 workflows passing
does not validate the new tests.

## Focused validation
```bash
npm install
npx vitest run tests/export-policy.test.js tests/e304-history-alias-boundary.test.js
node --input-type=module --check < agent/export-policy.js
node --input-type=module --check < agent/background-mcp-bridge.js
```
See `.github/workflows/e304-history-alias.yml` for exact-head CI.
The new tests cover three nested alias rejection cases, two positive
metadata/transition controls, a shared MCP snapshot rejection+detachment
control, and local export detachment. The inherited E283 cases are retained.

## Claim boundary
- **SUPPORTED if CI passes:** the tested synthetic nested URL aliases are
  rejected before local export and local MCP sync, and accepted objects
  are detached from subsequent source-object mutations.
- **NOT YET PROVEN:** comprehensive privacy of arbitrary free-text fields
  or unrecognized URL aliases, end-to-end Chrome MV3 service-worker behavior,
  malicious browser extensions, or security against already exported data.
- A generic `url` or `href` under exported evidence is intentionally
  rejected even when it might represent a legitimate link. The safe
  alternative is an explicit schema-validated extension metadata field,
  not weakening the fail-closed boundary.

No live Chrome state, browsing history, user credentials, external endpoints,
deployment, main merge, or private repository visibility was modified.

## Highest-EV next test
Run a disposable real-Chrome MV3 service-worker integration test with
synthetic browsing-history fixtures, suspended/resumed workers and
concurrent local MCP clients. Verify that neither HTTP payloads nor
local exported JSON contain the injected URLs. Do not access actual
user browsing history.
