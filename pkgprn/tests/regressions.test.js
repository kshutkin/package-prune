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
