# pkgprn

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
