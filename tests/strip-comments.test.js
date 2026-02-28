import assert from 'node:assert';
import { describe, test } from 'node:test';

import { isStrippableFile, parseCommentTypes, scanComments, stripComments } from '../strip-comments.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * @param {import('../strip-comments.js').CommentRange[]} comments
 * @param {string} source
 */
function commentTexts(comments, source) {
    return comments.map(c => source.slice(c.start, c.end));
}

/**
 * @param {import('../strip-comments.js').CommentRange[]} comments
 */
function commentTypes(comments) {
    return comments.map(c => c.type);
}

// ---------------------------------------------------------------------------
// parseCommentTypes
// ---------------------------------------------------------------------------

describe('parseCommentTypes', () => {
    test('true returns all types', () => {
        const s = parseCommentTypes(true);
        assert.deepStrictEqual([...s].sort(), ['jsdoc', 'license', 'regular']);
    });

    test('"all" returns all types', () => {
        const s = parseCommentTypes('all');
        assert.deepStrictEqual([...s].sort(), ['jsdoc', 'license', 'regular']);
    });

    test('single type', () => {
        assert.deepStrictEqual([...parseCommentTypes('jsdoc')], ['jsdoc']);
        assert.deepStrictEqual([...parseCommentTypes('license')], ['license']);
        assert.deepStrictEqual([...parseCommentTypes('regular')], ['regular']);
    });

    test('comma-separated types', () => {
        const s = parseCommentTypes('jsdoc,regular');
        assert.deepStrictEqual([...s].sort(), ['jsdoc', 'regular']);
    });

    test('comma-separated with spaces', () => {
        const s = parseCommentTypes('jsdoc , license');
        assert.deepStrictEqual([...s].sort(), ['jsdoc', 'license']);
    });

    test('"all" in comma list returns everything', () => {
        const s = parseCommentTypes('jsdoc,all');
        assert.deepStrictEqual([...s].sort(), ['jsdoc', 'license', 'regular']);
    });

    test('unknown type throws', () => {
        assert.throws(() => parseCommentTypes('unknown'), /unknown comment type/);
    });

    test('empty string falls back to all', () => {
        const s = parseCommentTypes('');
        assert.deepStrictEqual([...s].sort(), ['jsdoc', 'license', 'regular']);
    });
});

// ---------------------------------------------------------------------------
// isStrippableFile
// ---------------------------------------------------------------------------

describe('isStrippableFile', () => {
    test('returns true for JS extensions', () => {
        for (const ext of ['.js', '.mjs', '.cjs']) {
            assert.strictEqual(isStrippableFile(`foo${ext}`), true, ext);
        }
    });

    test('returns false for non-JS files', () => {
        for (const name of ['foo.json', 'foo.css', 'foo.html', 'foo.map', 'foo.md', 'foo', 'foo.ts', 'foo.mts', 'foo.cts', 'index.d.ts']) {
            assert.strictEqual(isStrippableFile(name), false, name);
        }
    });
});

// ---------------------------------------------------------------------------
// scanComments — basic comment detection
// ---------------------------------------------------------------------------

