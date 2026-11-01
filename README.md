[![.github/workflows/main.yml](https://github.com/kshutkin/package-prune/actions/workflows/main.yml/badge.svg)](https://github.com/kshutkin/package-prune/actions/workflows/main.yml)

# package-prune

Prune package.json before publishing to npm

## Packages

- [pkgprn](./pkgprn/README.md) - prune package.json before publish
- [pkgprn-internal](./pkgprn-internal/README.md) - special version of pkgprn for workspace-enabled repositories

## Testing

Run `pnpm test` after installing dependencies with `pnpm install`.

Tests run the package fixtures against pinned npm 11 and npm 12 CLIs using the current Node executable. CI repeats this compatibility matrix on LTS and latest Node. Golden filesystem snapshots cover the npm 11 contract; npm 12 is checked against its actual publish selection.

Invocation tests also use pinned pnpm 11 and 12 releases. They cover `pnpm exec`, `pnpm run prepack`, npm detection from PATH, explicit overrides, and before/after `pnpm pack` selections with a prepack hook targeting npm 11 rules.

# License

[MIT](./LICENSE)
