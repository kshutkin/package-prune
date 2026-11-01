import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { packageFixture } from './package-fixture.js';

test('cleanup preserves protected descendants of otherwise unpublished directories', async t => {
    const fixture = await packageFixture(
        t,
        { files: [] },
        {
            'packages/demo/node_modules/dep/index.js': 'dependency',
            'packages/demo/.git/config': 'repository',
            'packages/demo/.npmrc': 'configuration',
            'packages/demo/private.txt': 'private',
            'packages/unused/file.txt': 'private',
            'CVS/project/node_modules/dep/index.js': 'dependency',
            'CVS/project/private.txt': 'private',
        }
    );
    await symlink('missing-target', path.join(fixture.cwd, 'packages/demo/link'));
    await fixture.run('--npm-version=12');
    assert.equal(await fixture.read('packages/demo/node_modules/dep/index.js'), 'dependency');
    assert.equal(await fixture.read('packages/demo/.git/config'), 'repository');
    assert.equal(await fixture.read('packages/demo/.npmrc'), 'configuration');
    assert.equal(await fixture.read('CVS/project/node_modules/dep/index.js'), 'dependency');
    await assert.rejects(fixture.read('packages/demo/private.txt'), { code: 'ENOENT' });
    await assert.rejects(fixture.read('packages/unused/file.txt'), { code: 'ENOENT' });
    await assert.rejects(fixture.read('CVS/project/private.txt'), { code: 'ENOENT' });
});

test('unwritten manifests preserve literal filenames under an authored directory whitelist', async t => {
    const fixture = await packageFixture(
        t,
        { name: 'fixture', version: '1.0.0', files: ['dist'] },
        {
            'dist/[name].js': 'export {};',
            'private.txt': 'private',
        }
    );
    const before = await fixture.pack();
    await fixture.node(
        '--input-type=module',
        '-e',
        `
        import { readFile, rm, writeFile } from 'node:fs/promises';
        import { prunePkg } from ${JSON.stringify(new URL('../src/prune.js', import.meta.url).href)};
        const pkg = JSON.parse(await readFile('package.json', 'utf8'));
        await rm('package.json');
        await prunePkg(pkg, {
            profile: 'library', flatten: false, stripComments: false, removeSourcemaps: false,
            cleanupFiles: false, optimizeFiles: false, npmVersion: 12,
        }, Object.assign(() => {}, { update() {} }));
        await writeFile('package.json', JSON.stringify(pkg));
    `
    );
    assert.deepEqual((await fixture.pkg()).files, ['dist']);
    assert.deepEqual(await fixture.pack(), before);
});

for (const config of ['environment', 'project', 'user', 'prefix']) {
    test(`npm 12 keeps a whitelist that overrides global ignores from ${config} configuration`, async t => {
        if (process.env.PKGPRN_TEST_NPM !== '12') return;
        const external = await mkdtemp(path.join(tmpdir(), 'pkgprn-ignore-'));
        t.after(() => rm(external, { recursive: true, force: true }));
        const ignoreFile = config === 'prefix' ? path.join(external, 'etc/npmignore') : path.join(external, 'ignore');
        await mkdir(path.dirname(ignoreFile), { recursive: true });
        await writeFile(ignoreFile, 'index.js\n');
        const userConfig = path.join(external, 'npmrc');
        if (config === 'user') await writeFile(userConfig, `global-ignore-file=${ignoreFile}\n`);
        const env =
            config === 'environment'
                ? { npm_config_global_ignore_file: ignoreFile }
                : config === 'user'
                  ? { npm_config_userconfig: userConfig }
                  : config === 'prefix'
                    ? { npm_config_prefix: external }
                    : {};
        const fixture = await packageFixture(
            t,
            { name: 'fixture', version: '1.0.0', files: ['index.js'] },
            {
                'index.js': 'export {};',
                ...(config === 'project' ? { '.npmrc': `global-ignore-file=${ignoreFile}\n` } : {}),
            },
            env
        );
        const before = await fixture.pack();
        assert.deepEqual(before, ['index.js', 'package.json']);
        await fixture.run();
        assert.ok((await fixture.pkg()).files);
        assert.deepEqual(await fixture.pack(), before);
    });
}

test('npm 12 applies global ignores before transforming files without cleanup', async t => {
    if (process.env.PKGPRN_TEST_NPM !== '12') return;
    const external = await mkdtemp(path.join(tmpdir(), 'pkgprn-ignore-'));
    t.after(() => rm(external, { recursive: true, force: true }));
    const ignoreFile = path.join(external, 'ignore');
    await writeFile(ignoreFile, 'private.js\n');
    const source = '// private comment\nexport {};';
    const fixture = await packageFixture(
        t,
        { name: 'fixture', version: '1.0.0' },
        {
            'index.js': '// public comment\nexport {};',
            'private.js': source,
        },
        { npm_config_global_ignore_file: ignoreFile }
    );
    const before = await fixture.pack();
    assert.deepEqual(before, ['index.js', 'package.json']);
    await fixture.run('--no-cleanup-files', '--strip-comments');
    assert.deepEqual(await fixture.pack(), before);
    assert.equal(await fixture.read('private.js'), source);
    assert.equal(await fixture.read('index.js'), 'export {};');
});

for (const cleanup of [true, false]) {
    test(`npm 12 respects nested ignores for directory commands with cleanup=${cleanup}`, async t => {
        if (process.env.PKGPRN_TEST_NPM !== '12') return;
        const fixture = await packageFixture(
            t,
            {
                name: 'fixture',
                version: '1.0.0',
                directories: { bin: 'tools' },
                files: ['tools'],
            },
            { 'tools/cli.js': 'console.log(42);', 'tools/.npmignore': '*\n' }
        );
        const before = await fixture.pack();
        assert.deepEqual(before, ['package.json']);
        await fixture.run('--flatten=tools', ...(cleanup ? [] : ['--no-cleanup-files']));
        assert.deepEqual(await fixture.pack(), before);
        if (!cleanup) assert.equal(await fixture.read('tools/cli.js'), 'console.log(42);');
        await assert.rejects(fixture.read('cli.js'), { code: 'ENOENT' });
    });
}
