import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { stripComments } from '../src/strip-comments.js';

const regular = new Set(['regular']);

for (const source of [
    'const/*comment*/value = 1; value;',
    'let a = 1, b = 2; a +/*comment*/+b;',
    'function f(){return /*\ncomment\n*/ 42;} f();',
    'function f(){return /*\u2028comment*/ 42;} f();',
]) {
    test(`comment removal preserves execution: ${JSON.stringify(source)}`, () => {
        assert.equal(vm.runInNewContext(stripComments(source, regular)), vm.runInNewContext(source));
    });
}
