# pkgprn

## 0.10.0

### Minor Changes

- 05c81f5: Preserve side-effect declarations when flattening packages by rewriting scoped `sideEffects` paths and glob patterns. Keep global patterns and boolean declarations unchanged, and retain coverage for both moved and unmoved files during partial flattening so consumer bundlers do not discard required registration code or styles.

### Patch Changes

- 1536775: Escape literal publish paths after glob expansion and flattening even when no ignore files are present, preserving filenames containing glob characters or leading exclamation marks with cleanup disabled.
- 899b748: Recognize the `style` entry point during automatic flatten detection and rewrite it when CSS files move, including packages with no JavaScript entry point.
- f316755: Preserve commands declared through `directories.bin` during publish selection and cleanup, while respecting explicit `bin` entries and excluding hidden files and symlinks.
- 60decd1: Keep package metadata targeted by package references or export patterns when removing unused export-map stubs after flattening.
- aff57f0: Preserve command names, filename extensions, and nested executable paths when flattening a `directories.bin` directory. Keep explicit `bin` mappings instead of replacing them, and reuse the same safe executable discovery as publish selection.
- be742f1: Preserve JavaScript token boundaries and significant line breaks when removing sourcemap directives. Keep surrounding CSS selector whitespace intact so removing directives does not change runtime behavior or selector meaning.
- 7102001: Preserve regular expressions following labeled and switch-case blocks during comment stripping by distinguishing statement colons from object properties and conditional expressions.
- 8e210a9: Rebase sources in published sourcemaps that remain outside flattened directories when their source files move. Preserve unrelated maps unchanged and keep declaration-map position adjustments working when flattening and stripping comments together.
- 1595629: Respect the publish whitelist when flattening with cleanup disabled, even without ignore files. Excluded files remain in their original locations and are not added to the published package.
- e1f21e6: Consume Unicode escapes as part of identifier tokens so comment stripping preserves division, regular expressions, and labels after identifiers containing braced code point escapes.

## 0.9.0

### Minor Changes

- 568eeb0: Support package-local `.npmignore` files and `.gitignore` fallback with npm-compatible root and nested precedence, negations, and publish whitelist overrides. Resolve publish selection before cleanup and flattening so excluded files cannot leak through expanded globs or relocated ignore files. With cleanup disabled, preserve excluded files and leave them out of content transformations and flattening.
- 4589d89: Update runtime dependencies and build tools to their latest releases. Align the supported Node.js versions with `ignore-walk@9`: Node.js 22.22.2+, 24.15.0+, or 26+ on the respective supported major lines.

## 0.8.4

### Patch Changes

- ab02668: Discover browser entry points during automatic flattening and rewrite local browser replacement keys and values, preserving dependency aliases and false targets.
- 57b161d: Honor the documented `--strip-comments all` alias for default comment types, preserving license and annotation comments unless explicitly requested.
- 15ad8b5: Honor the documented `--flatten auto` alias for automatic directory detection.
- 2e107f8: Reject symlink sourcemaps before flattening moves files, preventing rebasing from modifying external symlink targets.
- 89346a7: Adjust `.d.mts.map` and `.d.cts.map` source positions and embedded contents when their referenced JavaScript files have comments stripped.
- 7397a54: Remove source mapping directives from JavaScript, TypeScript, declarations, and CSS independently of map filenames, including inline maps and custom relative URLs.
- 9a2a71b: Restrict flatten stub cleanup to package-local export subpaths, preserving directories named after root conditions or array indices.
- 8d13f4d: Skip nonexistent parent directories when optimizing publish whitelists, allowing optional output paths without failing pruning.

## 0.8.3

### Patch Changes

- 3efbb1f: Expand brace patterns in publish whitelists before cleanup so matching files are preserved.
- 01ba468: Keep explicitly included files, their required parent directories, and publish whitelist overrides during junk cleanup, while retaining default exclusions for unlisted artifacts.
- 0d31f0a: Preserve README, LICENSE, and LICENCE files with multiple dot suffixes during cleanup and whitelist optimization.
- 81d74d2: Preserve Unicode line separators and escaped CRLF continuations inside quoted JavaScript strings when stripping comments.
- 120723d: Preserve explicit `./` publish whitelists and their root ignore overrides instead of deleting package contents during cleanup.
- 3d154c5: Recognize all JavaScript Unicode whitespace consistently at token boundaries and exclude it from identifier characters.
- 7fde7a1: Distinguish expression bodies and object literals from statement blocks when scanning division and subsequent regex literals.
- 4de6d2c: Preserve regex literals after do and line-terminated jump statements, and distinguish for-of separators from ordinary of identifiers.

## 0.8.2

### Patch Changes

- 0eb3b4e: Preserve regex literals around Unicode line separators, NBSP, and BOM by classifying scanner whitespace consistently.

## 0.8.1

### Patch Changes

