import assert from 'node:assert/strict';
import test from 'node:test';

import { packageFixture } from './package-fixture.js';

test('flatten cleanup preserves nonempty sibling directories', async t => {
    const fixture = await packageFixture(
        t,
        { main: './dist/esm/index.js', files: ['dist'] },
        {
            'dist/esm/index.js': 'export {};',
            'dist/assets/theme.css': 'body {}',
        }
    );
    await fixture.run('--flatten=dist/esm');
    assert.equal(await fixture.read('dist/assets/theme.css'), 'body {}');
    assert.equal(await fixture.read('index.js'), 'export {};');
    assert.equal((await fixture.pkg()).main, './index.js');
});

for (const files of [[], ['missing/*.js']]) {
    test(`empty whitelist ${JSON.stringify(files)} preserves npm package contents`, async t => {
        const fixture = await packageFixture(t, { name: 'fixture', version: '1.0.0', files }, { 'private.txt': 'private' });
        const before = await fixture.pack();
        assert.deepEqual(before, ['package.json']);
        await fixture.run();
        assert.deepEqual(await fixture.pack(), before);
        await assert.rejects(fixture.read('private.txt'), { code: 'ENOENT' });
    });
}

test('cleanup preserves main and bin ancestors while removing unlisted siblings', async t => {
    const fixture = await packageFixture(
        t,
        {
            name: 'fixture',
            version: '1.0.0',
            main: './dist/index.js',
            bin: { fixture: './tools/bin/cli.js' },
            files: ['assets'],
        },
        {
            'dist/index.js': 'export {};',
            'dist/private.js': 'private',
            'tools/bin/cli.js': '#!/usr/bin/env node',
            'tools/private.js': 'private',
            'assets/theme.css': 'body {}',
        }
    );
    await fixture.run();
    assert.deepEqual(await fixture.pack(), ['assets/theme.css', 'dist/index.js', 'package.json', 'tools/bin/cli.js']);
    assert.equal(await fixture.read('dist/index.js'), 'export {};');
    assert.equal(await fixture.read('tools/bin/cli.js'), '#!/usr/bin/env node');
    await assert.rejects(fixture.read('dist/private.js'), { code: 'ENOENT' });
    await assert.rejects(fixture.read('tools/private.js'), { code: 'ENOENT' });
});

test('flatten cleanup removes empty descendant directories', async t => {
    const fixture = await packageFixture(
        t,
        { main: './dist/sub/index.js', files: ['dist'] },
        {
            'dist/sub/index.js': 'export {};',
            'dist/sub/deep/extra.js': 'export {};',
        }
    );
    await fixture.run('--flatten=dist/sub');
    assert.equal(await fixture.read('deep/extra.js'), 'export {};');
    await assert.rejects(fixture.read('dist/sub/index.js'), { code: 'ENOENT' });
    const { readdir } = await import('node:fs/promises');
    assert.ok(!(await readdir(fixture.cwd)).includes('dist'));
});

test('content transformations exclude dependencies at every depth', async t => {
    const preserved = '// dependency comment\nmodule.exports = 42;\n';
    const fixture = await packageFixture(
        t,
        {},
        {
            'node_modules/dep/index.js': preserved,
            'node_modules/dep/index.js.map': '{}',
            'packages/demo/node_modules/dep/index.js': preserved,
            'packages/demo/node_modules/dep/index.js.map': '{}',
            '.git/fixture.js': preserved,
            '.git/fixture.js.map': '{}',
            '.hidden/local.js': '// local comment\nconst local = 1;\n',
            '.hidden/local.js.map': '{}',
        }
    );
    await fixture.run('--strip-comments', '--remove-sourcemaps');
    for (const dir of ['node_modules/dep', 'packages/demo/node_modules/dep', '.git']) {
        const file = dir === '.git' ? 'fixture.js' : 'index.js';
        assert.equal(await fixture.read(`${dir}/${file}`), preserved);
        assert.equal(await fixture.read(`${dir}/${file}.map`), '{}');
    }
    assert.equal(await fixture.read('.hidden/local.js'), 'const local = 1;\n');
    await assert.rejects(fixture.read('.hidden/local.js.map'), { code: 'ENOENT' });
});

test('explicit flatten rewrites only references inside the selected directory', async t => {
    const fixture = await packageFixture(
        t,
        {
            main: './dist/index.js',
            exports: { '.': './dist/index.js', './other': './mydist/other.js', './nested': './other/dist/index.js' },
        },
        {
            'dist/index.js': 'export {};',
            'mydist/other.js': 'export const other = 1;',
            'other/dist/index.js': 'export const nested = 1;',
        }
    );
    await fixture.run('--flatten=./dist');
    assert.deepEqual((await fixture.pkg()).exports, {
        '.': './index.js',
        './other': './mydist/other.js',
        './nested': './other/dist/index.js',
    });
    assert.equal(await fixture.read('mydist/other.js'), 'export const other = 1;');
    assert.equal(await fixture.read('other/dist/index.js'), 'export const nested = 1;');
});

