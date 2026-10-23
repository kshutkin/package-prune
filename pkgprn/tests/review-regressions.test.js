import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { packageFixture } from './package-fixture.js';

for (const optimize of [true, false]) {
    for (const flatten of [true, false]) {
        test(`resolved literal filenames survive serialization with flatten=${flatten}, optimize=${optimize}`, async t => {
            const fixture = await packageFixture(
                t,
                { name: 'fixture', version: '1.0.0', main: 'dist/index.js', files: flatten ? ['dist'] : ['dist/**/*.js'] },
                {
                    'dist/index.js': 'export {};',
                    'dist/[name].js': 'brackets',
                    'dist/n.js': 'plain',
                    'dist/!keep.js': 'bang',
                    'dist/{literal}.js': 'braces',
                    'dist/[directory]/file.js': 'nested brackets',
                    'dist/private.txt': 'private',
                }
            );
            const before = await fixture.pack();
            const args = ['--no-cleanup-files', ...(optimize ? [] : ['--no-optimize-files'])];
            await fixture.run(...args, ...(flatten ? ['--flatten=dist'] : []));
            const expected = before.map(file => (flatten ? file.replace(/^dist\//, '') : file)).sort();
            assert.deepEqual(await fixture.pack(), expected);
            await fixture.run(...args);
            assert.deepEqual(await fixture.pack(), expected);
        });
    }
}

for (const cleanup of [true, false]) {
    for (const ignored of [true, false]) {
        test(`directories.bin preserves npm commands with cleanup=${cleanup}, ignores=${ignored}`, async t => {
            const fixture = await packageFixture(
                t,
                { name: 'fixture', version: '1.0.0', directories: { bin: 'tools' }, files: ignored ? undefined : [] },
                {
                    'tools/cli.js': 'console.log(42);',
                    'tools/nested/other.js': 'console.log(43);',
                    'tools/.private.js': 'private',
                    'tools/.hidden/private.js': 'private',
                    ...(ignored ? { '.npmignore': '*\n' } : {}),
                }
            );
            const before = await fixture.pack();
            await fixture.run(...(cleanup ? [] : ['--no-cleanup-files']));
            assert.deepEqual(await fixture.pack(), before);
            assert.equal(await fixture.read('tools/cli.js'), 'console.log(42);');
            assert.equal(await fixture.read('tools/nested/other.js'), 'console.log(43);');
        });
    }
}

test('an explicit bin takes precedence over directories.bin during cleanup', async t => {
    const fixture = await packageFixture(
        t,
        { name: 'fixture', version: '1.0.0', bin: { fixture: 'cli.js' }, directories: { bin: 'tools' }, files: [] },
        { 'cli.js': 'console.log(42);', 'tools/private.js': 'private' }
    );
    const before = await fixture.pack();
    await fixture.run();
    assert.deepEqual(await fixture.pack(), before);
    await assert.rejects(fixture.read('tools/private.js'), { code: 'ENOENT' });
});

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

test('flatten rejects symlink sourcemaps before moving files or modifying external targets', async t => {
    const external = await mkdtemp(path.join(tmpdir(), 'pkgprn-external-map-'));
    t.after(() => rm(external, { recursive: true, force: true }));
    const target = path.join(external, 'debug.map');
    const original = JSON.stringify({ version: 3, sources: ['source.ts'], names: [], mappings: '' });
    await writeFile(target, original);
    const fixture = await packageFixture(
        t,
        { main: './dist/index.js' },
        {
            'dist/index.js': 'export {};',
            'dist/other.js': 'original',
        }
    );
    await symlink(target, path.join(fixture.cwd, 'dist/index.js.map'));
    const pkg = await fixture.read('package.json');
    await assert.rejects(fixture.run('--flatten'), error => /cannot rebase a symlink sourcemap/.test(error.stdout));
    assert.equal(await readFile(target, 'utf8'), original);
    assert.equal(await fixture.read('dist/index.js'), 'export {};');
    assert.equal(await fixture.read('dist/other.js'), 'original');
    assert.equal(await fixture.read('package.json'), pkg);
    await assert.rejects(fixture.read('index.js'), { code: 'ENOENT' });
});

for (const files of [
    ['dist/**/*.js'],
    ['dist', '!dist/*.map', 'dist/keep.map'],
    ['dist/@(a|b).js'],
    ['dist/{a,b}.js'],
    ['dist/{a..b}.js'],
]) {
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

for (const files of [['dist', 'optional/types/index.d.ts'], ['missing/deep/index.js'], ['dist/index.js', 'missing/deep/index.js']]) {
    test(`optimization skips absent whitelist ancestors for ${JSON.stringify(files)}`, async t => {
        const fixture = await packageFixture(
            t,
            { name: 'fixture', version: '1.0.0', files },
            {
                'dist/index.js': 'export {};',
                'dist/private.js': 'private',
            }
        );
        const before = await fixture.pack();
        await fixture.run('--no-cleanup-files');
        assert.deepEqual(await fixture.pack(), before);
        assert.equal(await fixture.read('dist/private.js'), 'private');
    });
}

for (const files of [
    ['dist/file.orig'],
    ['./dist/file.orig'],
    ['dist', '!dist/drop.orig', 'dist/file.orig'],
    ['CVS'],
    ['CVS/public.js'],
    ['CVS/*'],
    ['dist'],
    ['dist/*.orig'],
    ['./'],
]) {
    test(`junk cleanup honors explicit whitelist ${JSON.stringify(files)}`, async t => {
        const fixture = await packageFixture(
            t,
            { name: 'fixture', version: '1.0.0', files },
            {
                'dist/file.orig': 'explicit',
                'dist/drop.orig': 'junk',
                'dist/index.js': 'export {};',
                'CVS/public.js': 'explicit',
                'CVS/drop.orig': 'junk',
                'README.orig': 'always included',
                'file.orig': 'root file',
                '.DS_Store': 'root artifact',
            }
        );
        const before = await fixture.pack();
        await fixture.run();
        assert.deepEqual(await fixture.pack(), before);
        if (before.includes('dist/file.orig')) assert.equal(await fixture.read('dist/file.orig'), 'explicit');
    });
}

for (const files of [[], ['README.en.md', 'License.MIT.txt', 'LICENCE.fr.md']]) {
    for (const cleanup of [true, false]) {
        test(`multi-extension documentation is always included with files=${JSON.stringify(files)}, cleanup=${cleanup}`, async t => {
            const fixture = await packageFixture(
                t,
                { name: 'fixture', version: '1.0.0', files },
                {
                    'README.en.md': 'read me',
                    'License.MIT.txt': 'license',
                    'LICENCE.fr.md': 'licence',
                    'README-backup.md': 'private',
                }
            );
            const before = await fixture.pack();
            await fixture.run(...(cleanup ? [] : ['--no-cleanup-files']));
            assert.deepEqual(await fixture.pack(), before);
            if (!cleanup) assert.deepEqual((await fixture.pkg()).files, []);
        });
    }
}

for (const cleanup of [true, false]) {
    test(`root-directory whitelist preserves npm contents with cleanup=${cleanup}`, async t => {
        const fixture = await packageFixture(
            t,
            { name: 'fixture', version: '1.0.0', files: ['./'] },
            {
                'dist/index.js': 'export {};',
                'dist/private.js': 'private',
                'dist/.npmignore': 'private.js\n',
                'root-private.js': 'explicitly included',
                '.npmignore': 'root-private.js\n',
            }
        );
        const before = await fixture.pack();
        await fixture.run(...(cleanup ? [] : ['--no-cleanup-files']));
        assert.deepEqual(await fixture.pack(), before);
        assert.ok((await fixture.pkg()).files.includes('./'));
        assert.equal(await fixture.read('dist/index.js'), 'export {};');
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

for (const browser of ['./dist/browser.js', 'dist/browser.js']) {
    test(`flatten discovers a browser-only string entry ${browser}`, async t => {
        const fixture = await packageFixture(t, { browser, files: ['dist'] }, { 'dist/browser.js': 'export default 42;' });
        await fixture.run('--flatten');
        assert.equal((await fixture.pkg()).browser, browser.replace('dist/', ''));
        assert.equal(await fixture.read('browser.js'), 'export default 42;');
    });
}

for (const flatten of ['--flatten', '--flatten=dist']) {
    test(`flatten rewrites browser map paths and preserves module aliases with ${flatten}`, async t => {
        const fixture = await packageFixture(
            t,
            {
                main: 'dist/index.js',
                files: ['dist'],
                browser: {
                    './dist/index.js': './dist/browser.js',
                    './dist/server.js': false,
                    fs: false,
                    stream: './dist/shim.js',
                    external: 'dist/index.js',
                },
            },
            {
                'dist/index.js': 'export {};',
                'dist/browser.js': 'export {};',
                'dist/server.js': 'export {};',
                'dist/shim.js': 'export {};',
            }
        );
        await fixture.run(flatten);
        assert.deepEqual((await fixture.pkg()).browser, {
            './index.js': './browser.js',
            './server.js': false,
            fs: false,
            stream: './shim.js',
            external: 'dist/index.js',
        });
        assert.equal((await fixture.pkg()).main, 'index.js');
    });
}

for (const exports of [{ node: './dist/index.js', default: './dist/index.js' }, './dist/index.js', ['./dist/index.js']]) {
    test(`flatten only removes export subpath stubs for ${JSON.stringify(exports)}`, async t => {
        const fixture = await packageFixture(
            t,
            { exports, files: ['dist', 'node', 'default', '0'] },
            {
                'dist/index.js': 'export {};',
                'node/package.json': '{"keep":true}',
                'default/package.json': '{"keep":true}',
                '0/package.json': '{"keep":true}',
            }
        );
        await fixture.run('--flatten');
        for (const dir of ['node', 'default', '0']) assert.equal(await fixture.read(`${dir}/package.json`), '{"keep":true}');
    });
}

test('flatten still removes actual export subpath stubs', async t => {
    const fixture = await packageFixture(
        t,
        { exports: { './feature': './dist/index.js' }, files: ['dist', 'feature'] },
        {
            'dist/index.js': 'export {};',
            'feature/package.json': '{}',
        }
    );
    await fixture.run('--flatten');
    await assert.rejects(fixture.read('feature/package.json'), { code: 'ENOENT' });
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
