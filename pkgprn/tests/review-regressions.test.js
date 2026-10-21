import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { packageFixture } from './package-fixture.js';

for (const operation of ['cleanup', 'comments', 'maps', 'flatten']) {
    test(`${operation} leaves external symlink targets untouched`, async t => {
        const external = await mkdtemp(path.join(tmpdir(), 'pkgprn-external-'));
        t.after(() => rm(external, { recursive: true, force: true }));
        const source = '// preserve\nconst x = 1;\n';
        await writeFile(path.join(external, 'source.js'), source);
        await writeFile(path.join(external, 'private.js'), 'private');
        const fixture = await packageFixture(t, operation === 'cleanup' ? { files: ['linked/source.js'] } : {}, {
            'linked.js.map': '{}',
        });
        await symlink(external, path.join(fixture.cwd, 'linked'));
        await symlink(path.join(external, 'source.js'), path.join(fixture.cwd, 'linked.js'));
        if (operation === 'flatten') {
            await assert.rejects(fixture.run('--flatten=linked'));
        } else {
            await fixture.run(...(operation === 'comments' ? ['--strip-comments'] : operation === 'maps' ? ['--remove-sourcemaps'] : []));
        }
        assert.equal(await readFile(path.join(external, 'source.js'), 'utf8'), source);
        assert.equal(await readFile(path.join(external, 'private.js'), 'utf8'), 'private');
    });
}
