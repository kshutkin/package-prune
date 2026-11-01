import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../src/index.js', import.meta.url));
const npmVersion = process.env.PKGPRN_TEST_NPM === '12' ? 12 : 11;
const npmCli = fileURLToPath(new URL('bin/npm-cli.js', import.meta.resolve(`${npmVersion === 12 ? 'npm-v12' : 'npm'}/package.json`)));
const baseEnv = { ...process.env, npm_execpath: npmCli, npm_config_user_agent: `npm/${npmVersion}.0.0 node/${process.version}` };

export async function packageFixture(t, pkg, files, extraEnv = {}) {
    const env = { ...baseEnv, ...extraEnv };
    const cwd = await mkdtemp(path.join(tmpdir(), 'pkgprn-test-'));
    t.after(() => rm(cwd, { recursive: true, force: true }));
    for (const [file, content] of Object.entries({ ...files, 'package.json': JSON.stringify(pkg) })) {
        await mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
        await writeFile(path.join(cwd, file), content);
    }
    return {
        cwd,
        npmVersion,
        read: file => readFile(path.join(cwd, file), 'utf8'),
        pkg: async () => JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8')),
        pack: async () => {
            const { stdout } = await exec(process.execPath, [npmCli, 'pack', '--dry-run', '--ignore-scripts', '--json'], { cwd, env });
            return Object.values(JSON.parse(stdout))[0]
                .files.map(file => file.path)
                .sort();
        },
        node: (...args) => exec(process.execPath, args, { cwd, env }),
        run: (...args) => exec(process.execPath, [cli, ...args], { cwd, env }),
    };
}
