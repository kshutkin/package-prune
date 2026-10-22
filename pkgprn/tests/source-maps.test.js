import assert from 'node:assert/strict';
import test from 'node:test';

import { decode, encode } from '@jridgewell/sourcemap-codec';

import { stripCommentsWithLineMap } from '../src/strip-comments.js';
import { packageFixture } from './package-fixture.js';

const regular = new Set(['regular']);

test('declaration maps referencing unchanged TypeScript retain positions and embedded source', async t => {
    const source = '// TypeScript source\nexport const x = 1;';
    const map = { version: 3, sources: ['index.mts'], sourcesContent: [source], names: [], mappings: encode([[[0, 0, 1, 0]]]) };
    const original = JSON.stringify(map);
    const fixture = await packageFixture(
        t,
        {},
        {
            'index.mjs': '// strip this\nexport const x = 1;',
            'index.mts': source,
            'index.d.mts.map': original,
        }
    );
    await fixture.run('--strip-comments');
    assert.equal(await fixture.read('index.d.mts.map'), original);
    assert.equal(await fixture.read('index.mts'), source);
});

for (const extension of ['js', 'mjs', 'cjs', 'css', 'd.ts', 'd.mts', 'd.cts']) {
    for (const target of ['debug.map', 'maps/debug.map', '../maps/debug.map', 'missing.map', 'data:application/json;base64,e30=']) {
        test(`sourcemap removal finds ${target} in ${extension} files`, async t => {
            const css = extension === 'css';
            const original = css ? 'body{}' : 'const x = 1;';
            const directive = css ? `/*# sourceMappingURL=${target} */` : `//# sourceMappingURL=${target}`;
            const fixture = await packageFixture(
                t,
                {},
                {
                    [`dist/index.${extension}`]: `${original}\n${directive}`,
                    'dist/debug.map': '{}',
                    'dist/maps/debug.map': '{}',
                    'maps/debug.map': '{}',
                }
            );
            await fixture.run('--remove-sourcemaps');
            assert.equal(await fixture.read(`dist/index.${extension}`), original);
            for (const map of ['dist/debug.map', 'dist/maps/debug.map', 'maps/debug.map']) {
                await assert.rejects(fixture.read(map), { code: 'ENOENT' });
            }
        });
    }
}

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

for (const extension of ['ts', 'mts', 'cts']) {
    const sourceFile = extension === 'ts' ? 'index.js' : extension === 'mts' ? 'index.mjs' : 'index.cjs';
    const mapFile = `index.d.${extension}.map`;
    test(`declaration maps track original columns and embedded source contents for ${extension}`, async t => {
        const line = 'const answer = /* docs */ 42;';
        const source = `// heading\n${line}\n`;
        const fixture = await packageFixture(
            t,
            {},
            {
                [sourceFile]: source,
                [mapFile]: JSON.stringify({
                    version: 3,
                    sources: [sourceFile, 'other.js'],
                    sourcesContent: [source, 'other'],
                    names: ['answer'],
                    mappings: encode([
                        [
                            [0, 0, 1, line.indexOf('42'), 0],
                            [3, 1, 4, 6],
                        ],
                    ]),
                }),
            }
        );
        await fixture.run('--strip-comments');
        const stripped = await fixture.read(sourceFile);
        const map = JSON.parse(await fixture.read(mapFile));
        assert.deepEqual(decode(map.mappings), [
            [
                [0, 0, 0, stripped.indexOf('42'), 0],
                [3, 1, 4, 6],
            ],
        ]);
        assert.deepEqual(map.sourcesContent, [stripped, 'other']);
    });
}
