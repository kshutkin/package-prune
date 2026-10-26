---
"pkgprn": patch
"pkgprn-internal": patch
---

Track complete numeric literals in the comment scanner so division after a trailing decimal point does not corrupt subsequent regular expressions or hide sourcemap directives. Ports the scanner fix from rollup-extras.
