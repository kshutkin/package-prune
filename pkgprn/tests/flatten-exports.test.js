import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../src/index.js', import.meta.url));

const cases = [
    {
        name: 'CSS string subpath export',
        exports: { './theme.css': './dist/theme.css' },
        expected: { './theme.css': './theme.css' },
    },
    {
        name: 'JavaScript string subpath export',
        exports: { '.': './dist/index.js' },
        expected: { '.': './index.js' },
    },
    {
        name: 'root string export',
        exports: './dist/index.js',
        expected: './index.js',
    },
    {
        name: 'mixed string, conditional, and fallback exports',
        exports: { '.': { node: [null, { import: './dist/index.js' }] }, './theme.css': './dist/theme.css' },
        expected: { '.': { node: [null, { import: './index.js' }] }, './theme.css': './theme.css' },
    },
];

for (const fixture of cases) {
    test(`automatically flattens ${fixture.name}`, async t => {
        const cwd = await mkdtemp(path.join(tmpdir(), 'pkgprn-exports-'));
        t.after(() => rm(cwd, { recursive: true, force: true }));
        await mkdir(path.join(cwd, 'dist'));
        await writeFile(path.join(cwd, 'dist/index.js'), 'export default 42;\n');
        await writeFile(path.join(cwd, 'dist/theme.css'), ':root { color: red; }\n');
        await writeFile(path.join(cwd, 'package.json'), JSON.stringify({ exports: fixture.exports, files: ['dist'] }));

        await exec(process.execPath, [cli, '--flatten'], { cwd });

        const pkg = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'));
        assert.deepEqual(pkg.exports, fixture.expected);
        assert.equal(await readFile(path.join(cwd, 'index.js'), 'utf8'), 'export default 42;\n');
        assert.equal(await readFile(path.join(cwd, 'theme.css'), 'utf8'), ':root { color: red; }\n');
        assert.deepEqual((await readdir(cwd)).sort(), ['index.js', 'package.json', 'theme.css']);
    });
}
