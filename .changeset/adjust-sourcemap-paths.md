---
"pkgprn": minor
---

Adjust sourcemap `sources` paths when flattening explicit directories. Moved `.map` files now have their `sources` entries rewritten so they resolve to the correct original files. Handles cross-directory references (e.g. a `.d.ts.map` in `types/` pointing at files in `dist/`) and incorporates `sourceRoot` into individual source paths.
