import assert from 'node:assert/strict';
import test from 'node:test';

import { packageFixture } from './package-fixture.js';

for (const cleanup of [true, false]) {
    test(`literal filenames preserve a directory whitelist with cleanup=${cleanup}`, async t => {
        const fixture = await packageFixture(
            t,
            { name: 'fixture', version: '1.0.0', files: ['dist'] },
            { 'dist/[name].js': 'export {};', 'private.txt': 'private' }
        );
        const before = await fixture.pack();
        await fixture.run('--no-optimize-files', ...(cleanup ? [] : ['--no-cleanup-files']));
        assert.deepEqual(await fixture.pack(), before);
        assert.equal(await fixture.read('dist/[name].js'), 'export {};');
        if (fixture.npmVersion === 12 && !cleanup) assert.deepEqual((await fixture.pkg()).files, ['dist']);
    });

    test(`patch files follow the selected npm version with cleanup=${cleanup}`, async t => {
        const fixture = await packageFixture(
            t,
            {
                name: 'fixture',
                version: '1.0.0',
                files: ['dist', 'patches'],
                patchedDependencies: { 'example@1.0.0': 'patches/example.patch' },
            },
            { 'dist/index.js': 'export {};', 'patches/example.patch': 'private patch' }
        );
        const before = await fixture.pack();
        assert.equal(before.includes('patches/example.patch'), fixture.npmVersion === 11);
        await fixture.run(...(cleanup ? [] : ['--no-cleanup-files']));
        assert.deepEqual(await fixture.pack(), before);
        if (fixture.npmVersion === 12 && cleanup) await assert.rejects(fixture.read('patches/example.patch'), { code: 'ENOENT' });
        else assert.equal(await fixture.read('patches/example.patch'), 'private patch');
    });
}

test('npm 12 rejects an unrepresentable flattened whitelist before moving files', async t => {
    const pkg = { name: 'fixture', version: '1.0.0', files: ['dist'], devDependencies: { example: '*' } };
    const fixture = await packageFixture(t, pkg, { 'dist/[name].js': 'export {};', 'private.txt': 'private' });
    await assert.rejects(fixture.run('--npm-version=12', '--flatten=dist', '--no-cleanup-files'), error => {
        assert.match(error.stdout, /npm 12 cannot preserve literal root filenames/);
        return true;
    });
    assert.deepEqual(await fixture.pkg(), pkg);
    assert.equal(await fixture.read('dist/[name].js'), 'export {};');
    assert.equal(await fixture.read('private.txt'), 'private');
    await assert.rejects(fixture.read('[name].js'), { code: 'ENOENT' });
});