describe('scanComments', () => {
    test('single-line comment', () => {
        const src = 'const a = 1; // hello\nconst b = 2;';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(commentTexts(comments, src), ['// hello']);
        assert.deepStrictEqual(commentTypes(comments), ['regular']);
    });

    test('multiple single-line comments', () => {
        const src = '// first\nconst a = 1;\n// second';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 2);
        assert.deepStrictEqual(commentTexts(comments, src), ['// first', '// second']);
    });

    test('block comment', () => {
        const src = 'const a = /* inline */ 1;';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(commentTexts(comments, src), ['/* inline */']);
        assert.deepStrictEqual(commentTypes(comments), ['regular']);
    });

    test('multi-line block comment', () => {
        const src = '/*\n * line 1\n * line 2\n */\nconst a = 1;';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(commentTexts(comments, src), ['/*\n * line 1\n * line 2\n */']);
    });

    test('empty block comment /**/', () => {
        const src = 'a /**/  b';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(commentTypes(comments), ['regular']);
    });

    test('no comments', () => {
        const src = 'const a = 1;\nconst b = 2;\n';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('empty source', () => {
        assert.strictEqual(scanComments('').length, 0);
    });
});

// ---------------------------------------------------------------------------
// scanComments — classification
// ---------------------------------------------------------------------------

describe('scanComments — classification', () => {
    test('JSDoc comment (/** … */)', () => {
        const src = '/** @param {string} x */\nfunction f(x) {}';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.strictEqual(comments[0].type, 'jsdoc');
    });

    test('multi-line JSDoc', () => {
        const src = '/**\n * Does stuff.\n * @returns {void}\n */\nfunction f() {}';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.strictEqual(comments[0].type, 'jsdoc');
    });

    test('license comment with /*!', () => {
        const src = '/*! MIT License */\nconst a = 1;';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.strictEqual(comments[0].type, 'license');
    });

    test('license comment with @license', () => {
        const src = '/* @license MIT */\nconst a = 1;';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.strictEqual(comments[0].type, 'license');
    });

    test('license comment with @preserve', () => {
        const src = '/* @preserve */\nconst a = 1;';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.strictEqual(comments[0].type, 'license');
    });

    test('JSDoc with @license is classified as license (license takes priority)', () => {
        const src = '/** @license MIT */\nfunction f() {}';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.strictEqual(comments[0].type, 'license');
    });

    test('regular block comment (/* … */)', () => {
        const src = '/* just a comment */\nconst a = 1;';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.strictEqual(comments[0].type, 'regular');
    });

    test('single-line comments are always regular', () => {
        const src = '// @license MIT\nconst a = 1;';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.strictEqual(comments[0].type, 'regular');
    });

    test('mixed comment types', () => {
        const src = ['/*! license */', '/** @param x */', '/* regular */', '// line comment'].join('\n');
        const comments = scanComments(src);
        assert.deepStrictEqual(commentTypes(comments), ['license', 'jsdoc', 'regular', 'regular']);
    });
});

// ---------------------------------------------------------------------------
// scanComments — strings (must not detect comments inside strings)
// ---------------------------------------------------------------------------

describe('scanComments — strings', () => {
    test('single-quoted string containing //', () => {
        const src = "const a = '// not a comment';";
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('single-quoted string containing /* */', () => {
        const src = "const a = '/* not a comment */';";
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('double-quoted string containing //', () => {
        const src = 'const a = "// not a comment";';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('double-quoted string containing /* */', () => {
        const src = 'const a = "/* not a comment */";';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('string with escaped quote before comment-like content', () => {
        const src = "const a = 'it\\'s /* here */';";
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('double-quoted string with escaped quote', () => {
        const src = 'const a = "say \\"hello\\" /* nope */";';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('real comment after a string', () => {
        const src = "const a = 'hello'; // real comment";
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(commentTexts(comments, src), ['// real comment']);
    });

    test('empty strings followed by comment', () => {
        const src = '\'\' + "" /* comment */';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(commentTexts(comments, src), ['/* comment */']);
    });
});

// ---------------------------------------------------------------------------
// scanComments — template literals
// ---------------------------------------------------------------------------

describe('scanComments — template literals', () => {
    test('template literal containing //', () => {
        const src = 'const a = `// not a comment`;';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('template literal containing /* */', () => {
        const src = 'const a = `/* not a comment */`;';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('template literal with escaped backtick', () => {
        const src = 'const a = `hello \\` /* not a comment */`;';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('template expression with comment inside', () => {
        const src = 'const a = `${/* real comment */ x}`;';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(commentTexts(comments, src), ['/* real comment */']);
    });

    test('template expression with single-line comment is actually code (no newline in expr)', () => {
        // `${ value // comment \n }` — the // captures to end of line,
        // then } closes the expression on the next line.
        const src = '`${ value // comment\n}`';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(commentTexts(comments, src), ['// comment']);
    });

    test('nested template literals', () => {
        const src = '`outer ${`inner /* not comment */`} rest /* also not */`';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('deeply nested template literals with comment', () => {
        const src = '`a ${`b ${/* comment */ c}`}`';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(commentTexts(comments, src), ['/* comment */']);
    });

    test('template expression with braces (object literal)', () => {
        const src = '`${{ a: 1 /* not outside */ }.a}` /* outside */';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 2);
        assert.deepStrictEqual(commentTexts(comments, src), ['/* not outside */', '/* outside */']);
    });

    test('template expression with nested braces in arrow function', () => {
        const src = '`${(() => { return 1; /* inside expr */ })()}` /* after */';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 2);
        assert.deepStrictEqual(commentTexts(comments, src), ['/* inside expr */', '/* after */']);
    });

    test('template literal after comment', () => {
        const src = '/* comment */ `template`';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(commentTexts(comments, src), ['/* comment */']);
    });

    test('string inside template expression', () => {
        const src = '`${" /* not a comment */ "}` /* real */';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(commentTexts(comments, src), ['/* real */']);
    });
});

// ---------------------------------------------------------------------------
// scanComments — regular expressions
// ---------------------------------------------------------------------------

describe('scanComments — regular expressions', () => {
    test('regex literal is not a comment', () => {
        const src = 'const re = /foo/;';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex with flags', () => {
        const src = 'const re = /foo/gi;';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex containing // is not a comment', () => {
        const src = 'const re = /https:\\/\\//;';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex containing /* is not a comment', () => {
        const src = 'const re = /\\/\\*/;';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex with character class containing /', () => {
        const src = 'const re = /[/]/;';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex with character class containing ] after backslash', () => {
        const src = 'const re = /[\\]]/;';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex followed by real comment', () => {
        const src = 'const re = /foo/g; // comment';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(commentTexts(comments, src), ['// comment']);
    });

    test('regex in return statement', () => {
        const src = 'function f() { return /foo/; }';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex after = operator', () => {
        const src = 'let re = /foo/;';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex after ( in function call', () => {
        const src = 'str.match(/pattern/g)';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex after , in array', () => {
        const src = 'const arr = [1, /foo/];';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex after !', () => {
        const src = 'if (!/pattern/.test(s)) {}';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex after typeof', () => {
        const src = 'typeof /foo/';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex after case', () => {
        const src = 'switch(x) { case /foo/: break; }';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex after yield', () => {
        const src = 'function* g() { yield /foo/; }';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex after await', () => {
        const src = 'async function f() { await /foo/; }';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('division operator is not regex', () => {
        const src = 'const x = a / b; // comment';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(commentTexts(comments, src), ['// comment']);
    });

    test('division after closing paren', () => {
        const src = '(a + b) / c / d; // comment';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(commentTexts(comments, src), ['// comment']);
    });

    test('division after closing bracket', () => {
        const src = 'arr[0] / 2; // comment';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(commentTexts(comments, src), ['// comment']);
    });

    test('division after number literal', () => {
        const src = '10 / 2 / 5; // comment';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(commentTexts(comments, src), ['// comment']);
    });

    test('division after identifier', () => {
        const src = 'x / y; // comment';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
    });

    test('postfix ++ followed by division', () => {
        const src = 'i++ / 2; // comment';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
    });

    test('postfix -- followed by division', () => {
        const src = 'i-- / 2; // comment';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
    });

    test('regex after else keyword', () => {
        const src = 'if (x) {} else /foo/;';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex after opening brace', () => {
        const src = '{ /foo/ }';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex after semicolon', () => {
        const src = '; /foo/;';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex after colon', () => {
        const src = 'x ? /a/ : /b/;';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex after &&', () => {
        const src = 'x && /foo/.test(y);';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex after ||', () => {
        const src = 'x || /foo/.test(y);';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex with character class containing * and /', () => {
        const src = 'const re = /[*/]/;';
        assert.strictEqual(scanComments(src).length, 0);
    });
});

// ---------------------------------------------------------------------------
// scanComments — hashbang
// ---------------------------------------------------------------------------

describe('scanComments — hashbang', () => {
    test('hashbang line is not a comment', () => {
        const src = '#!/usr/bin/env node\nconst a = 1;';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('hashbang followed by comment', () => {
        const src = '#!/usr/bin/env node\n// real comment\nconst a = 1;';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(commentTexts(comments, src), ['// real comment']);
    });

    test('# not at start is not hashbang (would be syntax error but we handle it)', () => {
        const src = 'const a = 1;\n#!/usr/bin/env node';
        // The #! in the middle is not a hashbang and not a comment
        assert.strictEqual(scanComments(src).length, 0);
    });
});

// ---------------------------------------------------------------------------
// scanComments — complex / edge cases
// ---------------------------------------------------------------------------

describe('scanComments — edge cases', () => {
    test('comment immediately after string with no space', () => {
        const src = '"hello"/* comment */';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(commentTexts(comments, src), ['/* comment */']);
    });

    test('adjacent comments', () => {
        const src = '/* a *//* b *//** c */';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 3);
        assert.deepStrictEqual(commentTexts(comments, src), ['/* a */', '/* b */', '/** c */']);
        assert.deepStrictEqual(commentTypes(comments), ['regular', 'regular', 'jsdoc']);
    });

    test('comment inside regex character class (not a real comment)', () => {
        const src = 'const re = /[/*]/;';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('line ending in regex followed by comment on next line', () => {
        const src = 'x = /pattern/g\n// comment';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(commentTexts(comments, src), ['// comment']);
    });

    test('division that looks like it could start a regex (a / b / c)', () => {
        // a / b / c is division, not regex
        const src = 'a / b / c';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('unterminated block comment consumes to end', () => {
        const src = 'const a = 1; /* unterminated';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        // The comment extends to the end of the source
        assert.strictEqual(comments[0].start, 13);
        assert.strictEqual(comments[0].end, src.length);
    });

    test('multiple template expressions with comments between', () => {
        const src = '`${a}` /* c1 */ + `${b}` /* c2 */';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 2);
        assert.deepStrictEqual(commentTexts(comments, src), ['/* c1 */', '/* c2 */']);
    });

    test('regex after import keyword', () => {
        // import is in regexPrecedingKeywords
        // This is contrived but tests the keyword tracking
        const src = 'var import_ = 1; // comment';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
    });

    test('string with backslash at end', () => {
        const src = "'test\\\\' // comment";
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(commentTexts(comments, src), ['// comment']);
    });

    test('block comment containing stars', () => {
        const src = '/*** star heavy ***/';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.strictEqual(comments[0].type, 'jsdoc');
    });

    test('block comment with just stars /****/', () => {
        const src = '/****/';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        // starts with /** and length > 4, so jsdoc
        assert.strictEqual(comments[0].type, 'jsdoc');
    });

    test('the degenerate /**/ is classified as regular', () => {
        const src = '/**/';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        // /**/ has length 4, and while it starts with /**, it is excluded by the > 4 check
        assert.strictEqual(comments[0].type, 'regular');
    });

    test('new keyword followed by regex', () => {
        const src = 'new /foo/';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('void keyword followed by regex', () => {
        const src = 'void /foo/';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('delete keyword followed by regex', () => {
        const src = 'delete /foo/';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('throw keyword followed by regex', () => {
        const src = 'throw /foo/';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('instanceof keyword followed by division (not regex)', () => {
        // instanceof is in regexPrecedingKeywords, but it would be unusual
        // to have a regex after instanceof — we still treat / as regex start
        // which is safe (we just skip more chars)
        const src = 'x instanceof /foo/';
        assert.strictEqual(scanComments(src).length, 0);
    });
});

// ---------------------------------------------------------------------------
// stripComments — basic stripping
// ---------------------------------------------------------------------------

describe('stripComments', () => {
    test('strip all comments', () => {
        const src = '/** jsdoc */\n/* regular */\n// line\nconst a = 1;\n';
        const all = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['jsdoc', 'license', 'regular']));
        const result = stripComments(src, all);
        assert.strictEqual(result, 'const a = 1;\n');
    });

    test('strip only jsdoc', () => {
        const src = '/** jsdoc */\n/* regular */\nconst a = 1;\n';
        const types = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['jsdoc']));
        const result = stripComments(src, types);
        assert.ok(result.includes('/* regular */'));
        assert.ok(!result.includes('/** jsdoc */'));
        assert.ok(result.includes('const a = 1;'));
    });

    test('strip only license', () => {
        const src = '/*! license */\n/** jsdoc */\nconst a = 1;\n';
        const types = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['license']));
        const result = stripComments(src, types);
        assert.ok(!result.includes('/*! license */'));
        assert.ok(result.includes('/** jsdoc */'));
        assert.ok(result.includes('const a = 1;'));
    });

    test('strip only regular', () => {
        const src = '/** jsdoc */\n/* regular */\n// line\nconst a = 1;\n';
        const types = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['regular']));
        const result = stripComments(src, types);
        assert.ok(result.includes('/** jsdoc */'));
        assert.ok(!result.includes('/* regular */'));
        assert.ok(!result.includes('// line'));
        assert.ok(result.includes('const a = 1;'));
    });

    test('strip jsdoc and regular but keep license', () => {
        const src = '/*! license */\n/** jsdoc */\n/* regular */\n// line\nconst a = 1;\n';
        const types = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['jsdoc', 'regular']));
        const result = stripComments(src, types);
        assert.ok(result.includes('/*! license */'));
        assert.ok(!result.includes('/** jsdoc */'));
        assert.ok(!result.includes('/* regular */'));
        assert.ok(!result.includes('// line'));
        assert.ok(result.includes('const a = 1;'));
    });

    test('returns source unchanged when no comments match', () => {
        const src = 'const a = 1;\n';
        const types = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['jsdoc']));
        assert.strictEqual(stripComments(src, types), src);
    });

    test('returns source unchanged when no comments exist', () => {
        const src = 'const a = 1;\nconst b = 2;\n';
        const all = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['jsdoc', 'license', 'regular']));
        assert.strictEqual(stripComments(src, all), src);
    });

    test('inline comment removal does not break code', () => {
        const src = 'const x = /* type */ 1;\n';
        const types = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['regular']));
        const result = stripComments(src, types);
        assert.strictEqual(result, 'const x =  1;\n');
    });

    test('trailing single-line comment removal', () => {
        const src = 'const x = 1; // comment\n';
        const types = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['regular']));
        const result = stripComments(src, types);
        assert.strictEqual(result, 'const x = 1;\n');
    });
});

// ---------------------------------------------------------------------------
// stripComments — whitespace cleanup
// ---------------------------------------------------------------------------

describe('stripComments — whitespace cleanup', () => {
    test('collapses multiple blank lines left by removal', () => {
        const src = 'a();\n\n/**\n * jsdoc\n */\n\nb();\n';
        const types = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['jsdoc']));
        const result = stripComments(src, types);
        // Should have at most one blank line between a() and b()
        assert.ok(!result.includes('\n\n\n'), 'should not have 3+ consecutive newlines');
        assert.ok(result.includes('a();'));
        assert.ok(result.includes('b();'));
    });

    test('removes leading blank lines after stripping top comment', () => {
        const src = '/** module doc */\nconst a = 1;\n';
        const types = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['jsdoc']));
        const result = stripComments(src, types);
        assert.strictEqual(result, 'const a = 1;\n');
    });

    test('preserves hashbang and removes blank lines after it', () => {
        const src = '#!/usr/bin/env node\n/** jsdoc */\nconst a = 1;\n';
        const types = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['jsdoc']));
        const result = stripComments(src, types);
        assert.ok(result.startsWith('#!/usr/bin/env node\n'));
        assert.ok(result.includes('const a = 1;'));
        assert.ok(!result.includes('/** jsdoc */'));
    });

    test('preserves trailing newline if original had one', () => {
        const src = '/* comment */\nconst a = 1;\n';
        const types = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['regular']));
        const result = stripComments(src, types);
        assert.ok(result.endsWith('\n'));
        assert.ok(!result.endsWith('\n\n'));
    });

    test('whitespace-only lines from indented comments are cleaned up', () => {
        const src = '    /** jsdoc */\n    function f() {}\n';
        const types = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['jsdoc']));
        const result = stripComments(src, types);
        // The line that had only the jsdoc and indentation should be collapsed
        assert.ok(!result.includes('    \n'), 'should not have whitespace-only lines');
    });

    test('multiple consecutive jsdoc blocks collapse cleanly', () => {
        const src = '/**\n * A\n */\n/**\n * B\n */\nfunction f() {}\n';
        const types = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['jsdoc']));
        const result = stripComments(src, types);
        assert.strictEqual(result, 'function f() {}\n');
    });
});

// ---------------------------------------------------------------------------
// stripComments — does not corrupt non-comment content
// ---------------------------------------------------------------------------

describe('stripComments — content preservation', () => {
    test('strings with comment-like content are preserved', () => {
        const src = "const a = '/* not removed */';\n/** jsdoc */\nconst b = 1;\n";
        const types = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['jsdoc']));
        const result = stripComments(src, types);
        assert.ok(result.includes("'/* not removed */'"));
        assert.ok(!result.includes('/** jsdoc */'));
    });

    test('template literals with comment-like content are preserved', () => {
        const src = 'const a = `/* not removed */`;\n/** jsdoc */\nconst b = 1;\n';
        const types = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['jsdoc']));
        const result = stripComments(src, types);
        assert.ok(result.includes('`/* not removed */`'));
        assert.ok(!result.includes('/** jsdoc */'));
    });

    test('regex with comment-like content is preserved', () => {
        const src = 'const re = /\\/*\\//; /** jsdoc */\n';
        const types = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['jsdoc']));
        const result = stripComments(src, types);
        assert.ok(result.includes('/\\/*\\//'));
        assert.ok(!result.includes('/** jsdoc */'));
    });

    test('preserves code between comments', () => {
        const src = '/* a */\nconst x = 1;\n/* b */\nconst y = 2;\n/* c */\n';
        const types = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['regular']));
        const result = stripComments(src, types);
        assert.ok(result.includes('const x = 1;'));
        assert.ok(result.includes('const y = 2;'));
    });

    test('empty source stays empty', () => {
        const types = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['jsdoc', 'license', 'regular']));
        assert.strictEqual(stripComments('', types), '');
    });

    test('source with only a comment becomes empty (or single newline)', () => {
        const types = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['regular']));
        const result = stripComments('/* only comment */\n', types);
        assert.strictEqual(result.trim(), '');
    });
});

