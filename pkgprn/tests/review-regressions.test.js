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
