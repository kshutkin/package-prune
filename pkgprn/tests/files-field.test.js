import assert from 'node:assert/strict';
import test from 'node:test';

import { packageFixture } from './package-fixture.js';

const scenarios = [
    { name: 'all remaining files are allowed', files: ['index.js'], disk: { 'index.js': 'export {};' }, redundant: true },
    { name: 'root whitelist is redundant', files: ['./'], disk: { 'index.js': 'export {};' }, redundant: true },
    { name: 'empty whitelist only contains required metadata', files: [], disk: { 'README.md': 'read me' }, redundant: true },
    {
        name: 'unpublished files remain on disk',
        files: ['index.js'],
        disk: { 'index.js': 'export {};', 'private.txt': 'private' },
        redundant: 'cleanup',
    },
    {
        name: 'root ignore rules already exclude unpublished files',
        files: ['index.js'],
        disk: { 'index.js': 'export {};', 'private.txt': 'private', '.npmignore': 'private.txt\n' },
        redundant: true,
    },
    {
        name: 'root ignore rules would exclude a published file',
        files: ['index.js'],
        disk: { 'index.js': 'export {};', '.npmignore': 'index.js\n' },
        redundant: 'cleanup',
    },
    {
        name: 'nested ignore rules already exclude unpublished files',
        files: ['dist'],
        disk: { 'dist/index.js': 'export {};', 'dist/private.txt': 'private', 'dist/.npmignore': 'private.txt\n' },
        redundant: true,
    },
    {
        name: 'explicit file overrides npm default exclusions',
        files: ['keep.orig'],
        disk: { 'keep.orig': 'keep' },
        redundant: false,
    },
    {
        name: 'explicit nested file overrides npm default exclusions',
        files: ['build/config.gypi'],
        disk: { 'build/config.gypi': 'keep' },
        redundant: false,
    },
    {
        name: 'literal glob characters survive comparison',
        files: ['dist'],
        disk: { 'dist/[name].js': 'export {};', 'dist/!keep.js': 'export {};' },
        redundant: true,
    },
];

for (const cleanup of [true, false]) {
    for (const scenario of scenarios) {
        test(`files field: ${scenario.name}, cleanup=${cleanup}`, async t => {
            const fixture = await packageFixture(t, { name: 'fixture', version: '1.0.0', files: scenario.files }, scenario.disk);
            const before = await fixture.pack();
            const args = cleanup ? [] : ['--no-cleanup-files'];
            await fixture.run(...args);
            assert.deepEqual(await fixture.pack(), before);
            const redundant = scenario.redundant === 'cleanup' ? cleanup : scenario.redundant;
            assert.equal((await fixture.pkg()).files === undefined, redundant);
            await fixture.run(...args);
            assert.deepEqual(await fixture.pack(), before);
            assert.equal((await fixture.pkg()).files === undefined, redundant);
        });
    }
}

test('redundant files field is removed with both cleanup and entry collapsing disabled', async t => {
    const fixture = await packageFixture(t, { name: 'fixture', version: '1.0.0', files: ['index.js'] }, { 'index.js': 'export {};' });
    const before = await fixture.pack();
    await fixture.run('--no-cleanup-files', '--no-optimize-files');
    assert.equal((await fixture.pkg()).files, undefined);
    assert.deepEqual(await fixture.pack(), before);
});

test('files comparison uses the final flattened paths after sourcemap removal', async t => {
    const fixture = await packageFixture(
        t,
        { name: 'fixture', version: '1.0.0', files: ['dist'] },
        { 'dist/index.js': 'export {};', 'dist/index.js.map': '{}' }
    );
    await fixture.run('--flatten=dist', '--remove-sourcemaps', '--no-cleanup-files');
    assert.equal((await fixture.pkg()).files, undefined);
    assert.deepEqual(await fixture.pack(), ['index.js', 'package.json']);
});

for (const main of ['index.js', './index.js']) {
    test(`files comparison preserves npm main handling for ${main}`, async t => {
        const fixture = await packageFixture(
            t,
            { name: 'fixture', version: '1.0.0', main, files: ['index.js'] },
            { 'index.js': 'export {};', '.npmignore': 'index.js\n' }
        );
        const before = await fixture.pack();
        await fixture.run('--no-cleanup-files');
        assert.equal((await fixture.pkg()).files === undefined, main === 'index.js');
        assert.deepEqual(await fixture.pack(), before);
    });
}

for (const bin of ['./cli.js', { fixture: './cli.js' }]) {
    test(`files comparison normalizes npm bin paths for ${JSON.stringify(bin)}`, async t => {
        const fixture = await packageFixture(
            t,
            { name: 'fixture', version: '1.0.0', bin, files: ['cli.js'] },
            { 'cli.js': 'console.log(42);', '.npmignore': 'cli.js\n' }
        );
        const before = await fixture.pack();
        await fixture.run('--no-cleanup-files');
        assert.equal((await fixture.pkg()).files, undefined);
        assert.deepEqual(await fixture.pack(), before);
    });
}

test('files comparison preserves bundled dependencies without traversing their dependency tree', async t => {
    const fixture = await packageFixture(
        t,
        {
            name: 'fixture',
            version: '1.0.0',
            files: ['index.js'],
            dependencies: { bundled: '1.0.0' },
            bundleDependencies: ['bundled'],
        },
        {
            'index.js': 'export {};',
            'node_modules/bundled/package.json': JSON.stringify({ name: 'bundled', version: '1.0.0' }),
            'node_modules/bundled/index.js': 'module.exports = 42;',
        }
    );
    const before = await fixture.pack();
    assert.ok(before.includes('node_modules/bundled/index.js'));
    await fixture.run('--no-cleanup-files');
    assert.equal((await fixture.pkg()).files, undefined);
    assert.deepEqual(await fixture.pack(), before);
});

test('programmatic pruning retains the whitelist when the manifest has not been written yet', async t => {
    const fixture = await packageFixture(
        t,
        { name: 'fixture', version: '1.0.0', files: ['index.js'] },
        { 'index.js': 'export {};', 'private.txt': 'private' }
    );
    const before = await fixture.pack();
    await fixture.node(
        '--input-type=module',
        '-e',
        `import { readFile, rm, writeFile } from 'node:fs/promises';
        import { prunePkg } from ${JSON.stringify(new URL('../src/prune.js', import.meta.url).href)};
        const pkg = JSON.parse(await readFile('package.json', 'utf8'));
        await rm('package.json');
        await prunePkg(pkg, {
            profile: 'library', flatten: false, stripComments: false, removeSourcemaps: false,
            cleanupFiles: false, optimizeFiles: false,
        }, () => {});
        await writeFile('package.json', JSON.stringify(pkg));`
    );
    assert.deepEqual((await fixture.pkg()).files, ['index.js']);
    assert.deepEqual(await fixture.pack(), before);
});
