import assert from 'node:assert';
import test, { describe } from 'node:test';

import { extractReferences } from '../src/extract-references.js';

describe('extractReferences', () => {
    test('returns empty array for empty package', () => {
        assert.deepStrictEqual(extractReferences({}), []);
    });

    test('extracts bin as string', () => {
        const result = extractReferences({ bin: './dist/cli.js' });
        assert.deepStrictEqual(result, ['./dist/cli.js']);
    });

    test('extracts bin as object (includes object itself and its values)', () => {
        const bin = { mylib: './dist/cli.js', other: './dist/other.js' };
        const result = extractReferences({ bin });
        assert.deepStrictEqual(result, [bin, './dist/cli.js', './dist/other.js']);
    });

    test('extracts main', () => {
        const result = extractReferences({ main: './dist/index.js' });
        assert.deepStrictEqual(result, ['./dist/index.js']);
    });

    test('extracts module', () => {
        const result = extractReferences({ module: './dist/index.mjs' });
        assert.deepStrictEqual(result, ['./dist/index.mjs']);
    });

    test('extracts unpkg', () => {
        const result = extractReferences({ unpkg: './dist/index.umd.js' });
        assert.deepStrictEqual(result, ['./dist/index.umd.js']);
    });

    test('extracts umd', () => {
        const result = extractReferences({ umd: './dist/index.umd.js' });
        assert.deepStrictEqual(result, ['./dist/index.umd.js']);
    });

    test('extracts types', () => {
        const result = extractReferences({ types: './dist/index.d.ts' });
        assert.deepStrictEqual(result, ['./dist/index.d.ts']);
    });

    test('extracts typings', () => {
        const result = extractReferences({ typings: './dist/index.d.ts' });
        assert.deepStrictEqual(result, ['./dist/index.d.ts']);
    });

    test('extracts exports 2 levels deep', () => {
        const result = extractReferences({
            exports: {
                '.': {
                    types: './types/index.d.ts',
                    default: './dist/index.js',
                },
                './second': {
                    import: './dist/second.mjs',
                    require: './dist/second.js',
                },
            },
        });
        assert.deepStrictEqual(result, ['./types/index.d.ts', './dist/index.js', './dist/second.mjs', './dist/second.js']);
    });

    test('skips string values at exports level 1 (only descends into objects)', () => {
        const result = extractReferences({
            exports: {
                '.': {
                    types: './types/index.d.ts',
                    default: './prune.js',
                },
                './package.json': './package.json',
            },
        });
        assert.deepStrictEqual(result, ['./types/index.d.ts', './prune.js']);
    });

    test('handles nested conditional exports (3 levels) - only extracts 2 levels deep', () => {
        const result = extractReferences({
            exports: {
                '.': {
                    node: { import: './dist/node.mjs', require: './dist/node.cjs' },
                    default: './dist/index.js',
                },
            },
        });
        // node -> object (not a string, included as-is since it's at level 2)
        // default -> string
        assert.deepStrictEqual(result, [{ import: './dist/node.mjs', require: './dist/node.cjs' }, './dist/index.js']);
    });

    test('flattens array values in exports at level 2', () => {
        const result = extractReferences({
            exports: {
                '.': {
                    types: ['./types/a.d.ts', './types/b.d.ts'],
                    default: './dist/index.js',
                },
            },
        });
        assert.deepStrictEqual(result, ['./types/a.d.ts', './types/b.d.ts', './dist/index.js']);
    });

    test('extracts typesVersions 2 levels deep with array flattening', () => {
        const result = extractReferences({
            typesVersions: {
                '*': {
                    '*': ['types/*'],
                },
            },
        });
        assert.deepStrictEqual(result, ['types/*']);
    });

    test('extracts typesVersions with multiple entries', () => {
        const result = extractReferences({
            typesVersions: {
                '*': {
                    '*': ['types/*'],
                    second: ['types/second/*'],
                },
            },
        });
        assert.deepStrictEqual(result, ['types/*', 'types/second/*']);
    });

    test('extracts directories.bin', () => {
        const result = extractReferences({
            directories: { bin: './bin' },
        });
        assert.deepStrictEqual(result, ['./bin']);
    });

    test('ignores directories without bin', () => {
        const result = extractReferences({
            directories: { lib: './lib' },
        });
        assert.deepStrictEqual(result, []);
    });

    test('handles full package.json with all fields', () => {
        const bin = { mylib: './dist/index.js' };
        const result = extractReferences({
            bin,
            main: './dist/index.js',
            module: './dist/index.mjs',
            types: './dist/index.d.ts',
            exports: {
                '.': { types: './types/index.d.ts', default: './prune.js' },
                './second': { import: './dist/second.mjs', require: './dist/second.js' },
            },
            typesVersions: { '*': { '*': ['types/*'] } },
            directories: { bin: './bin' },
        });
        assert.deepStrictEqual(result, [
            bin,
            './dist/index.js',
            './dist/index.js',
            './dist/index.mjs',
            './dist/index.d.ts',
            './types/index.d.ts',
            './prune.js',
            './dist/second.mjs',
            './dist/second.js',
            'types/*',
            './bin',
        ]);
    });

    test('ignores undefined and null fields', () => {
        const result = extractReferences({
            main: undefined,
            module: null,
            types: './dist/index.d.ts',
        });
        assert.deepStrictEqual(result, ['./dist/index.d.ts']);
    });

    test('ignores exports when not an object', () => {
        const result = extractReferences({ exports: './dist/index.js' });
        assert.deepStrictEqual(result, []);
    });

    test('ignores exports when it is an array', () => {
        const result = extractReferences({ exports: ['./dist/index.js'] });
        assert.deepStrictEqual(result, []);
    });

    test('ignores typesVersions when not an object', () => {
        const result = extractReferences({ typesVersions: 'invalid' });
        assert.deepStrictEqual(result, []);
    });

    test('ignores typesVersions level 1 values that are not objects', () => {
        const result = extractReferences({
            typesVersions: { '*': 'invalid' },
        });
        assert.deepStrictEqual(result, []);
    });

    test('non-string scalar typesVersions level 2 values are included', () => {
        const result = extractReferences({
            typesVersions: { '*': { '*': 42 } },
        });
        assert.deepStrictEqual(result, [42]);
    });

    test('ignores null bin', () => {
        const result = extractReferences({ bin: null });
        assert.deepStrictEqual(result, []);
    });

    test('ignores null directories', () => {
        const result = extractReferences({ directories: null });
        assert.deepStrictEqual(result, []);
    });

    test('ignores null directories.bin', () => {
        const result = extractReferences({ directories: { bin: null } });
        assert.deepStrictEqual(result, []);
    });

    test('fields not related to references are ignored', () => {
        const result = extractReferences({
            name: 'my-package',
            version: '1.0.0',
            description: 'A package',
            scripts: { build: 'tsc' },
            dependencies: { lodash: '^4.0.0' },
            devDependencies: { typescript: '^5.0.0' },
        });
        assert.deepStrictEqual(result, []);
    });

    test('preserves order: bin, bin.*, main, module, unpkg, umd, types, typings, exports, typesVersions, directories.bin', () => {
        const bin = { cmd: './dist/cli.js' };
        const result = extractReferences({
            // intentionally put fields in different order
            typings: './dist/typings.d.ts',
            types: './dist/types.d.ts',
            umd: './dist/umd.js',
            unpkg: './dist/unpkg.js',
            module: './dist/module.mjs',
            main: './dist/main.js',
            bin,
            exports: { '.': { default: './dist/index.js' } },
            typesVersions: { '*': { '*': ['types/*'] } },
            directories: { bin: './bin' },
        });
        assert.deepStrictEqual(result, [
            bin,
            './dist/cli.js',
            './dist/main.js',
            './dist/module.mjs',
            './dist/unpkg.js',
            './dist/umd.js',
            './dist/types.d.ts',
            './dist/typings.d.ts',
            './dist/index.js',
            'types/*',
            './bin',
        ]);
    });
});