// ---------------------------------------------------------------------------
// stripComments — realistic code samples
// ---------------------------------------------------------------------------

describe('stripComments — realistic code', () => {
    test('typical module with mixed comments', () => {
        const src = [
            '#!/usr/bin/env node',
            '/*! MIT License */',
            '',
            '/**',
            ' * Does something useful.',
            ' * @param {string} name',
            ' * @returns {void}',
            ' */',
            'export function greet(name) {',
            '    // say hello',
            '    console.log(`Hello, ${name}!`); /* inline */',
            '}',
            '',
        ].join('\n');

        // Strip only jsdoc — keep license, line comments, inline comments
        const jsdocOnly = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['jsdoc']));
        const r1 = stripComments(src, jsdocOnly);
        assert.ok(r1.includes('/*! MIT License */'), 'license kept');
        assert.ok(r1.includes('// say hello'), 'line comment kept');
        assert.ok(r1.includes('/* inline */'), 'inline comment kept');
        assert.ok(!r1.includes('@param'), 'jsdoc removed');
        assert.ok(r1.includes('export function greet(name)'), 'code preserved');
        assert.ok(r1.includes('#!/usr/bin/env node'), 'hashbang preserved');
        assert.ok(r1.includes('`Hello, ${name}!`'), 'template literal preserved');

        // Strip all
        const all = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['jsdoc', 'license', 'regular']));
        const r2 = stripComments(src, all);
        assert.ok(!r2.includes('/*'), 'no block comments');
        assert.ok(!r2.includes('//'), 'no line comments (except hashbang)');
        assert.ok(r2.includes('#!/usr/bin/env node'), 'hashbang still preserved');
        assert.ok(r2.includes('export function greet(name)'), 'code preserved');
        assert.ok(r2.includes('console.log(`Hello, ${name}!`)'), 'code preserved');
    });

    test('code with division and regex mix', () => {
        const src = [
            '/** @module math */',
            'const ratio = width / height; // aspect ratio',
            'const pattern = /^\\d+$/;',
            'const result = (a + b) / (c - d);',
            '',
        ].join('\n');

        const types = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['jsdoc', 'regular']));
        const result = stripComments(src, types);
        assert.ok(!result.includes('/** @module math */'));
        assert.ok(!result.includes('// aspect ratio'));
        assert.ok(result.includes('const ratio = width / height;'));
        assert.ok(result.includes('const pattern = /^\\d+$/;'));
        assert.ok(result.includes('const result = (a + b) / (c - d);'));
    });

    test('declaration-like file with JSDoc on each member', () => {
        const src = [
            '/**',
            ' * Options for the widget.',
            ' */',
            'export interface WidgetOptions {',
            '    /** The widget name. */',
            '    name: string;',
            '    /** The widget size. */',
            '    size: number;',
            '}',
            '',
        ].join('\n');

        const types = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['jsdoc']));
        const result = stripComments(src, types);
        assert.ok(!result.includes('/**'));
        assert.ok(result.includes('name: string;'));
        assert.ok(result.includes('size: number;'));
        assert.ok(result.includes('export interface WidgetOptions'));
    });

    test('code with template literal containing complex expressions', () => {
        const src = [
            '/** doc */',
            'function render(items) {',
            '    return `<ul>${items.map(i => {',
            '        // map each item',
            '        return `<li>${i.name /* prop */}</li>`;',
            '    }).join("")}</ul>`;',
            '}',
            '',
        ].join('\n');

        const all = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['jsdoc', 'license', 'regular']));
        const result = stripComments(src, all);
        assert.ok(!result.includes('/** doc */'));
        assert.ok(!result.includes('// map each item'));
        assert.ok(!result.includes('/* prop */'));
        assert.ok(result.includes('function render(items)'));
        assert.ok(result.includes('items.map'));
        assert.ok(result.includes('.join("")'));
    });

    test('minified code with no whitespace around comments', () => {
        const src = 'var a=1;/* x */var b=2;/** y */var c=3;// z\nvar d=4;';
        const all = new Set(/** @type {import('../strip-comments.js').CommentType[]} */ (['jsdoc', 'license', 'regular']));
        const result = stripComments(src, all);
        assert.ok(result.includes('var a=1;'));
        assert.ok(result.includes('var b=2;'));
        assert.ok(result.includes('var c=3;'));
        assert.ok(result.includes('var d=4;'));
        assert.ok(!result.includes('/*'));
        assert.ok(!result.includes('//'));
    });
});

