import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../src/index.js', import.meta.url));

export async function packageFixture(t, pkg, files) {
    const cwd = await mkdtemp(path.join(tmpdir(), 'pkgprn-test-'));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    for (const [file, content] of Object.entries({ ...files, 'package.json': JSON.stringify(pkg) })) {
        await mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
        await writeFile(path.join(cwd, file), content);
    }
    return {
        cwd,
        read: file => readFile(path.join(cwd, file), 'utf8'),
        pkg: async () => JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8')),
        run: (...args) => exec(process.execPath, [cli, ...args], { cwd }),
    };
}
