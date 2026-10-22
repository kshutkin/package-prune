---
"pkgprn": minor
"pkgprn-internal": minor
---

Support package-local `.npmignore` files and `.gitignore` fallback with npm-compatible root and nested precedence, negations, and publish whitelist overrides. Resolve publish selection before cleanup and flattening so excluded files cannot leak through expanded globs or relocated ignore files. With cleanup disabled, preserve excluded files and leave them out of content transformations and flattening.
