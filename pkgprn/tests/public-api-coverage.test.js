import assert from 'node:assert/strict';
import { chmod, mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { decode, encode } from '@jridgewell/sourcemap-codec';

import { packageFixture } from './package-fixture.js';

// Resolve the package export here: fixture processes run outside this package.
const publicEntry = import.meta.resolve('pkgprn');

async function runApi(fixture, options = {}, setup = '') {
    return fixture.node(
        '--input-type=module',
        '-e',
        `import { readFile, writeFile } from 'node:fs/promises';
        import { prunePkg } from ${JSON.stringify(publicEntry)};
        const pkg = JSON.parse(await readFile('package.json', 'utf8'));
        ${setup}
        await prunePkg(pkg, ${JSON.stringify({
            profile: 'library',
            flatten: false,
            removeSourcemaps: false,
            stripComments: false,
            optimizeFiles: true,
            cleanupFiles: true,
            ...options,
        })}, Object.assign(() => {}, { update() {} }));
        await writeFile('package.json', JSON.stringify(pkg));`
    );
}

test('public API rejects an unsupported npmVersion before mutations', async t => {
    const pkg = { files: ['index.js'], devDependencies: { example: '*' } };
    const fixture = await packageFixture(t, pkg, { 'index.js': '// keep' });
    await assert.rejects(runApi(fixture, { npmVersion: 13 }), /npmVersion must be 11 or 12/);
    assert.deepEqual(await fixture.pkg(), pkg);
    assert.equal(await fixture.read('index.js'), '// keep');
});

for (const version of [11, 12]) {
    test(`missing npm executable falls back safely with npm ${version} rules`, async t => {
        const fixture = await packageFixture(t, { files: ['./'] }, { 'index.js': 'export {};' });
        await runApi(
            fixture,
            {},
            `
            delete process.env.npm_execpath;
            delete process.env.npm_config_user_agent;
            process.env.PATH = '';
            ${version === 12 ? "process.env.npm_config_user_agent = 'npm/12.0.0';" : ''}
        `
        );
        if (version === 11) assert.equal(await fixture.read('index.js'), 'export {};');
        else await assert.rejects(fixture.read('index.js'), { code: 'ENOENT' });
    });
}

for (const [name, script, message] of [
    ['invalid version', "console.log('not-a-version')", /Could not detect npm version/],
    ['failed version command', 'process.exit(42)', /Command failed/],
]) {
    test(`public API reports npm detection errors: ${name}`, async t => {
        const pkg = { devDependencies: { example: '*' } };
        const fixture = await packageFixture(t, pkg, { 'index.js': 'export {};' });
        const bin = path.join(fixture.cwd, 'node_modules/.bin');
        await mkdir(bin, { recursive: true });
        await writeFile(path.join(bin, 'npm'), `#!${process.execPath}\n${script}\n`);
        await chmod(path.join(bin, 'npm'), 0o755);
        await assert.rejects(
            runApi(fixture, {}, `delete process.env.npm_config_user_agent; process.env.PATH = ${JSON.stringify(bin)};`),
            message
        );
        assert.deepEqual(await fixture.pkg(), pkg);
        assert.equal(await fixture.read('index.js'), 'export {};');
    });
}

for (const script of ['process.exit(42)', "console.log('invalid JSON')"]) {
    test(`public API propagates npm configuration failure: ${script}`, async t => {
        const pkg = { devDependencies: { example: '*' } };
        const fixture = await packageFixture(t, pkg, { 'npm-cli.js': script });
        await assert.rejects(
            runApi(fixture, { npmVersion: 12 }, `process.env.npm_execpath = ${JSON.stringify(path.join(fixture.cwd, 'npm-cli.js'))};`),
            script.includes('exit') ? /Command failed/ : /SyntaxError/
        );
        assert.deepEqual(await fixture.pkg(), pkg);
        assert.equal(await fixture.read('npm-cli.js'), script);
    });
}

test('comment stripping preserves malformed and unsupported sourcemaps', async t => {
    const maps = {
        'invalid.js.map': '{',
        'unsupported.js.map': '{"version":2,"mappings":""}',
        'missing.js.map': '{"version":3}',
        'null.js.map': 'null',
        'invalid.d.ts.map': '{',
        'unsupported.d.ts.map': '{"version":2,"mappings":""}',
        'missing.d.ts.map': '{"version":3,"mappings":""}',
    };
    const fixture = await packageFixture(
        t,
        {},
        {
            ...maps,
            ...Object.fromEntries(['invalid', 'unsupported', 'missing', 'null'].map(name => [`${name}.js`, '// remove\nexport {};\n'])),
        }
    );
    await fixture.run('--strip-comments');
    for (const [file, content] of Object.entries(maps)) assert.equal(await fixture.read(file), content);
    for (const name of ['invalid', 'unsupported', 'missing', 'null']) assert.equal(await fixture.read(`${name}.js`), 'export {};\n');
});

test('comment stripping discards sourcemap positions outside the original source', async t => {
    const fixture = await packageFixture(
        t,
        {},
        {
            'index.js': '// remove\nx();\n',
            'index.js.map': JSON.stringify({
                version: 3,
                sources: ['source.ts'],
                names: [],
                mappings: encode([[[0], [100]], [[-1], [0], [100]], [[100]], [[0]]]),
            }),
        }
    );
    await fixture.run('--strip-comments');
    assert.equal(await fixture.read('index.js'), 'x();\n');
    assert.deepEqual(decode(JSON.parse(await fixture.read('index.js.map')).mappings), [[[0]]]);
});

for (const [name, source, expected] of [
    ['unmatched closing brace', '}/* remove */', '}'],
    ['zero at end of file', '// remove\n0', '0'],
    ['unterminated string', "'unfinished\n// remove\nx();", "'unfinished\n\nx();"],
    ['unterminated regex', '/unfinished\n// remove\nx();', '/unfinished\n\nx();'],
    ['unterminated regex class', '/[unfinished\n// remove\nx();', '/[unfinished\n\nx();'],
    ['unterminated template', '// remove\n`unfinished', '`unfinished'],
    ['trailing comment', 'x();/* remove */', 'x();'],
]) {
    test(`CLI strips comments around scanner edge cases: ${name}`, async t => {
        const fixture = await packageFixture(t, {}, { 'index.js': source });
        await fixture.run('--strip-comments');
        assert.equal(await fixture.read('index.js'), expected);
    });
}

test('source mapping removal handles a directive at the start of a file', async t => {
    const fixture = await packageFixture(t, {}, { 'index.js': '/*# sourceMappingURL=index.js.map */x();' });
    await fixture.run('--remove-sourcemaps');
    assert.equal(await fixture.read('index.js'), 'x();');
});

for (const [dirs, files, message] of [
    ['dist', { 'dist/index.js': 'original', 'index.js': 'existing' }, /files already exist/],
    ['dist,lib', { 'dist/a/b.js': 'first', 'lib/a': 'second' }, /both a file and a directory/],
    ['block/child', { block: 'file' }, /ENOTDIR/],
]) {
    test(`flatten rejects ${dirs}: ${message}`, async t => {
        const fixture = await packageFixture(t, {}, files);
        await assert.rejects(fixture.run(`--flatten=${dirs}`), error => message.test(error.stdout));
        for (const [file, content] of Object.entries(files)) assert.equal(await fixture.read(file), content);
    });
}

test('flatten propagates filesystem access errors for destinations', async t => {
    const fixture = await packageFixture(t, {}, { 'dist/index.js': 'original' });
    await symlink('index.js', path.join(fixture.cwd, 'index.js'));
    await assert.rejects(fixture.run('--flatten=dist', '--no-cleanup-files'), error => /ELOOP/.test(error.stdout));
    assert.equal(await fixture.read('dist/index.js'), 'original');
});

for (const dir of ['.', '../outside', 'missing', 'plain-file', 'linked']) {
    test(`directories.bin ignores unsafe or absent directories: ${dir}`, async t => {
        const fixture = await packageFixture(t, { directories: { bin: dir } }, { 'plain-file': 'keep', 'tools/cli.js': 'keep' });
        await symlink('tools', path.join(fixture.cwd, 'linked'));
        await fixture.run('--npm-version=11');
        assert.equal(await fixture.read('plain-file'), 'keep');
        assert.equal(await fixture.read('tools/cli.js'), 'keep');
        assert.equal((await fixture.pkg()).bin, undefined);
    });
}

test('npm 12 reports an unrepresentable whitelist after flattening with global ignores', async t => {
    const fixture = await packageFixture(
        t,
        { files: ['dist'] },
        { 'dist/[name].js': 'export {};', 'node_modules/global-ignore': '[[]name].js\n' }
    );
    await assert.rejects(
        runApi(
            fixture,
            { npmVersion: 12, flatten: ['dist'] },
            `process.env.npm_config_global_ignore_file = ${JSON.stringify(path.join(fixture.cwd, 'node_modules/global-ignore'))};`
        ),
        /npm 12 cannot preserve the selected filenames with a files whitelist/
    );
    assert.equal(await fixture.read('[name].js'), 'export {};');
});