for (const cleanup of [true, false]) {
    test(`negated files patterns preserve npm contents with cleanup=${cleanup}`, async t => {
        const fixture = await packageFixture(
            t,
            {
                name: 'fixture',
                version: '1.0.0',
                files: ['dist', '!dist/private.js', '!dist/private', '!dist/**/secret.*'],
            },
            {
                'dist/index.js': 'export {};',
                'dist/private.js': 'private',
                'dist/private/data.txt': 'private',
                'dist/nested/secret.txt': 'private',
                'dist/nested/public.txt': 'public',
                'dist/.hidden/data.txt': 'hidden',
                'dist/.hidden-file': 'hidden',
            }
        );
        const before = await fixture.pack();
        assert.ok(before.includes('dist/.hidden/data.txt'));
        assert.ok(!before.includes('dist/private.js'));
        await fixture.run(...(cleanup ? [] : ['--no-cleanup-files']));
        assert.deepEqual(await fixture.pack(), before);
        if (cleanup) await assert.rejects(fixture.read('dist/private.js'), { code: 'ENOENT' });
    });
}

test('files optimization handles gaps between directory depths', async t => {
    const fixture = await packageFixture(
        t,
        { name: 'fixture', version: '1.0.0', files: ['a/b/c/index.js'] },
        {
            'a/b/c/index.js': 'export {};',
            'a/b/c/private.js': 'private',
        }
    );
    const before = await fixture.pack();
    await fixture.run('--no-cleanup-files');
    assert.deepEqual(await fixture.pack(), before);
    assert.equal(await fixture.read('a/b/c/private.js'), 'private');
});

test('automatic flatten uses the static prefix of wildcard exports', async t => {
    const fixture = await packageFixture(
        t,
        { exports: { './*': './dist/*/index.js' }, files: ['dist'] },
        {
            'dist/feature/index.js': 'export {};',
            'dist/.hidden/index.js': 'export {};',
        }
    );
    await fixture.run('--flatten');
    assert.deepEqual((await fixture.pkg()).exports, { './*': './*/index.js' });
    assert.equal(await fixture.read('feature/index.js'), 'export {};');
    assert.equal(await fixture.read('.hidden/index.js'), 'export {};');
});

test('automatic flatten rebases sourcemap sources outside the moved directory', async t => {
    const fixture = await packageFixture(
        t,
        { main: './dist/index.js', files: ['dist', 'src'] },
        {
            'dist/index.js': 'export {};',
            'src/index.js': 'export {};',
            'dist/index.js.map': JSON.stringify({ version: 3, sourceRoot: '../', sources: ['src/index.js'], names: [], mappings: 'AAAA' }),
        }
    );
    await fixture.run('--flatten');
    const map = JSON.parse(await fixture.read('index.js.map'));
    assert.deepEqual(map.sources, ['src/index.js']);
    assert.equal(map.sourceRoot, undefined);
    assert.equal(await fixture.read(map.sources[0]), 'export {};');
});

test('sourcemap removal deletes orphan maps without requiring source files', async t => {
    const fixture = await packageFixture(t, {}, { 'dist/index.js.map': '{}', 'dist/types.d.ts.map': '{}' });
    await fixture.run('--remove-sourcemaps');
    await assert.rejects(fixture.read('dist/index.js.map'), { code: 'ENOENT' });
    await assert.rejects(fixture.read('dist/types.d.ts.map'), { code: 'ENOENT' });
});

test('map removal strips CSS and JavaScript directives while preserving literal text', async t => {
    const css = 'body::before { content: "/*# sourceMappingURL=literal */"; }';
    const js = 'const text = "//# sourceMappingURL=literal";';
    const fixture = await packageFixture(
        t,
        {},
        {
            'theme.css': `${css}\n/*# sourceMappingURL=theme.css.map */`,
            'theme.css.map': '{}',
            'index.js': `${js}\n//@ sourceMappingURL=./index.js.map`,
            'index.js.map': '{}',
            'inline.css': 'body{}/*# sourceMappingURL=inline.css.map */',
            'inline.css.map': '{}',
        }
    );
    await fixture.run('--remove-sourcemaps');
    assert.equal(await fixture.read('theme.css'), css);
    assert.equal(await fixture.read('index.js'), js);
    assert.equal(await fixture.read('inline.css'), 'body{}');
    await assert.rejects(fixture.read('theme.css.map'), { code: 'ENOENT' });
});

test('comment stripping preserves mapping directives unless map removal is requested', async t => {
    const source = '// ordinary comment\nconst x = 1;\n//# sourceMappingURL=index.js.map\n';
    const map = JSON.stringify({ version: 3, sources: [], names: [], mappings: '' });
    const fixture = await packageFixture(t, {}, { 'index.js': source, 'index.js.map': map });
    await fixture.run('--strip-comments');
    assert.equal(await fixture.read('index.js'), 'const x = 1;\n//# sourceMappingURL=index.js.map\n');
    assert.equal(await fixture.read('index.js.map'), map);
    await fixture.run('--strip-comments', '--remove-sourcemaps');
    assert.equal(await fixture.read('index.js'), 'const x = 1;\n');
    await assert.rejects(fixture.read('index.js.map'), { code: 'ENOENT' });
});
