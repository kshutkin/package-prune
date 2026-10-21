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
