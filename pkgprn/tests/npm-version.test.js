import assert from 'node:assert/strict';
import test from 'node:test';

import { packageFixture } from './package-fixture.js';

for (const version of [11, 12]) {
    test(`explicit npm ${version} overrides the detected publish rules`, async t => {
        const fixture = await packageFixture(t, { name: 'fixture', version: '1.0.0', files: ['./'] }, { 'index.js': 'export {};' });
        await fixture.run(`--npm-version=${version}`);
        if (version === 11) assert.equal(await fixture.read('index.js'), 'export {};');
        else await assert.rejects(fixture.read('index.js'), { code: 'ENOENT' });
    });
}

test('invalid npm version leaves metadata and files unchanged', async t => {
    const pkg = { name: 'fixture', version: '1.0.0', files: ['./'], devDependencies: { example: '*' } };
    const fixture = await packageFixture(t, pkg, { 'index.js': 'export {};' });
    await assert.rejects(fixture.run('--npm-version=invalid'), error => {
        assert.match(error.stdout, /npm-version must be 11 or 12/);
        return true;
    });
    assert.deepEqual(await fixture.pkg(), pkg);
    assert.equal(await fixture.read('index.js'), 'export {};');
});

test('API npmVersion selects npm 12 rules without relying on the invoking package manager', async t => {
    const fixture = await packageFixture(t, { name: 'fixture', version: '1.0.0', files: ['./'] }, { 'private.txt': 'private' });
    await fixture.node(
        '--input-type=module',
        '-e',
        `import { readFile, writeFile } from 'node:fs/promises';
        import { prunePkg } from ${JSON.stringify(new URL('../src/prune.js', import.meta.url).href)};
        const pkg = JSON.parse(await readFile('package.json', 'utf8'));
        process.env.npm_config_user_agent = 'npm/11.20.0';
        await prunePkg(pkg, {
            profile: 'library', flatten: false, stripComments: false, removeSourcemaps: false,
            cleanupFiles: true, optimizeFiles: true, npmVersion: 12,
        }, Object.assign(() => {}, { update() {} }));
        await writeFile('package.json', JSON.stringify(pkg));`
    );
    await assert.rejects(fixture.read('private.txt'), { code: 'ENOENT' });
    assert.equal((await fixture.pkg()).files, undefined);
});
