import assert from 'node:assert';
import { describe, test } from 'node:test';

import {
    adjustSourcemapLineMappings,
    isStrippableFile,
    parseCommentTypes,
    scanComments,
    stripComments,
    stripCommentsWithLineMap,
} from '../strip-comments.js';

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

// ===========================================================================
// stripCommentsWithLineMap
// ===========================================================================

describe('stripCommentsWithLineMap', () => {
    test('returns null lineMap when no comments exist', () => {
        const src = 'const a = 1;\nconst b = 2;\n';
        const all = new Set(/** @type {const} */ (['jsdoc', 'license', 'regular']));
        const { result, lineMap } = stripCommentsWithLineMap(src, all);
        assert.strictEqual(result, src);
        assert.strictEqual(lineMap, null);
    });

    test('returns null lineMap when no matching comments', () => {
        const src = '/** jsdoc */\nconst a = 1;\n';
        const types = new Set(/** @type {const} */ (['regular']));
        const { result, lineMap } = stripCommentsWithLineMap(src, types);
        assert.strictEqual(result, src);
        assert.strictEqual(lineMap, null);
    });

    test('result matches stripComments output', () => {
        const src = '/** jsdoc */\nconst a = 1;\n// regular\nconst b = 2;\n';
        const all = new Set(/** @type {const} */ (['jsdoc', 'license', 'regular']));
        const { result } = stripCommentsWithLineMap(src, all);
        assert.strictEqual(result, stripComments(src, all));
    });

    test('single-line comment removed — lines shift up', () => {
        const src = '// comment\nconst a = 1;\nconst b = 2;\n';
        const all = new Set(/** @type {const} */ (['jsdoc', 'license', 'regular']));
        const { result, lineMap } = stripCommentsWithLineMap(src, all);
        assert.strictEqual(result, 'const a = 1;\nconst b = 2;\n');
        assert.notStrictEqual(lineMap, null);
        if (lineMap === null) throw new Error('unreachable');
        // Line 0 was the comment — removed
        assert.strictEqual(lineMap[0], -1);
        // Line 1 "const a = 1;" → now line 0
        assert.strictEqual(lineMap[1], 0);
        // Line 2 "const b = 2;" → now line 1
        assert.strictEqual(lineMap[2], 1);
    });

    test('multi-line block comment removed — all comment lines map to -1', () => {
        const src = 'const a = 1;\n/**\n * JSDoc\n */\nconst b = 2;\n';
        const types = new Set(/** @type {const} */ (['jsdoc']));
        const { result, lineMap } = stripCommentsWithLineMap(src, types);
        assert.strictEqual(result, 'const a = 1;\n\nconst b = 2;\n');
        assert.notStrictEqual(lineMap, null);
        if (lineMap === null) throw new Error('unreachable');
        // Line 0: "const a = 1;" survives
        assert.strictEqual(lineMap[0], 0);
        // Lines 1-3: the JSDoc block — removed
        assert.strictEqual(lineMap[1], -1);
        assert.strictEqual(lineMap[2], -1);
        assert.strictEqual(lineMap[3], -1);
        // Line 4: "const b = 2;" survives
        assert.ok(lineMap[4] >= 0);
    });

    test('inline comment removal preserves the code line', () => {
        const src = 'const a = 1; // inline\nconst b = 2;\n';
        const all = new Set(/** @type {const} */ (['jsdoc', 'license', 'regular']));
        const { result, lineMap } = stripCommentsWithLineMap(src, all);
        assert.ok(result.includes('const a = 1;'));
        assert.ok(result.includes('const b = 2;'));
        assert.notStrictEqual(lineMap, null);
        if (lineMap === null) throw new Error('unreachable');
        // Both code lines survive
        assert.ok(lineMap[0] >= 0);
        assert.ok(lineMap[1] >= 0);
        // And they're in order
        assert.ok(lineMap[0] < lineMap[1]);
    });

    test('multiple comment blocks between code lines', () => {
        const src = ['const a = 1;', '// comment 1', '// comment 2', 'const b = 2;', '/* block */', 'const c = 3;', ''].join('\n');
        const all = new Set(/** @type {const} */ (['jsdoc', 'license', 'regular']));
        const { lineMap } = stripCommentsWithLineMap(src, all);
        assert.notStrictEqual(lineMap, null);
        if (lineMap === null) throw new Error('unreachable');
        // Code lines survive
        assert.ok(lineMap[0] >= 0); // const a
        assert.strictEqual(lineMap[1], -1); // comment 1
        assert.strictEqual(lineMap[2], -1); // comment 2
        assert.ok(lineMap[3] >= 0); // const b
        assert.strictEqual(lineMap[4], -1); // block comment
        assert.ok(lineMap[5] >= 0); // const c
        // Order preserved
        assert.ok(lineMap[0] < lineMap[3]);
        assert.ok(lineMap[3] < lineMap[5]);
    });

    test('blank line collapsing is reflected in lineMap', () => {
        const src = ['const a = 1;', '// c1', '// c2', '// c3', '// c4', 'const b = 2;', ''].join('\n');
        const all = new Set(/** @type {const} */ (['jsdoc', 'license', 'regular']));
        const { result, lineMap } = stripCommentsWithLineMap(src, all);
        // After removing 4 comment lines, there would be many blank lines,
        // but cleanup collapses them. "const b" should still be reachable.
        assert.ok(result.includes('const a = 1;'));
        assert.ok(result.includes('const b = 2;'));
        assert.notStrictEqual(lineMap, null);
        if (lineMap === null) throw new Error('unreachable');
        assert.ok(lineMap[0] >= 0);
        assert.ok(lineMap[5] >= 0);
    });

    test('hashbang line is preserved and mapped', () => {
        const src = '#!/usr/bin/env node\n// comment\nconst a = 1;\n';
        const all = new Set(/** @type {const} */ (['jsdoc', 'license', 'regular']));
        const { result, lineMap } = stripCommentsWithLineMap(src, all);
        assert.ok(result.startsWith('#!/usr/bin/env node\n'));
        assert.ok(result.includes('const a = 1;'));
        assert.notStrictEqual(lineMap, null);
        if (lineMap === null) throw new Error('unreachable');
        // Hashbang line survives
        assert.ok(lineMap[0] >= 0);
        // Comment removed
        assert.strictEqual(lineMap[1], -1);
        // Code survives
        assert.ok(lineMap[2] >= 0);
    });

    test('selective stripping only removes matching types', () => {
        const src = ['/** jsdoc */', 'const a = 1;', '// regular', 'const b = 2;', ''].join('\n');
        const types = new Set(/** @type {const} */ (['regular']));
        const { lineMap } = stripCommentsWithLineMap(src, types);
        assert.notStrictEqual(lineMap, null);
        if (lineMap === null) throw new Error('unreachable');
        // JSDoc line survives (not stripped)
        assert.ok(lineMap[0] >= 0);
        // Code lines survive
        assert.ok(lineMap[1] >= 0);
        // Regular comment removed
        assert.strictEqual(lineMap[2], -1);
        // Code survives
        assert.ok(lineMap[3] >= 0);
    });

    test('lineMap length matches original line count', () => {
        const src = '// a\n// b\n// c\ncode;\n';
        const all = new Set(/** @type {const} */ (['jsdoc', 'license', 'regular']));
        const { lineMap } = stripCommentsWithLineMap(src, all);
        assert.notStrictEqual(lineMap, null);
        if (lineMap === null) throw new Error('unreachable');
        // src.split('\n') has 5 elements (4 lines + trailing empty from final \n)
        assert.strictEqual(lineMap.length, src.split('\n').length);
    });

    test('realistic dts-buddy scenario: JSDoc typedefs above exported function', () => {
        const src = [
            '/**',
            ' * @typedef {import("@niceties/logger").Logger} Logger',
            ' */',
            '',
            '/**',
            ' * @typedef {Object} PackageJson',
            ' * @property {Object.<string, string>} [scripts]',
            ' */',
            '',
            '/**',
            ' * Prunes a package.json.',
            ' * @param {PackageJson} pkg',
            ' * @param {Logger} logger',
            ' */',
            'export async function prunePkg(pkg, logger) {',
            '    // internal comment',
            '    return;',
            '}',
            '',
        ].join('\n');
        const types = new Set(/** @type {const} */ (['jsdoc', 'regular']));
        const { result, lineMap } = stripCommentsWithLineMap(src, types);
        assert.notStrictEqual(lineMap, null);
        if (lineMap === null) throw new Error('unreachable');
        // The function declaration (line 14) should survive
        assert.ok(lineMap[14] >= 0);
        // The typedef lines should be removed
        assert.strictEqual(lineMap[1], -1); // @typedef Logger
        assert.strictEqual(lineMap[5], -1); // @typedef PackageJson
        // "return;" (line 16) should survive
        assert.ok(lineMap[16] >= 0);
        // Result should contain the function
        assert.ok(result.includes('export async function prunePkg'));
        assert.ok(result.includes('return;'));
    });
});

