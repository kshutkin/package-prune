import assert from 'node:assert/strict';
import test from 'node:test';

import { decode, encode } from '@jridgewell/sourcemap-codec';

import { stripCommentsWithLineMap } from '../src/strip-comments.js';
import { packageFixture } from './package-fixture.js';

const regular = new Set(['regular']);

test('position mapping follows removed lines and inline comment columns', () => {
    const line = 'const answer = /* docs */ 42;';
    const source = `// heading\n${line}\n`;
    const { result, mapPosition } = stripCommentsWithLineMap(source, regular);
    assert.equal(result, 'const answer =  42;\n');
    assert.equal(mapPosition(0, 0), null);
    assert.deepEqual(mapPosition(1, line.indexOf('42')), { line: 0, column: result.indexOf('42') });
});

test('comment stripping remaps generated JavaScript source positions', async t => {
    const line = 'const answer = /* docs */ 42;';
    const fixture = await packageFixture(
        t,
        {},
        {
            'index.js': `// heading\n${line}\n//# sourceMappingURL=index.js.map\n`,
            'index.js.map': JSON.stringify({
                version: 3,
                sources: ['src.ts'],
                names: [],
                mappings: encode([
                    [[0, 0, 0, 0]],
                    [
                        [0, 0, 1, 0],
                        [line.indexOf('42'), 0, 1, 10],
                    ],
                ]),
            }),
        }
    );
    await fixture.run('--strip-comments');
    const source = await fixture.read('index.js');
    assert.ok(source.startsWith('const answer =  42;\n'));
    const map = JSON.parse(await fixture.read('index.js.map'));
    assert.deepEqual(decode(map.mappings), [
        [
            [0, 0, 1, 0],
            [source.indexOf('42'), 0, 1, 10],
        ],
    ]);
});
