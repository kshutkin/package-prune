# package-prune

Prune `package.json` before publishing to npm. Removes `devDependencies`, strips unnecessary scripts, cleans up junk files, optimizes the `files` array, and optionally flattens dist directories - so your published package is lean and clean.

## Installation

```sh
npm install -D pkgprn
```

Or with other package managers:

```sh
pnpm add -D pkgprn
yarn add -D pkgprn
```

You can also run it directly with `npx`:

```sh
npx pkgprn
```

## Usage

The recommended way to use `pkgprn` is as a `prepack` script in your `package.json`:

```json
{
    "scripts": {
        "prepack": "pkgprn"
    }
}
```

This ensures your `package.json` is pruned automatically every time you run `npm pack` or `npm publish`.

You can also run it manually:

```sh
npx pkgprn [options]
```

The tool reads the `package.json` in the current working directory, applies all transformations in place, and writes the result back.

## What It Does

By default, `pkgprn` performs the following steps:

1. **Removes `devDependencies`** - Strips the entire `devDependencies` field from `package.json`.
2. **Removes `packageManager`** - Strips the `packageManager` field.
3. **Prunes scripts** - Removes scripts that are not relevant to package consumers (based on the selected [profile](#profiles)).
4. **Removes junk files** - Deletes OS and editor artifacts (`.DS_Store`, `*.orig`, `.*.swp`, `._*`, etc.) from the package directory.
5. **Optimizes the `files` array** - Collapses individual file entries into their parent directory when all files in that directory are already listed, and removes entries that npm always includes automatically (`package.json`, `README`, `LICENSE`).
6. **Cleans up unlisted files** - Removes files and directories not covered by the `files` array, then drops the `files` field itself (since only the included files remain on disk).

Additional optional features can be enabled via flags:

- **Flatten** dist directories into the package root.
- **Remove sourcemaps** and their `//# sourceMappingURL=` references.
- **Strip comments** from JavaScript files, with automatic sourcemap line-mapping adjustment.

## Options

| Flag                  | Type                | Default   | Description                                                                                                                       |
| --------------------- | ------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--profile`           | `string`            | `library` | Script-retention profile (`library` or `app`).                                                                                    |
| `--flatten`           | `string \| boolean` | `false`   | Flatten dist directories to the package root. Pass without a value to auto-detect, or provide comma-separated directory names.    |
| `--remove-sourcemaps` | `boolean`           | `false`   | Delete `.map` files and strip `sourceMappingURL` comments from source files.                                                      |
| `--strip-comments`    | `string \| boolean` | `false`   | Strip comments from JS files. Pass without a value to strip all, or provide comma-separated types: `jsdoc`, `license`, `regular`. |
| `--optimize-files`    | `boolean`           | `true`    | Optimize the `files` array by collapsing entries.                                                                                 |
| `--cleanup-files`     | `boolean`           | `true`    | Remove files not listed in the `files` array.                                                                                     |
| `--version`           |                     |           | Show version number.                                                                                                              |
| `--help`              |                     |           | Show help message.                                                                                                                |

## Profiles

Profiles control which npm lifecycle scripts are kept in the published `package.json`. All other scripts are removed.

### `library` (default)

Keeps only the scripts that npm runs during package installation:

- `preinstall`, `install`, `postinstall`
- `prepublish`
- `preprepare`, `prepare`, `postprepare`

### `app`

Keeps everything from the `library` profile, plus runtime and test lifecycle scripts:

- `prestart`, `start`, `poststart`
- `prerestart`, `restart`, `postrestart`
- `prestop`, `stop`, `poststop`
- `pretest`, `test`, `posttest`

## Flattening

Flattening moves files from a dist directory (e.g. `dist/`) into the package root and updates all references in `package.json` (`main`, `module`, `exports`, `bin`, `types`, `typesVersions`, etc.) accordingly.

### Auto-detect

When `--flatten` is passed without a value, `pkgprn` inspects `main`, `bin`, `module`, `exports`, `types`, and other entry-point fields to find the longest common directory prefix, and flattens that:

```sh
pkgprn --flatten
```

### Explicit directories

You can specify one or more directories to flatten (comma-separated):

```sh
pkgprn --flatten dist
pkgprn --flatten dist,lib
```

### What flattening does

1. Identifies all files in the target directory/directories.
2. Checks for naming conflicts with existing root-level files.
3. Moves all files to the root (preserving subdirectory structure relative to the dist directory).
4. Removes the now-empty dist directory.
5. Rewrites all path references in `package.json` to point to the new locations.
6. **Adjusts sourcemap `sources` paths** (explicit directories only) - when `.map` files are moved, their `sources` entries are rewritten so they still resolve to the correct original files. This also handles cross-directory references (e.g. a `.d.ts.map` in `types/` pointing at files in `dist/`) and incorporates any `sourceRoot` into the individual source paths.
7. Updates the `files` array.
8. Cleans up any leftover export-map stub directories that only contain a `package.json`.

## Comment Stripping

The `--strip-comments` flag removes comments from `.js`, `.mjs`, and `.cjs` files. You can target specific comment types or strip them all at once.

### Usage

```sh
pkgprn --strip-comments            # strip all comments
pkgprn --strip-comments jsdoc      # strip only JSDoc comments
pkgprn --strip-comments license,regular  # strip license and regular comments
```

### Comment types

| Type      | Description                                        |
| --------- | -------------------------------------------------- |
| `jsdoc`   | `/** … */` documentation comments                  |
| `license` | Comments containing "license", "copyright", or "©" |
| `regular` | All other `//` and `/* … */` comments              |

Passing `--strip-comments` without a value (or with `all`) strips every type.

### Sourcemap adjustment

When comments are stripped, line numbers in the affected files change. If any `.d.ts.map` files reference a stripped JS file in their `sources`, `pkgprn` automatically rewrites the sourcemap `mappings` so that line numbers stay correct. This ensures that declaration-map "Go to Definition" navigation continues to point to the right lines after comment removal.

## Examples

### Basic library

```json
{
    "scripts": {
        "build": "tsc",
        "test": "vitest",
        "prepack": "pkgprn"
    }
}
```

After packing, `build` and `test` are removed; `devDependencies` and `packageManager` are gone.

### Library with flattened dist

```json
{
    "scripts": {
        "build": "rollup -c",
        "prepack": "pkgprn --flatten dist"
    },
    "main": "dist/index.js",
    "types": "dist/index.d.ts",
    "files": ["dist"]
}
```

After packing, `dist/index.js` becomes `index.js`, `main` points to `index.js`, and the `dist` directory is gone.

### Library with comment stripping

```json
{
    "scripts": {
        "build": "tsc",
        "prepack": "pkgprn --strip-comments jsdoc"
    }
}
```

After packing, all JSDoc comments are removed from JS files and any `.d.ts.map` sourcemaps are adjusted to reflect the new line numbers.

### Application with sourcemap removal

```sh
pkgprn --profile app --remove-sourcemaps
```

### Disable file cleanup

If you only want script and dependency pruning without touching files on disk:

```sh
pkgprn --no-cleanup-files --no-optimize-files
```

## Programmatic API

The core pruning logic is also available as a function:

```js
import { prunePkg } from "pkgprn";

const pkg = JSON.parse(await readFile("package.json", "utf8"));

await prunePkg(
    pkg,
    {
        profile: "library",
        flatten: false,
        removeSourcemaps: false,
        stripComments: false, // or "all", "jsdoc", "license,regular", etc.
        optimizeFiles: true,
        cleanupFiles: true,
    },
    logger,
);
```

### `prunePkg(pkg, options, logger)`

- **`pkg`** - A mutable `package.json` object. Modified in place.
- **`options`** - An options object matching the CLI flags.
- **`logger`** - A logger instance (from [`@niceties/logger`](https://www.npmjs.com/package/@niceties/logger)).

## Ignored Files

`pkgprn` automatically removes files that npm itself always ignores:

- `.DS_Store`, `.git`, `.hg`, `.svn`, `CVS`
- `.lock-wscript`, `config.gypi`, `npm-debug.log`
- `*.orig`, `.*.swp`, `._*`, `.wafpickle-N`
- `node_modules`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, `.npmrc`

Files that npm always includes are preserved regardless of the `files` array:

- `package.json`
- `README` (any extension, case-insensitive)
- `LICENSE` / `LICENCE` (any extension, case-insensitive)
- The file referenced by `main`
- Files referenced by `bin`

## License

[MIT](https://github.com/kshutkin/package-prune/blob/main/LICENSE)
