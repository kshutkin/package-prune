---
"pkgprn": patch
"pkgprn-internal": patch
---

Preserve command names, filename extensions, and nested executable paths when flattening a `directories.bin` directory. Keep explicit `bin` mappings instead of replacing them, and reuse the same safe executable discovery as publish selection.
