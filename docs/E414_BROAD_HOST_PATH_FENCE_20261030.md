# E414 | Path-masked wildcard host exposure in Xtension

Date: 2026-10-30. **Synthetic software regression; no real browser data.**

## Falsifiable question

Does Xtension consistently recognize a web-scheme wildcard **host** as broad even when a Chrome extension's declared `host_permissions` path is not `/*`?

Chrome/Chromium match-pattern documentation says the path must be present but is **ignored for host permissions** (treated as `/*`), unlike content-script match patterns:

- https://chromium.googlesource.com/chromium/chromium/+/HEAD/chrome/common/extensions/docs/templates/articles/match_patterns.html
- https://chromium.googlesource.com/chromium/src/+/lkgr/extensions/docs/permissions.md

The installed agent's `hostPermissions` field is a declared capability summary, **not** proof of grant, execution, history access or misuse.

## Source-level reproduction

Before E414, `hostPatternMatchesUrl("https://*/private/page", new URL("https://alpha.example/public"))` returned true, but `hasBroadHostAccess({hostPermissions:["https://*/private/page"]})` returned false. The exposure assessment therefore classified a synthetic extension with no sensitive API permissions as **low**, while the same host matcher credited overlap on arbitrary HTTPS domains.

An isolated JavaScript mirror of the exact original and corrected broad-host predicates exercised nine frozen cases. The four noncanonical wildcard-host paths below were false before and true after; five scoped/canonical/unsupported controls retained their original values:

| Synthetic host permission | Before broad? | After broad? |
|---|---:|---:|
| `https://*/foo*` | false | true |
| `http://*/private/page` | false | true |
| `*://*/internal/*` | false | true |
| `https://*/` | false | true |
| `https://*/*` | true | true |
| `https://*.example.org/foo*` | false | false |
| `https://example.org/x/*://*/*` | false | false |
| `https://*foo.org/foo` | false | false |
| `ftp://*/foo*` | false | false |

This is a deterministic counterexample to Xtension's **internal classification consistency**, not a measured Chrome runtime permission grant. The exact repository tests are committed at `tests/e414-broad-host-path-fence.test.js`, covering exposure level, reason, scoped controls, legacy controls and workflow-signal classification.

## Change and scope

`hasBroadHostAccess` now recognizes a complete `http`, `https` or `*` scheme followed by the wildcard host and **any required path**. This leaves the existing HTTP(S)-only workflow URL fence and scoped-domain matching unchanged. It does not execute extension JavaScript, read browsing history, change installed extensions, contact third parties or deploy anything.

**Claim:** Previous broad-host classification for valid noncanonical wildcard-host paths **REJECTED BY SOURCE-LEVEL COUNTEREXAMPLES**. Corrected classification **SUPPORTED BY ISOLATED NINE-CASE PREDICATE MIRROR**. Full repository integration and actual Chrome permission semantics **NOT YET MEASURED** until CI and disposable-browser validation.

## Next decisive gate

Run the committed Vitest suite at this exact head and test a disposable Chrome MV3 profile using only synthetic locally generated history, contrasting manifest-declared host permissions, user-granted origins and observed site-overlap. Keep capability distinct from actual use and never import real browser history.
