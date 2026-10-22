import assert from 'node:assert/strict';
import test from 'node:test';

import { packageFixture } from './package-fixture.js';

for (const args of [['--flatten=auto'], ['--flatten', 'auto']]) {
    test(`auto alias enables automatic flattening: ${args.join(' ')}`, async t => {
        const fixture = await packageFixture(
            t,
            { main: './dist/index.js', files: ['dist'] },
            {
                'dist/index.js': 'console.log(42);',
            }
        );
        await fixture.run(...args);
        assert.equal((await fixture.pkg()).main, './index.js');
        assert.equal((await fixture.node('index.js')).stdout.trim(), '42');
    });
}

test('a directory named auto remains selectable using an explicit relative path', async t => {
    const fixture = await packageFixture(t, { main: './dist/main.js' }, {
        'auto/index.js': 'console.log(42);',
        'dist/main.js': 'console.log(1);',
    });
    await fixture.run('--flatten=./auto');
    assert.equal((await fixture.pkg()).main, './dist/main.js');
    assert.equal((await fixture.node('index.js')).stdout.trim(), '42');
});
