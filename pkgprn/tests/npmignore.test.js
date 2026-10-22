import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { packageFixture } from './package-fixture.js';

const contents = {
    'root-private.txt': 'root private',
    'keep.txt': 'keep',
    'drop.txt': 'drop',
    'dist/public.js': 'public',
    'dist/private.js': 'private',
    'dist/.hidden.js': 'hidden',
    'dist/keep.secret': 'keep secret',
    'dist/drop.secret': 'drop secret',
    'dist/nested/public.js': 'nested public',
    'dist/nested/private.js': 'nested private',
    'README.md': 'read me',
    LICENSE: 'license',
};

const cases = [
    {
        name: 'literal filenames survive whitelist serialization',
        rules: { '.npmignore': 'private.txt\n' },
        extra: {
            '[keep].txt': 'brackets',
            '!keep.txt': 'bang',
            'a b.txt': 'spaces',
            'private.txt': 'private',
            'dist/(keep).js': 'parentheses',
        },
    },
    { name: 'dot whitelist remains restrictive', files: ['.'], rules: { '.npmignore': '' } },
    { name: 'redundant root whitelist remains restrictive', files: ['././'], rules: { '.npmignore': '' } },
    { name: 'empty string root whitelist', files: [''], rules: { '.npmignore': '' } },
    {
        name: 'excluded directory blocks nested reinclusion',
        rules: { '.npmignore': 'dist/nested/\n', 'dist/nested/.npmignore': '!public.js\n' },
    },
    { name: 'parent directory reinclusion', rules: { '.npmignore': 'dist/*\n!dist/nested/\n!dist/nested/public.js\n' } },
    { name: 'root npmignore', rules: { '.npmignore': '/root-private.txt\n*.secret\n!dist/keep.secret\nREADME.md\nLICENSE\n' } },
    { name: 'gitignore fallback', rules: { '.gitignore': 'root-private.txt\n*.secret\n' } },
    { name: 'npmignore replaces gitignore', rules: { '.npmignore': 'drop.txt\n', '.gitignore': 'keep.txt\n' } },
    { name: 'empty npmignore replaces gitignore', rules: { '.npmignore': '', '.gitignore': '*\n' } },
    { name: 'files overrides root ignores', files: ['dist'], rules: { '.npmignore': 'dist\n', '.gitignore': 'dist\n' } },
    { name: 'literal directory and nested rules', files: ['dist'], rules: { 'dist/.npmignore': '/private.js\n' } },
    { name: 'glob and nested rules', files: ['dist/**/*.js'], rules: { 'dist/.npmignore': 'private.js\n' } },
    { name: 'brace whitelist and nested rules', files: ['dist/{public,private}.js'], rules: { 'dist/.npmignore': 'private.js\n' } },
    { name: 'nested gitignore fallback', files: ['dist/**/*.js'], rules: { 'dist/.gitignore': 'private.js\n' } },
    { name: 'nested npmignore replaces gitignore', files: ['dist'], rules: { 'dist/.npmignore': '', 'dist/.gitignore': '*.js\n' } },
    { name: 'nested negation', files: ['dist'], rules: { 'dist/.npmignore': '*.js\n!public.js\n' } },
    { name: 'ordered nested rules', files: ['dist'], rules: { 'dist/.npmignore': '*.js\n!public.js\npublic.js\n!public.js\n' } },
    {
        name: 'layered rules',
        rules: { '.npmignore': '*.secret\n', 'dist/.npmignore': '!keep.secret\n', 'dist/nested/.npmignore': 'private.js\n' },
    },
    { name: 'explicit file overrides nested ignores', files: ['dist/private.js'], rules: { 'dist/.npmignore': 'private.js\n' } },
    {
        name: 'nested reinclusion after files exclusion',
        files: ['dist', '!dist/private.js'],
        rules: { 'dist/.npmignore': '!private.js\n' },
    },
    { name: 'explicit root whitelist', files: ['./'], rules: { '.npmignore': 'root-private.txt\n', 'dist/.npmignore': 'private.js\n' } },
    { name: 'empty whitelist', files: [], rules: { '.npmignore': '!keep.txt\n' } },
    { name: 'negated artifact', rules: { 'dist/.npmignore': '!file.orig\n' }, extra: { 'dist/file.orig': 'explicit artifact' } },
];

