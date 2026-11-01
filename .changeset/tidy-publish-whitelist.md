---
"pkgprn": minor
"pkgprn-internal": minor
---

Remove the `package.json` `files` field whenever npm would publish the same files without it. Compare npm's publish selections after all transformations, including when cleanup or entry optimization is disabled, while retaining whitelists that affect ignored files or explicit inclusions.
