---
"pkgprn": minor
"pkgprn-internal": minor
---

Preserve side-effect declarations when flattening packages by rewriting scoped `sideEffects` paths and glob patterns. Keep global patterns and boolean declarations unchanged, and retain coverage for both moved and unmoved files during partial flattening so consumer bundlers do not discard required registration code or styles.
