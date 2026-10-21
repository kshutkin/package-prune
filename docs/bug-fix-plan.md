# Package correctness fixes

Each numbered item gets a regression, verification, a patch changeset for both packages, and its own commit.

1. Preserve nonempty sibling directories during flatten cleanup.
2. Honor empty and unmatched `files` whitelists.
3. Preserve ancestors of always-included main/bin entries.
4. Preserve token boundaries and automatic semicolon insertion when stripping comments.
5. Preserve whitespace inside literals when stripping comments.
6. Recognize regex literals after control-statement conditions.
7. Exclude nested dependency directories from content transformations.
8. Rewrite only actual flattened path prefixes.
9. Resolve negated `files` patterns through glob exclusions.
10. Handle missing depth buckets during files optimization.
11. Detect the static directory prefix of wildcard exports.
12. Adjust sourcemap paths during automatic flattening.
13. Remove orphan sourcemaps without requiring a source file.
14. Remove CSS sourcemap directives when deleting maps.
15. Preserve source mapping directives during comment stripping.

Use Node glob for pattern selection where it preserves the required inventory. Keep complete traversal for flattening, including hidden entries and symlinks. Run the full suite and both builds after the final fix.
