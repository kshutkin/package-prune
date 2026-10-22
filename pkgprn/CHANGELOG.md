# pkgprn

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
