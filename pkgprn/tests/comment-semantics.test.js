/* biome-ignore-all lint/suspicious/noTemplateCurlyInString: fixtures contain JavaScript template expressions */
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

for (const source of [
    'const s = `a\n\n\nb`; // comment\ns;',
    'const s = `a  \nb\t\n`; // comment\ns;',
    'const s = `outer ${`inner\n\n\n${1 /* comment */}`} end`; s;',
    "const s = 'a  \\\n  b'; // comment\ns;",
]) {
    test(`literal whitespace survives comment stripping: ${JSON.stringify(source)}`, () => {
        assert.equal(vm.runInNewContext(stripComments(source, regular)), vm.runInNewContext(source));
    });
}
