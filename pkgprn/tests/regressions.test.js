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
