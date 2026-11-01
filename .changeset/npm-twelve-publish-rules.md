---
"pkgprn": minor
"pkgprn-internal": minor
---

Support npm 12 publish-selection rules alongside npm 11. Detect the active npm version, with a `--npm-version=11|12` CLI override and optional `npmVersion` API setting. Resolve npm 12 selection before cleanup and flattening, and remove redundant `files` fields only when the selected npm rules preserve the publish selection.

Honor npm 12 global ignore configuration during selection and whitelist comparison, preserve authored directory patterns for unwritten manifests, and retain protected descendants such as nested `node_modules` and `.git` during cleanup.