test('ignore rules preserve required main, bin, and documentation files', async t => {
    const fixture = await packageFixture(
        t,
        {
            name: 'fixture',
            version: '1.0.0',
            main: 'dist/index.js',
            bin: { fixture: 'tools/cli.js' },
        },
        {
            '.npmignore': '*\n',
            'dist/index.js': 'main',
            'tools/cli.js': 'bin',
            'README.md': 'read me',
            LICENSE: 'license',
            'private.txt': 'private',
        }
    );
    const before = await fixture.pack();
    await fixture.run();
    assert.deepEqual(await fixture.pack(), before);
});

for (const scenario of cases) {
    for (const args of [[], ['--no-cleanup-files'], ['--no-cleanup-files', '--no-optimize-files']]) {
        test(`${scenario.name} preserves npm contents with ${args.join(' ') || 'default cleanup'}`, async t => {
            const files = { ...contents, ...scenario.extra, ...scenario.rules };
            const fixture = await packageFixture(t, { name: 'fixture', version: '1.0.0', files: scenario.files }, files);
            const before = await fixture.pack();
            await fixture.run(...args);
            assert.deepEqual(await fixture.pack(), before);
            if (scenario.name === 'literal filenames survive whitelist serialization') {
                await fixture.run(...args);
                assert.deepEqual(await fixture.pack(), before);
            }
            for (const [file, content] of Object.entries(files)) {
                if (args.length || before.includes(file)) assert.equal(await fixture.read(file), content);
                else await assert.rejects(fixture.read(file), { code: 'ENOENT' });
            }
        });
    }
}

for (const cleanup of [true, false]) {
    for (const flatten of ['--flatten', '--flatten=dist']) {
        test(`flatten preserves ignore selection with cleanup=${cleanup}, ${flatten}`, async t => {
            const privateSource = '// private comment\nexport const privateValue = 1;\n';
            const fixture = await packageFixture(
                t,
                {
                    name: 'fixture',
                    version: '1.0.0',
                    type: 'module',
                    main: './dist/index.js',
                    files: ['dist'],
                },
                {
                    '.npmignore': 'dist\n',
                    'dist/.npmignore': 'private*\n',
                    'dist/index.js': '// strip me\nconsole.log(42);\n//# sourceMappingURL=index.js.map\n',
                    'dist/index.js.map': '{}',
                    'dist/private.js': privateSource,
                    'dist/private.js.map': '{}',
                }
            );
            await fixture.run(flatten, '--strip-comments', '--remove-sourcemaps', ...(cleanup ? [] : ['--no-cleanup-files']));
            assert.deepEqual(await fixture.pack(), ['index.js', 'package.json']);
            assert.equal((await fixture.node('index.js')).stdout.trim(), '42');
            if (!cleanup) {
                assert.equal(await fixture.read('dist/private.js'), privateSource);
                assert.equal(await fixture.read('dist/private.js.map'), '{}');
                assert.equal(await fixture.read('.npmignore'), 'dist\n');
                assert.equal(await fixture.read('dist/.npmignore'), 'private*\n');
            } else await assert.rejects(fixture.read('dist/private.js'), { code: 'ENOENT' });
        });
    }
}

test('ignore discovery does not read linked ignore files or recurse through linked directories', async t => {
    const external = await mkdtemp(path.join(tmpdir(), 'pkgprn-ignore-external-'));
    t.after(() => rm(external, { recursive: true, force: true }));
    await writeFile(path.join(external, 'rules'), '*\n');
    const fixture = await packageFixture(
        t,
        { name: 'fixture', version: '1.0.0' },
        {
            '.gitignore': 'private.js\n',
            'public.js': 'public',
            'private.js': 'private',
        }
    );
    await symlink(path.join(external, 'rules'), path.join(fixture.cwd, '.npmignore'));
    await symlink(external, path.join(fixture.cwd, 'linked'));
    await fixture.run();
    assert.equal(await fixture.read('public.js'), 'public');
    await assert.rejects(fixture.read('private.js'), { code: 'ENOENT' });
    assert.equal(await readFile(path.join(external, 'rules'), 'utf8'), '*\n');
});
