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
