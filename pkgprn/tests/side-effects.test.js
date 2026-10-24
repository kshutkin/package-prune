import assert from 'node:assert/strict';
import test from 'node:test';

import { packageFixture } from './package-fixture.js';

for (const flatten of ['--flatten', '--flatten=dist']) {
    for (const cleanup of [true, false]) {
        test(`flatten rewrites sideEffects paths and globs with ${flatten}, cleanup=${cleanup}`, async t => {
            const fixture = await packageFixture(
                t,
                {
                    name: 'fixture',
                    version: '1.0.0',
                    main: './dist/index.js',
                    files: ['dist', 'outside'],
                    sideEffects: ['./dist/register.js', './dist/**/*.css', 'dist/*.mjs', '**/*.svg', '*.png', './outside/register.js'],
                },
                {
                    'dist/index.js': 'import "./register.js";',
                    'dist/register.js': 'globalThis.registered = true;',
                    'dist/nested/style.css': 'body {}',
                    'dist/setup.mjs': 'export {};',
                    'outside/register.js': 'globalThis.otherRegistered = true;',
                }
            );
            await fixture.run(flatten, ...(cleanup ? [] : ['--no-cleanup-files']));
            assert.deepEqual((await fixture.pkg()).sideEffects, [
                './register.js',
                './**/*.css',
                './*.mjs',
                '**/*.svg',
                '*.png',
                './outside/register.js',
            ]);
        });
    }

    for (const sideEffects of [true, false, []]) {
        test(`flatten preserves sideEffects=${JSON.stringify(sideEffects)} with ${flatten}`, async t => {
            const fixture = await packageFixture(
                t,
                { name: 'fixture', version: '1.0.0', main: './dist/index.js', files: ['dist'], sideEffects },
                { 'dist/index.js': 'export {};' }
            );
            await fixture.run(flatten);
            assert.deepEqual((await fixture.pkg()).sideEffects, sideEffects);
        });
    }
}

test('flatten rewrites sideEffects for multiple roots without changing similarly named directories', async t => {
    const fixture = await packageFixture(
        t,
        {
            name: 'fixture',
            version: '1.0.0',
            main: './dist/index.js',
            files: ['dist', 'styles', 'dist-other'],
            sideEffects: ['./dist/register.js', './styles/*.css', './dist-other/register.js'],
        },
        {
            'dist/index.js': 'export {};',
            'dist/register.js': 'globalThis.registered = true;',
            'styles/theme.css': 'body {}',
            'dist-other/register.js': 'globalThis.otherRegistered = true;',
        }
    );
    await fixture.run('--flatten=dist,styles');
    assert.deepEqual((await fixture.pkg()).sideEffects, ['./register.js', './*.css', './dist-other/register.js']);
});

for (const pattern of ['./dist/**/*.js', './{dist,styles}/**/*.js']) {
    test(`partial flatten preserves sideEffects coverage for ${pattern}`, async t => {
        const fixture = await packageFixture(
            t,
            {
                name: 'fixture',
                version: '1.0.0',
                main: './dist/esm/index.js',
                files: ['dist'],
                sideEffects: [pattern],
            },
            {
                'dist/esm/[setup].js': 'globalThis.setup = true;',
                'dist/esm/index.js': 'export {};',
                'dist/esm/register.js': 'globalThis.registered = true;',
                'dist/cjs/register.js': 'globalThis.otherRegistered = true;',
            }
        );
        await fixture.run('--flatten=dist/esm');
        assert.deepEqual((await fixture.pkg()).sideEffects, [pattern, './[[]setup[]].js', './index.js', './register.js']);
    });
}
