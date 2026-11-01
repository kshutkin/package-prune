import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { packageFixture } from './package-fixture.js';

const cli = new URL('../src/index.js', import.meta.url).href;
const npmVersion = process.env.PKGPRN_TEST_NPM === '12' ? 12 : 11;
const npmCli = fileURLToPath(new URL('bin/npm-cli.js', import.meta.resolve(`${npmVersion === 12 ? 'npm-v12' : 'npm'}/package.json`)));

async function pnpmFixture(t, major, pkg, files) {
    const fixture = await packageFixture(t, pkg, files, {
        // Let the real pnpm command supply its own lifecycle environment.
        npm_config_user_agent: undefined,
        npm_execpath: undefined,
    });
    const binDir = path.join(fixture.cwd, 'node_modules/.bin');
    const wrapper = path.join(fixture.cwd, 'node_modules/pkgprn-test/cli.mjs');
    await mkdir(binDir, { recursive: true });
    await mkdir(path.dirname(wrapper), { recursive: true });
    await writeFile(
        wrapper,
        `#!/usr/bin/env node
        import { writeFile } from 'node:fs/promises';
        await writeFile(new URL('./environment.json', import.meta.url), JSON.stringify({
            userAgent: process.env.npm_config_user_agent,
            execPath: process.env.npm_execpath,
        }));
        await import(${JSON.stringify(cli)});
    `,
        { mode: 0o755 }
    );
    await symlink(wrapper, path.join(binDir, 'pkgprn'));
    // Resolve npm from PATH independently of whichever Node runs this suite.
    await symlink(npmCli, path.join(binDir, 'npm'));
    const pnpmCli = fileURLToPath(new URL(`../node_modules/pnpm-v${major}/bin/pnpm.mjs`, import.meta.url));
    return {
        ...fixture,
        pnpm: (...args) => fixture.node(pnpmCli, ...args),
        environment: async () => JSON.parse(await fixture.read('node_modules/pkgprn-test/environment.json')),
    };
}

async function assertPnpmEnvironment(fixture, major) {
    const environment = await fixture.environment();
    assert.match(environment.userAgent, new RegExp(`^pnpm/${major}\\.`));
    assert.doesNotMatch(environment.userAgent, /(?:^|\s)npm\/\d/);
    assert.notEqual(environment.execPath, npmCli);
}

for (const major of [11, 12]) {
    for (const invocation of ['exec', 'run']) {
        test(`pnpm ${major} ${invocation} detects npm ${npmVersion} from PATH`, async t => {
            const fixture = await pnpmFixture(
                t,
                major,
                {
                    name: 'fixture',
                    version: '1.0.0',
                    files: ['./'],
                    scripts: { prepack: 'pkgprn' },
                },
                { 'index.js': 'export {};' }
            );
            const before = await fixture.pack();
            await fixture.pnpm(...(invocation === 'exec' ? ['exec', 'pkgprn'] : ['run', 'prepack']));
            await assertPnpmEnvironment(fixture, major);
            assert.deepEqual(await fixture.pack(), before);
            if (npmVersion === 11) assert.equal(await fixture.read('index.js'), 'export {};');
            else await assert.rejects(fixture.read('index.js'), { code: 'ENOENT' });
        });

        test(`pnpm ${major} ${invocation} honors an explicit npm version over npm ${npmVersion} on PATH`, async t => {
            const requested = npmVersion === 11 ? 12 : 11;
            const fixture = await pnpmFixture(
                t,
                major,
                {
                    name: 'fixture',
                    version: '1.0.0',
                    files: ['./'],
                    scripts: { prepack: `pkgprn --npm-version=${requested}` },
                },
                { 'index.js': 'export {};' }
            );
            await fixture.pnpm(...(invocation === 'exec' ? ['exec', 'pkgprn', `--npm-version=${requested}`] : ['run', 'prepack']));
            await assertPnpmEnvironment(fixture, major);
            const expected = requested === 11 ? ['index.js', 'package.json'] : ['package.json'];
            assert.deepEqual(await fixture.pack(), expected);
        });
    }

    test(`pnpm ${major} prepack forwards npm 12 global ignore configuration`, { skip: npmVersion !== 12 }, async t => {
        const fixture = await pnpmFixture(
            t,
            major,
            {
                name: 'fixture',
                version: '1.0.0',
                files: ['index.js'],
                scripts: { prepack: 'pkgprn' },
            },
            { 'index.js': 'export {};' }
        );
        const ignoreFile = path.join(fixture.cwd, 'node_modules/pkgprn-test/global-ignore');
        await writeFile(ignoreFile, 'index.js\n');
        // The local .npmrc is also read by the npm CLI invoked through pnpm.
        await writeFile(path.join(fixture.cwd, '.npmrc'), `global-ignore-file=${ignoreFile}\n`);
        const before = await fixture.pack();
        await fixture.pnpm('run', 'prepack');
        await assertPnpmEnvironment(fixture, major);
        assert.ok((await fixture.pkg()).files);
        assert.deepEqual(await fixture.pack(), before);
    });

    for (const cleanup of [true, false]) {
        for (const scenario of [
            { name: 'root whitelist', files: ['./'], disk: { 'index.js': 'export {};' } },
            { name: 'nested ignore override', files: ['dist/index.js'], disk: { 'dist/index.js': 'export {};', 'dist/.npmignore': '*\n' } },
            { name: 'literal filename', files: ['dist'], disk: { 'dist/[name].js': 'export {};', 'private.txt': 'private' } },
        ]) {
            test(`pnpm ${major} pack prepack preserves ${scenario.name}, cleanup=${cleanup}`, async t => {
                const fixture = await pnpmFixture(
                    t,
                    major,
                    {
                        name: 'fixture',
                        version: '1.0.0',
                        files: scenario.files,
                    },
                    scenario.disk
                );
                const before = JSON.parse((await fixture.pnpm('pack', '--dry-run', '--json')).stdout)
                    .files.map(file => file.path)
                    .sort();
                assert.ok(before.some(file => file !== 'package.json'));
                const pkg = await fixture.pkg();
                // pnpm's pack rules retain npm 11's root and explicit-file behavior.
                pkg.scripts = { prepack: `pkgprn --npm-version=11${cleanup ? '' : ' --no-cleanup-files'}` };
                await writeFile(path.join(fixture.cwd, 'package.json'), JSON.stringify(pkg));
                const { stdout } = await fixture.pnpm('pack', '--dry-run', '--json');
                // Lifecycle logs precede pnpm's JSON result.
                const start = stdout.indexOf('{\n  "name": "fixture"');
                assert.ok(start >= 0, stdout);
                const after = JSON.parse(stdout.slice(start))
                    .files.map(file => file.path)
                    .sort();
                await assertPnpmEnvironment(fixture, major);
                assert.deepEqual(after, before);
            });
        }
    }
}
