import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';

const files = (await readdir('./tests')).filter(file => file.endsWith('.test.js')).sort();
for (const version of [11, 12]) {
    console.log(`Testing npm ${version} publish rules on ${process.version}`);
    // Golden filesystem snapshots describe the legacy publish contract.
    const selected = version === 11 ? files : files.filter(file => file !== 'prune.test.js');
    const result = spawnSync(process.execPath, ['--env-file=ci.env', '--test', ...selected.map(file => `./tests/${file}`)], {
        stdio: 'inherit',
        env: { ...process.env, PKGPRN_TEST_NPM: String(version), npm_config_user_agent: `npm/${version}.0.0 node/${process.version}` },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exitCode = 1;
}