// ---------------------------------------------------------------------------
// stripComments — advanced regex / division disambiguation
// ---------------------------------------------------------------------------

describe('scanComments — advanced regex vs division', () => {
    test('regex after export default', () => {
        const src = 'export default /foo/gi;';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex after arrow =>', () => {
        const src = 'const f = () => /foo/;';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex after open paren', () => {
        const src = '(/foo/)';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex after open bracket', () => {
        const src = '[/foo/]';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex after comma', () => {
        const src = 'f(a, /foo/)';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex after ternary colon', () => {
        const src = 'x ? /a/ : /b/';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('regex after assignment operators', () => {
        for (const op of ['=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '^=', '|=', '&&=', '||=', '??=']) {
            const src = `x ${op} /foo/;`;
            assert.strictEqual(scanComments(src).length, 0, `regex after ${op}`);
        }
    });

    test('regex after comparison operators', () => {
        for (const op of ['==', '!=', '===', '!==', '<', '>', '<=', '>=']) {
            const src = `x ${op} /foo/;`;
            assert.strictEqual(scanComments(src).length, 0, `regex after ${op}`);
        }
    });

    test('regex after logical operators', () => {
        for (const op of ['&&', '||', '??']) {
            const src = `x ${op} /foo/;`;
            assert.strictEqual(scanComments(src).length, 0, `regex after ${op}`);
        }
    });

    test('regex after bitwise operators', () => {
        for (const op of ['&', '|', '^', '~']) {
            const src = `x ${op} /foo/;`;
            assert.strictEqual(scanComments(src).length, 0, `regex after ${op}`);
        }
    });

    test('regex after spread/rest', () => {
        const src = '[.../foo/]';
        assert.strictEqual(scanComments(src).length, 0);
    });

    test('this followed by division', () => {
        const src = 'this / 2; // comment';
        const comments = scanComments(src);
        // this is an identifier, so exprEnd = true, / is division
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(commentTexts(comments, src), ['// comment']);
    });

    test('true followed by division', () => {
        const src = 'true / 2; // comment';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
    });

    test('null followed by division', () => {
        const src = 'null / 2; // comment';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
    });

    test('closing brace followed by division (conservative: treated as regex context)', () => {
        // {} / x — we treat } as not-expression-end, so / is regex.
        // This is the conservative choice: for comment detection it is safe
        // because we just skip over the "regex" body.
        const src = '{} /x/';
        // Should NOT find any comments — the /x/ is either regex or division, not a comment
        assert.strictEqual(scanComments(src).length, 0);
    });
});

// ---------------------------------------------------------------------------
// Unicode and special characters
// ---------------------------------------------------------------------------

describe('scanComments — unicode', () => {
    test('unicode identifier before division', () => {
        const src = 'const café = 1; café / 2; // comment';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(commentTexts(comments, src), ['// comment']);
    });

    test('unicode in comment content', () => {
        const src = '/** ñ → ∑ 你好 */\nconst a = 1;';
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.strictEqual(comments[0].type, 'jsdoc');
    });

    test('unicode in string does not affect comment detection', () => {
        const src = "'café /* not comment */' /* real */";
        const comments = scanComments(src);
        assert.strictEqual(comments.length, 1);
        assert.deepStrictEqual(commentTexts(comments, src), ['/* real */']);
    });
});
