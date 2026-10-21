import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { packageFixture } from './package-fixture.js';

for (const operation of ['cleanup', 'comments', 'maps', 'flatten']) {
    test(`${operation} leaves external symlink targets untouched`, async t => {
        const external = await mkdtemp(path.join(tmpdir(), 'pkgprn-external-'));
        t.after(() => rm(external, { recursive: true, force: true }));
        const source = '// preserve\nconst x = 1;\n';
        await writeFile(path.join(external, 'source.js'), source);
        await writeFile(path.join(external, 'private.js'), 'private');
        const fixture = await packageFixture(t, operation === 'cleanup' ? { files: ['linked/source.js'] } : {}, {
            'linked.js.map': '{}',
        });
        await symlink(external, path.join(fixture.cwd, 'linked'));
        await symlink(path.join(external, 'source.js'), path.join(fixture.cwd, 'linked.js'));
        if (operation === 'flatten') {
            await assert.rejects(fixture.run('--flatten=linked'));
        } else {
            await fixture.run(...(operation === 'comments' ? ['--strip-comments'] : operation === 'maps' ? ['--remove-sourcemaps'] : []));
        }
        assert.equal(await readFile(path.join(external, 'source.js'), 'utf8'), source);
        assert.equal(await readFile(path.join(external, 'private.js'), 'utf8'), 'private');
    });
}

for (const files of [['dist/**/*.js'], ['dist', '!dist/*.map', 'dist/keep.map'], ['dist/@(a|b).js']]) {
    for (const cleanup of [true, false]) {
        test(`ordered whitelist ${JSON.stringify(files)} matches npm with cleanup=${cleanup}`, async t => {
            const fixture = await packageFixture(
                t,
                { name: 'fixture', version: '1.0.0', files },
                {
                    'dist/a.js': '',
                    'dist/b.js': '',
                    'dist/c.js': '',
                    'dist/.hidden.js': '',
                    'dist/.hidden/index.js': '',
                    'dist/keep.map': '',
                    'dist/drop.map': '',
                }
            );
            const before = await fixture.pack();
            await fixture.run(...(cleanup ? [] : ['--no-cleanup-files']));
            assert.deepEqual(await fixture.pack(), before);
        });
    }
}

for (const files of [[], ['README.md'], ['missing/**/*.js']]) {
    test(`optimization retains restrictive whitelist ${JSON.stringify(files)}`, async t => {
        const fixture = await packageFixture(
            t,
            { name: 'fixture', version: '1.0.0', files },
            {
                'README.md': 'read me',
                'private.txt': 'private',
            }
        );
        const before = await fixture.pack();
        await fixture.run('--no-cleanup-files');
        assert.deepEqual(await fixture.pack(), before);
        assert.deepEqual((await fixture.pkg()).files, []);
    });
}

test('flatten preserves package-local private imports and external targets', async t => {
    const fixture = await packageFixture(
        t,
        {
            type: 'module',
            exports: './dist/index.js',
            files: ['dist'],
            imports: { '#private': { default: './dist/private.js' }, '#external': 'node:fs' },
        },
        { 'dist/index.js': "import value from '#private'; console.log(value);", 'dist/private.js': 'export default 42;' }
    );
    await fixture.run('--flatten');
    assert.deepEqual((await fixture.pkg()).imports, { '#private': { default: './private.js' }, '#external': 'node:fs' });
    assert.equal((await fixture.node('index.js')).stdout.trim(), '42');
});

for (const overlap of [true, false]) {
    test(`flatten rejects structural conflicts before moving files, overlap=${overlap}`, async t => {
        const files = overlap ? { 'dist/sub/index.js': 'original' } : { 'dist/a': 'first', 'lib/a/b.js': 'second' };
        const fixture = await packageFixture(t, {}, files);
        await assert.rejects(fixture.run(overlap ? '--flatten=dist,dist/sub' : '--flatten=dist,lib'));
        for (const [file, content] of Object.entries(files)) assert.equal(await fixture.read(file), content);
        await assert.rejects(fixture.read(overlap ? 'sub/index.js' : 'a/b.js'), { code: 'ENOENT' });
    });
}

test('flatten rejects symlink destination ancestors', async t => {
    const external = await mkdtemp(path.join(tmpdir(), 'pkgprn-external-'));
    t.after(() => rm(external, { recursive: true, force: true }));
    const fixture = await packageFixture(t, {}, { 'dist/a/b.js': 'original' });
    await symlink(external, path.join(fixture.cwd, 'a'));
    await assert.rejects(fixture.run('--flatten=dist'));
    assert.equal(await fixture.read('dist/a/b.js'), 'original');
    await assert.rejects(readFile(path.join(external, 'b.js')), { code: 'ENOENT' });
});

for (const flatten of [false, true]) {
    test(`invalid comment options fail before mutations, flatten=${flatten}`, async t => {
        const fixture = await packageFixture(
            t,
            { main: './dist/index.js', files: ['dist'], devDependencies: { dependency: '1.0.0' } },
            {
                'dist/index.js': 'export {};',
                'src/index.js': 'original',
            }
        );
        const before = await fixture.read('package.json');
        await assert.rejects(fixture.run('--strip-comments=typo', ...(flatten ? ['--flatten=dist'] : [])));
        assert.equal(await fixture.read('package.json'), before);
        assert.equal(await fixture.read('src/index.js'), 'original');
        assert.equal(await fixture.read('dist/index.js'), 'export {};');
    });
}

test('flatten preserves nullable URL sources and rebases encoded local paths', async t => {
    const fixture = await packageFixture(
        t,
        { main: './dist/index.js', files: ['dist', 'src'] },
        {
            'dist/index.js': 'export {};',
            'src/a b.ts': 'export {};',
            'dist/index.js.map': JSON.stringify({
                version: 3,
                sources: [null, 'webpack:///src/index.ts', 'https://example.test/src.ts', '../src/a%20b.ts'],
                names: [],
                mappings: '',
            }),
        }
    );
    await fixture.run('--flatten');
    assert.deepEqual(JSON.parse(await fixture.read('index.js.map')).sources, [
        null,
        'webpack:///src/index.ts',
        'https://example.test/src.ts',
        'src/a%20b.ts',
    ]);
});

test('flatten incorporates URL source roots without filesystem normalization', async t => {
    const fixture = await packageFixture(
        t,
        { main: './dist/index.js' },
        {
            'dist/index.js': 'export {};',
            'dist/index.js.map': JSON.stringify({
                version: 3,
                sourceRoot: 'https://example.test/src',
                sources: ['index.ts'],
                names: [],
                mappings: '',
            }),
        }
    );
    await fixture.run('--flatten');
    const map = JSON.parse(await fixture.read('index.js.map'));
    assert.deepEqual(map.sources, ['https://example.test/src/index.ts']);
    assert.equal(map.sourceRoot, undefined);
});

test('comment stripping skips nullable and remote declaration-map sources', async t => {
    const fixture = await packageFixture(
        t,
        {},
        {
            'index.js': '// comment\nconst x = 1;\n',
            'index.d.ts.map': JSON.stringify({
                version: 3,
                sources: [null, 'https://example.test/src.ts', 'index.js'],
                names: [],
                mappings: '',
            }),
        }
    );
    await fixture.run('--strip-comments');
    assert.deepEqual(JSON.parse(await fixture.read('index.d.ts.map')).sources, [null, 'https://example.test/src.ts', 'index.js']);
});