- ddbe1d9: Fix automatic flattening for string exports, including CSS and JavaScript subpaths. Extract references from root exports, nested conditions, and fallback arrays as well.
- eb45f0c: Remove completely empty directory subtrees after flattening while preserving any subtree containing files.
- ccc69ab: Keep cleanup and content transformations from following symlink targets, and reject flattening directories outside the package.
- ec47817: Recognize regex literals following control-statement conditions without confusing ordinary function calls followed by division.
- 342eabf: Preserve division following object expressions and keyword-named properties when detecting subsequent regex literals with the custom comment scanner.
- 4c2036b: Match npm whitelist exclusions against hidden paths using minimatch with dotfile matching enabled. Keep Node glob for filesystem pattern expansion and exclusions where its semantics apply.
- ad4c2a9: Keep dependency and Git directories untouched at every depth when stripping comments or removing sourcemaps, while still processing authored hidden directories.
- 0226cdc: Discover and rewrite package-local private import targets when flattening, preserving external package and built-in targets.
- 1220985: Clean up files even when the publish whitelist is empty or its globs match nothing, preventing unintended files from being published.
- 0169c38: Rewrite package references only when they lie inside a flattened directory, preserving unrelated paths containing the same directory name.
- 658abdb: Resolve publish whitelist patterns in order with npm-compatible hidden-file and extglob matching, allowing later entries to re-include excluded files.
- 1f73d59: Reject overlapping flatten roots, file/directory destination collisions, and symlink destination ancestors before moving files.
- 3d1b999: Preserve token separators and line terminators when stripping comments, avoiding merged identifiers/operators and changes to automatic semicolon insertion.
- 3908d82: Preserve empty optimized file whitelists when cleanup is disabled so previously excluded files cannot enter the package.
- 77ff563: Preserve parent directories of always-included main and bin files during whitelist cleanup.
- a22cdfe: Preserve whitespace in strings and raw template literals during comment cleanup, including nested templates.
- 19bf203: Preserve source mapping directives during comment stripping unless sourcemap removal is explicitly requested.
- d423d9b: Preserve sibling publish whitelist entries during partial flattening and handle flattened sibling directories sharing an empty parent.
- bd49518: Preserve nonempty sibling directories when cleaning up flattened source directories.
- 72d0e05: Rebase sourcemap source paths during automatic flattening as well as explicit flattening, keeping references to sources outside moved directories valid.
- 5b27132: End line comments and hashbangs at every JavaScript line terminator, preserving code after CR, U+2028, and U+2029.
- fce9347: Remap declaration-map original columns as well as lines after comment stripping, keeping embedded source contents synchronized with the transformed files.
- c116a80: Track exact source edits during comment stripping and remap JavaScript sourcemap generated lines and columns, dropping mappings inside removed comments.
- f2ef664: Remove CSS block and JavaScript line source mapping directives when deleting sourcemaps, preserving similar text inside strings.
- 4b85ed6: Remove orphan sourcemaps without failing when their corresponding source files are absent.
- cacd11b: Resolve sourcemap sources as nullable URLs, preserving remote schemes and URL source roots while rebasing encoded local file paths.
- e3ab1f5: Resolve negated publish whitelist entries with Node glob exclusions, preserving included hidden files and applying exclusions during cleanup and files optimization.
- 55fc2a2: Retain explicitly whitelisted main files beginning with ./ during optimization because npm does not implicitly include those paths.
- 3a197a5: Avoid crashes when optimizing file whitelists with gaps between directory depths.
- f9de3e8: Recognize regex literals at the start of template expressions so comment stripping preserves their contents.
- be3e979: Validate comment stripping options before changing package metadata or performing filesystem cleanup and flattening.
- 3840bb7: Detect the static directory prefix of wildcard export targets during automatic flattening.

## 0.8.0

### Minor Changes

- d9cb6cd: huge refactoring

## 0.7.0

### Minor Changes

- f749679: change cleye to @niceties/node-parseargs-plus
- 4b07769: added annotation comments support

## 0.6.0

### Minor Changes

- f4710cd: support glob in files

## 0.5.5

### Patch Changes

- a26d84d: fixed cleanup / flatten order

## 0.5.4

### Patch Changes

- 6653f6d: fix remove sourcemaps and flatten

## 0.5.3

### Patch Changes

- f5971f0: fix error in isDirectory handling

## 0.5.2

### Patch Changes

- 215c359: strip comments

## 0.5.1

### Patch Changes

- b5cbf91: flatten src as well

## 0.5.0

### Minor Changes

- ab78cc1: replace jsonata with custom code

## 0.4.1

### Patch Changes

- f33df2b: fix bug in isSubDirectory

## 0.4.0

### Minor Changes

- 5d0639d: option to remove comments

## 0.3.1

### Patch Changes

- abe26ed: pretty print adjusted sourcemap

## 0.3.0

### Minor Changes

- 5274341: Adjust sourcemap `sources` paths when flattening explicit directories. Moved `.map` files now have their `sources` entries rewritten so they resolve to the correct original files. Handles cross-directory references (e.g. a `.d.ts.map` in `types/` pointing at files in `dist/`) and incorporates `sourceRoot` into individual source paths.

## 0.2.3

### Patch Changes

- f0fb6e3: added keywords

## 0.2.2

### Patch Changes

- 31d718e: actually publish types

## 0.2.1

### Patch Changes

- 5182c31: added types

## 0.2.0

### Minor Changes

- c234bfb: improved cleanup
- 1ad1966: support multiple paths for flatten

### Patch Changes

- 34d968a: better walkDir

## 0.1.0

### Minor Changes

- 7ba2122: initial release
