[![.github/workflows/main.yml](https://github.com/kshutkin/package-prune/actions/workflows/main.yml/badge.svg)](https://github.com/kshutkin/package-prune/actions/workflows/main.yml)

# package-prune

Prune package.json before publishing to npm

## Packages

- [pkgprn](./pkgprn/README.md) - prune package.json before publish
- [pkgprn-internal](./pkgprn-internal/README.md) - special version of pkgprn for workspace-enabled repositories

## Testing

Run `pnpm test` after installing dependencies with `pnpm install`.

Package fixtures invoke the pinned npm 11 CLI with the current Node executable. This keeps publish-selection expectations aligned with `npm-packlist` 10 while CI tests both LTS and latest Node. npm 12 changes the packing rules and needs separate compatibility work.

# License

[MIT](./LICENSE)
