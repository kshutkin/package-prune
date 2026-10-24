import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { removeSourceMappingComments } from '../src/sourcemap-comments.js';
import { packageFixture } from './package-fixture.js';

const directive = '/*# sourceMappingURL=debug.map */';
const cases = [
    `function f(){return${directive}1;} f();`,
    `let${directive}value=1; value;`,
    `let value=1; value+${directive}+2;`,
    `let value=1; value-${directive}-2;`,
    `let${directive}a=1; let${directive}b=2; a+b;`,
    'const a=1;\n//# sourceMappingURL=debug.map\nconst b=2; a+b;',
];

for (const newline of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
    cases.push(
        `function f(){return${newline}${directive}1;} f();`,
        `function f(){return/*# sourceMappingURL=debug.map${newline}*/1;} f();`,
        `function* f(){yield/*# sourceMappingURL=debug.map${newline}*/1;} f().next().value;`
    );
}

for (const source of cases) {
    test(`sourcemap removal preserves JavaScript semantics: ${JSON.stringify(source)}`, () => {
        const result = removeSourceMappingComments(source, 'index.js');
        assert.equal(vm.runInNewContext(result), vm.runInNewContext(source));
        assert.ok(!result.includes('sourceMappingURL=debug.map'));
    });
}

for (const [source, expected] of [
    [`a ${directive}.b{color:red}`, 'a .b{color:red}'],
    [`a\n${directive}.b{color:red}`, 'a\n.b{color:red}'],
    [`a${directive}.b{color:red}`, 'a.b{color:red}'],
    ['a/*# sourceMappingURL=debug.map\n*/.b{color:red}', 'a.b{color:red}'],
]) {
    test(`sourcemap removal preserves CSS selector spacing: ${JSON.stringify(source)}`, () => {
        assert.equal(removeSourceMappingComments(source, 'theme.css'), expected);
    });
}

test('CLI sourcemap removal preserves return line breaks while deleting maps', async t => {
    const fixture = await packageFixture(
        t,
        {},
        {
            'index.js': `function f(){return\n${directive}1;} console.log(f());`,
            'debug.map': '{}',
        }
    );
    await fixture.run('--remove-sourcemaps');
    assert.equal((await fixture.node('index.js')).stdout.trim(), 'undefined');
    await assert.rejects(fixture.read('debug.map'), { code: 'ENOENT' });
});