// ===========================================================================
// adjustSourcemapLineMappings
// ===========================================================================

describe('adjustSourcemapLineMappings', () => {
    /**
     * Helper: build a minimal v3 sourcemap with pre-decoded segments,
     * encode it, run adjustment, decode the result.
     * Segments: [genCol, srcIdx, origLine, origCol] or [genCol, srcIdx, origLine, origCol, nameIdx]
     * @param {string} mappingsStr
     * @param {string[]} sources
     * @param {string[]} [names]
     */
    function makeMap(mappingsStr, sources, names) {
        return {
            version: 3,
            file: 'output.d.ts',
            sources: sources || ['../source.js'],
            names: names || [],
            mappings: mappingsStr,
        };
    }

    test('adjusts original line numbers based on lineMap', () => {
        // A mapping pointing to line 4 (0-based) of source 0.
        // After stripping, line 4 moves to line 2.
        //
        // Manually craft a simple mapping: gen line 1, col 0 → source 0, line 4, col 0
        // VLQ: col=0 (A), src=0 (A), line=4 (I), col=0 (A) → "AAIA"
        const map = makeMap('AAIA', ['../source.js']);
        const lineMap = new Int32Array([0, -1, -1, 1, 2, 3]);
        // line 0 → 0, lines 1-2 removed, line 3 → 1, line 4 → 2, line 5 → 3

        adjustSourcemapLineMappings(map, 0, lineMap);

        // Now decode to verify line 4 became line 2.
        // We re-parse by creating another map to check.
        // The simplest check: create a known mapping for line 2 and compare.
        // VLQ for line=2: "AAEA" (col=0, src=0, line=2, col=0)
        assert.strictEqual(map.mappings, 'AAEA');
    });

    test('drops segments whose original line was removed', () => {
        // Mapping to line 1 (0-based) which is removed.
        // VLQ: col=0, src=0, line=1, col=0 → "AACA"
        const map = makeMap('AACA', ['../source.js']);
        const lineMap = new Int32Array([0, -1, 1]);

        adjustSourcemapLineMappings(map, 0, lineMap);

        // Segment should be dropped; only an empty line of mappings remains.
        assert.strictEqual(map.mappings, '');
    });

    test('does not touch segments pointing to other source indices', () => {
        // Two segments on gen line 1:
        // seg1: col=0, src=0, line=5, col=0 → "AAKA"
        // seg2: col=5, src=1 (delta +1), line=5 (delta 0), col=0 (delta 0) → "KCAA"
        // Combined: "AAKA,KCAA"
        // But we only adjust source index 0. Source 1 should be untouched.
        const map = makeMap('AAKA,KCAA', ['../a.js', '../b.js']);
        const lineMap = new Int32Array([0, 1, 2, 3, 4, 2]); // line 5 → 2

        adjustSourcemapLineMappings(map, 0, lineMap);

        // Decode by hand: after adjustment, source 0's line 5 → line 2.
        // Source 1's line 5 stays at 5. Let's just verify the map is still valid
        // and has 2 segments.
        assert.ok(map.mappings.length > 0);
        // The mappings string should contain a comma (two segments on one line).
        assert.ok(map.mappings.includes(','));
    });

    test('handles multiple generated lines', () => {
        // Line 1: col=0, src=0, origLine=0, origCol=10 → "AAU" (U = 10)
        // Actually let's use a simpler encoding.
        // Line 1: col=17, src=0, origLine=70, origCol=22 → big VLQ
        // Line 2: col=13, src=0, origLine=38 (delta -32 from 70), origCol=40 (delta +18)
        //
        // Let's use the actual dts-buddy map from the project as test data.
        const map = makeMap(';;;;iBAsEsBA,QAAQA;aAhCUC,MAAMA', ['../prune.js'], ['prunePkg', 'Logger']);

        // Simulate: lines 0-37 stay, line 38 → 6 (shifted up 32), line 70 → 38 (shifted down 32)
        // Build a lineMap for 80 lines.
        const lineMap = new Int32Array(80);
        for (let i = 0; i < 80; i++) lineMap[i] = i; // identity initially

        // Simulate removing 32 lines before line 38 (e.g., lines 6-37 removed).
        // line 38 becomes line 6, line 70 becomes line 38.
        for (let i = 6; i < 38; i++) lineMap[i] = -1;
        for (let i = 38; i < 80; i++) lineMap[i] = i - 32;

        adjustSourcemapLineMappings(map, 0, lineMap);

        // The map should still be valid and have content.
        assert.ok(map.mappings.length > 0);
        // It should still have the semicolons structure (4 empty lines + 2 mapped lines).
        const lines = map.mappings.split(';');
        assert.strictEqual(lines.length, 6);
    });

    test('ignores non-v3 sourcemaps', () => {
        const map = { version: 2, mappings: 'AAAA', sources: ['a.js'] };
        const lineMap = new Int32Array([0, 1]);
        // Should not throw.
        adjustSourcemapLineMappings(map, 0, lineMap);
        // Mappings unchanged.
        assert.strictEqual(map.mappings, 'AAAA');
    });

    test('ignores sourcemaps with non-string mappings', () => {
        const map = /** @type {{ version: number, mappings: any, sources: string[] }} */ ({
            version: 3,
            mappings: null,
            sources: ['a.js'],
        });
        const lineMap = new Int32Array([0, 1]);
        adjustSourcemapLineMappings(map, 0, lineMap);
        assert.strictEqual(map.mappings, null);
    });

    test('handles segments with name index (5 fields)', () => {
        // Segment: col=0, src=0, line=4, col=5, name=0 → "AAKIE" (K=5, I=4, E=2... let me just use a known encoding)
        // Actually let's construct: col=0(A), src=0(A), line=4(I), col=5(K), name=0(A) → "AAIKA"
        const map = makeMap('AAIKA', ['../source.js'], ['myFunc']);
        const lineMap = new Int32Array([0, -1, -1, 1, 2]);
        // line 4 → 2

        adjustSourcemapLineMappings(map, 0, lineMap);

        // Line should have been adjusted. Name index should still be there.
        // The mapping should still have content (not dropped).
        assert.ok(map.mappings.length > 0);
        assert.notStrictEqual(map.mappings, '');
    });

    test('drops out-of-range segments gracefully', () => {
        // Segment pointing to line 100 but lineMap only covers 10 lines.
        // VLQ for line 100: need multi-byte. Let's build it differently.
        // Use a large line number. col=0, src=0, line=100 (0-based), col=0.
        // 100 in VLQ signed: value=100, shifted=200, encode base64...
        // Just use "AA8GA" — actually let me just pick one.
        // Easier: col=0, src=0, line=10, col=0 → line 10 is "AAUA"
        const map = makeMap('AAUA', ['../source.js']);
        const lineMap = new Int32Array([0, 1, 2]); // only 3 lines

        adjustSourcemapLineMappings(map, 0, lineMap);

        // Segment should be dropped (line 10 is out of range).
        assert.strictEqual(map.mappings, '');
    });

    test('all segments removed results in empty mappings', () => {
        const map = makeMap('AACA;AACA', ['../source.js']);
        const lineMap = new Int32Array([0, -1, -1, 1]);

        adjustSourcemapLineMappings(map, 0, lineMap);

        // Both segments pointed to line 1 which is removed.
        // Result should be ";" (two empty generated lines).
        assert.strictEqual(map.mappings, ';');
    });

    test('empty mappings string is handled', () => {
        const map = makeMap('', ['../source.js']);
        const lineMap = new Int32Array([0, 1]);
        adjustSourcemapLineMappings(map, 0, lineMap);
        assert.strictEqual(map.mappings, '');
    });

    test('end-to-end: stripCommentsWithLineMap + adjustSourcemapLineMappings', () => {
        // Source file with JSDoc that gets stripped.
        const source = [
            '/**', // line 0
            ' * @typedef {Object} Options', // line 1
            ' */', // line 2
            '', // line 3
            '/**', // line 4
            ' * Does stuff.', // line 5
            ' * @param {Options} opts', // line 6
            ' */', // line 7
            'export function doStuff(opts) {', // line 8
            '    return opts;', // line 9
            '}', // line 10
            '', // line 11
        ].join('\n');

        const types = new Set(/** @type {const} */ (['jsdoc']));
        const { result, lineMap } = stripCommentsWithLineMap(source, types);

        // Verify stripping worked.
        assert.ok(result.includes('export function doStuff'));
        assert.ok(!result.includes('@typedef'));
        assert.notStrictEqual(lineMap, null);

        // The function declaration was on original line 8.
        if (lineMap === null) throw new Error('unreachable');
        const newFuncLine = lineMap[8];
        assert.ok(newFuncLine >= 0, 'function line should survive');

        // Verify it actually points to the right line in the stripped output.
        const strippedLines = result.split('\n');
        assert.ok(strippedLines[newFuncLine].includes('export function doStuff'));

        // Now build a sourcemap that pointed to line 8, col 16 ("doStuff") and line 1 ("@typedef").
        // Encoding: gen line 1 has two segments.
        // seg1: col=0, src=0, origLine=8, origCol=16 → "AAQgB"
        // seg2: col=10, src=0, origLine=1 (delta -7), origCol=3 (delta -13) → "UANb"
        // But exact VLQ is tricky. Let me use a simpler approach:
        // Just test that adjusting a map with known decoded structure works.

        // Manually build the map with the known structure:
        // Gen line 5, seg: col=17, src=0, origLine=8, origCol=16, name=0
        // We'll use the map format similar to the dts-buddy output.
        // For simplicity, just encode origLine=8:
        // col=0(A), src=0(A), origLine=8(Q), origCol=16(gB), name=0(A) → "AAQgBA"
        const map = {
            version: 3,
            file: 'output.d.ts',
            sources: ['../source.js'],
            names: ['doStuff'],
            mappings: 'AAQgBA',
        };

        adjustSourcemapLineMappings(map, 0, /** @type {Int32Array} */ (lineMap));

        // The mapping should not be empty (line 8 survived).
        assert.ok(map.mappings.length > 0);
        assert.notStrictEqual(map.mappings, '');
    });

    test('end-to-end: mapping into removed comment is dropped', () => {
        const source = [
            '/**', // line 0
            ' * @typedef {import("foo").Bar} Bar', // line 1
            ' */', // line 2
            'export function bar() {}', // line 3
            '', // line 4
        ].join('\n');

        const types = new Set(/** @type {const} */ (['jsdoc']));
        const { lineMap } = stripCommentsWithLineMap(source, types);
        assert.notStrictEqual(lineMap, null);
        if (lineMap === null) throw new Error('unreachable');

        // Line 1 (inside JSDoc) should be removed.
        assert.strictEqual(lineMap[1], -1);

        // Build a map with two segments:
        // seg1: points to line 1 (typedef — inside removed JSDoc)
        // seg2: points to line 3 (function — survives)
        // Encoding: line 1 = "AACA", then on next gen line, line 3 (delta +2) = "AAEA"
        const map = {
            version: 3,
            file: 'output.d.ts',
            sources: ['../source.js'],
            names: [],
            mappings: 'AACA;AAEA',
        };

        adjustSourcemapLineMappings(map, 0, /** @type {Int32Array} */ (lineMap));

        // First gen line's segment (pointing to removed line 1) should be dropped.
        // Second gen line's segment (pointing to surviving line 3) should remain.
        const lines = map.mappings.split(';');
        assert.strictEqual(lines.length, 2);
        // First generated line: empty (segment dropped)
        assert.strictEqual(lines[0], '');
        // Second generated line: has a segment
        assert.ok(lines[1].length > 0);
    });
});
