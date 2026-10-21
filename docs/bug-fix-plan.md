# Package correctness fixes

Each numbered item gets a regression, verification, a patch changeset for both packages, and its own commit.

1. [x] Preserve nonempty sibling directories during flatten cleanup.
2. [x] Honor empty and unmatched `files` whitelists.
3. [x] Preserve ancestors of always-included main/bin entries.
4. [x] Preserve token boundaries and automatic semicolon insertion when stripping comments.
5. [x] Preserve whitespace inside literals when stripping comments.
6. [x] Recognize regex literals after control-statement conditions.
7. [x] Exclude nested dependency directories from content transformations.
8. [x] Rewrite only actual flattened path prefixes.
9. [x] Resolve negated `files` patterns through glob exclusions.
10. [x] Handle missing depth buckets during files optimization.
11. [x] Detect the static directory prefix of wildcard exports.
12. [x] Adjust sourcemap paths during automatic flattening.
13. [x] Remove orphan sourcemaps without requiring a source file.
14. [x] Remove CSS sourcemap directives when deleting maps.
15. [x] Preserve source mapping directives during comment stripping.

Use Node glob for pattern selection where it preserves the required inventory. Keep complete traversal for flattening, including hidden entries and symlinks. Run the full suite and both builds after the final fix.

## Follow-up coverage

Completed fixes also cover empty directory subtrees, partial flattening with cleanup disabled, selected sibling directories sharing a parent, explicitly whitelisted `./`-prefixed main files, hidden-path exclusions, and regex literals inside template expressions.

Node glob handles filesystem pattern expansion and its `exclude` parameter. Complete inventories retain the small directory walker. Exclusion matching uses minimatch with `dot: true` to preserve npm behavior for hidden paths.

## Final validation

- 311 tests passed, including runtime comment-semantics checks and npm package-content comparisons.
- Repository lint and diff whitespace checks passed.
- Both package builds passed.
- Both packages packed successfully in disposable copies with their real prepack scripts.
- Packed JavaScript syntax, the public API import, and both consumer CLIs passed.
- 20 focused fix commits, each including a patch changeset for both packages.
