/**
 * @typedef {'jsdoc' | 'license' | 'regular'} CommentType
 */

/**
 * @typedef {Object} CommentRange
 * @property {number} start - Start index in source (inclusive)
 * @property {number} end - End index in source (exclusive)
 * @property {CommentType} type - Classification of the comment
 */

const jsExtensions = ['.js', '.mjs', '.cjs'];

/**
 * Check if a file path has a JS extension that may contain comments.
 * @param {string} file
 * @returns {boolean}
 */
export function isStrippableFile(file) {
    return jsExtensions.some(ext => file.endsWith(ext));
}

/**
 * Keywords after which a `/` token begins a regex literal rather than division.
 */
const regexPrecedingKeywords = new Set([
    'return',
    'throw',
    'typeof',
    'void',
    'delete',
    'new',
    'in',
    'instanceof',
    'case',
    'yield',
    'await',
    'of',
    'export',
    'import',
    'default',
    'extends',
    'else',
]);

/**
 * Classify a block comment based on its content.
 * Priority: license > jsdoc > regular.
 *
 * @param {string} source - Full source text
 * @param {number} start - Start index of the comment (at `/`)
 * @param {number} end - End index of the comment (after `*​/`)
 * @returns {CommentType}
 */
function classifyBlockComment(source, start, end) {
    // License: starts with /*! or contains @license or @preserve
    if (source[start + 2] === '!') {
        return 'license';
    }

    // Check for @license or @preserve inside the comment body
    const body = source.slice(start + 2, end - 2);
    if (body.includes('@license') || body.includes('@preserve')) {
        return 'license';
    }

    // JSDoc: starts with /** (and is not the degenerate /**/ which is length 4)
    if (source[start + 2] === '*' && end - start > 4) {
        return 'jsdoc';
    }

    return 'regular';
}

/**
 * Scan source code and return an array of comment ranges with their types.
 * Correctly handles:
 * - Single and double quoted strings (with escapes)
 * - Template literals (with nested `${…}` expressions, arbitrarily deep)
 * - Regular expression literals (with character classes `[…]`)
 * - Hashbang lines (`#!/…`)
 * - Single-line comments (`// …`)
 * - Block comments (`/* … *​/`)
 *
 * @param {string} source
 * @returns {CommentRange[]}
 */
export function scanComments(source) {
    /** @type {CommentRange[]} */
    const comments = [];
    const len = source.length;
    let i = 0;

    // Stack for template literal nesting.
    // Each entry holds the brace depth inside a `${…}` expression.
    // When the stack is non-empty the main loop is inside a template expression.
    /** @type {number[]} */
    const templateStack = [];

    // For regex-vs-division disambiguation we track whether the last
    // *significant* (non-whitespace, non-comment) token could be the end
    // of an expression.  If it could, `/` is the division operator;
    // otherwise `/` starts a regex literal.
    let exprEnd = false;

    // --- Hashbang ----------------------------------------------------------
    if (len >= 2 && source[0] === '#' && source[1] === '!') {
        // Skip the entire hashbang line — it is never a comment.
        while (i < len && source[i] !== '\n') i++;
        // exprEnd stays false (hashbang is like the start of the file)
    }

    while (i < len) {
        const ch = source.charCodeAt(i);

        // ---- whitespace (skip, preserve exprEnd) --------------------------
        // space, tab, newline, carriage return, vertical tab, form feed,
        // BOM / NBSP (0xFEFF, 0x00A0) – we keep it simple: anything ≤ 0x20
        // plus the two common Unicode whitespace chars.
        if (ch <= 0x20 || ch === 0xfeff || ch === 0xa0) {
            i++;
            continue;
        }

        // ---- single-line comment ------------------------------------------
        if (ch === 0x2f /* / */ && i + 1 < len && source.charCodeAt(i + 1) === 0x2f /* / */) {
            const start = i;
            i += 2;
            while (i < len && source.charCodeAt(i) !== 0x0a /* \n */) i++;
            comments.push({ start, end: i, type: 'regular' });
            // exprEnd unchanged (comments are transparent)
            continue;
        }

        // ---- block comment ------------------------------------------------
        if (ch === 0x2f /* / */ && i + 1 < len && source.charCodeAt(i + 1) === 0x2a /* * */) {
            const start = i;
            i += 2;
            while (i < len && !((source.charCodeAt(i) === 0x2a /* * */ && i + 1 < len && source.charCodeAt(i + 1) === 0x2f) /* / */)) {
                i++;
            }
            if (i < len) i += 2; // skip closing */
            comments.push({ start, end: i, type: classifyBlockComment(source, start, i) });
            // exprEnd unchanged
            continue;
        }

        // ---- regex literal ------------------------------------------------
        if (ch === 0x2f /* / */ && !exprEnd) {
            i = skipRegex(source, i, len);
            exprEnd = true; // a regex is a value
            continue;
        }

        // ---- single-quoted string ----------------------------------------
        if (ch === 0x27 /* ' */) {
            i = skipSingleString(source, i, len);
            exprEnd = true;
            continue;
        }

        // ---- double-quoted string ----------------------------------------
        if (ch === 0x22 /* " */) {
            i = skipDoubleString(source, i, len);
            exprEnd = true;
            continue;
        }

        // ---- template literal --------------------------------------------
        if (ch === 0x60 /* ` */) {
            i = scanTemplateTail(source, i + 1, len, templateStack, comments);
            exprEnd = true;
            continue;
        }

        // ---- closing brace: may end a template expression ----------------
        if (ch === 0x7d /* } */) {
            if (templateStack.length > 0) {
                const depth = templateStack[templateStack.length - 1];
                if (depth === 0) {
                    // Returning from a template expression back to the template body.
                    templateStack.pop();
                    i = scanTemplateTail(source, i + 1, len, templateStack, comments);
                    exprEnd = true;
                    continue;
                }
                templateStack[templateStack.length - 1] = depth - 1;
            }
            i++;
            // After `}` we conservatively assume regex can follow.
            // This is correct for block statements, if/for/while bodies,
            // class bodies, etc.  For the rare `({}) / x` pattern it would
            // misidentify division as regex, but that is harmless for
            // comment detection (we just skip over the "regex" body).
            exprEnd = false;
            continue;
        }

        // ---- opening brace -----------------------------------------------
        if (ch === 0x7b /* { */) {
            if (templateStack.length > 0) {
                templateStack[templateStack.length - 1]++;
            }
            i++;
            exprEnd = false;
            continue;
        }

        // ---- identifier / keyword / number --------------------------------
        if (isIdentStart(ch) || isDigit(ch)) {
            const wordStart = i;
            i++;
            while (i < len && isIdentPart(source.charCodeAt(i))) i++;
            const word = source.slice(wordStart, i);
            exprEnd = !regexPrecedingKeywords.has(word);
            continue;
        }

        // ---- ++ and -- ----------------------------------------------------
        if ((ch === 0x2b /* + */ || ch === 0x2d) /* - */ && i + 1 < len && source.charCodeAt(i + 1) === ch) {
            i += 2;
            exprEnd = true; // `x++` / `x--` end an expression
            continue;
        }

        // ---- closing brackets ) ] ----------------------------------------
        if (ch === 0x29 /* ) */ || ch === 0x5d /* ] */) {
            i++;
            exprEnd = true;
            continue;
        }

        // ---- everything else: operators, punctuation ----------------------
        i++;
        exprEnd = false;
    }

    return comments;
}

// ---------------------------------------------------------------------------
// Character classification helpers
// ---------------------------------------------------------------------------

/**
 * @param {number} ch - char code
 * @returns {boolean}
 */
function isDigit(ch) {
    return ch >= 0x30 && ch <= 0x39; // 0-9
}

/**
 * @param {number} ch - char code
 * @returns {boolean}
 */
function isIdentStart(ch) {
    return (
        (ch >= 0x41 && ch <= 0x5a) || // A-Z
        (ch >= 0x61 && ch <= 0x7a) || // a-z
        ch === 0x5f || // _
        ch === 0x24 || // $
        ch === 0x5c || // \ (unicode escape in identifier)
        ch > 0x7f // non-ASCII (simplified – covers all Unicode ID_Start)
    );
}

/**
 * @param {number} ch - char code
 * @returns {boolean}
 */
function isIdentPart(ch) {
    return isIdentStart(ch) || isDigit(ch);
}

// ---------------------------------------------------------------------------
// Skip helpers — each returns the new index *after* the construct.
// ---------------------------------------------------------------------------

/**
 * Skip a single-quoted string starting at index `i` (which points at the
 * opening `'`). Returns the index after the closing `'`.
 * @param {string} s
 * @param {number} i
 * @param {number} len
 * @returns {number}
 */
function skipSingleString(s, i, len) {
    i++; // skip opening '
    while (i < len) {
        const ch = s.charCodeAt(i);
        if (ch === 0x27 /* ' */) {
            i++;
            break;
        }
        if (ch === 0x5c /* \ */) {
            i += 2;
            continue;
        } // escape
        if (ch === 0x0a /* \n */ || ch === 0x0d /* \r */) break; // unterminated
        i++;
    }
    return i;
}

/**
 * Skip a double-quoted string starting at index `i` (which points at the
 * opening `"`). Returns the index after the closing `"`.
 * @param {string} s
 * @param {number} i
 * @param {number} len
 * @returns {number}
 */
function skipDoubleString(s, i, len) {
    i++; // skip opening "
    while (i < len) {
        const ch = s.charCodeAt(i);
        if (ch === 0x22 /* " */) {
            i++;
            break;
        }
        if (ch === 0x5c /* \ */) {
            i += 2;
            continue;
        }
        if (ch === 0x0a || ch === 0x0d) break; // unterminated
        i++;
    }
    return i;
}

/**
 * Skip a regex literal starting at index `i` (which points at the opening `/`).
 * Handles character classes `[…]` and escape sequences.
 * Returns the index after the closing `/` and any flags.
 * @param {string} s
 * @param {number} i
 * @param {number} len
 * @returns {number}
 */
function skipRegex(s, i, len) {
    i++; // skip opening /
    while (i < len) {
        const ch = s.charCodeAt(i);
        if (ch === 0x5c /* \ */) {
            i += 2; // skip escaped char
            continue;
        }
        if (ch === 0x5b /* [ */) {
            // character class — `]` inside does not end the regex
            i++;
            while (i < len) {
                const cc = s.charCodeAt(i);
                if (cc === 0x5c /* \ */) {
                    i += 2;
                    continue;
                }
                if (cc === 0x5d /* ] */) {
                    i++;
                    break;
                }
                if (cc === 0x0a || cc === 0x0d) break; // safety: unterminated
                i++;
            }
            continue;
        }
        if (ch === 0x2f /* / */) {
            i++; // skip closing /
            // consume flags: [a-z] (dgimsvy…)
            while (i < len && isRegexFlag(s.charCodeAt(i))) i++;
            break;
        }
        if (ch === 0x0a || ch === 0x0d) break; // unterminated on this line
        i++;
    }
    return i;
}

/**
 * @param {number} ch
 * @returns {boolean}
 */
function isRegexFlag(ch) {
    return ch >= 0x61 && ch <= 0x7a; // a-z
}

/**
 * Scan the body of a template literal starting *after* the opening `` ` ``
 * (or after the `}` that closes a template expression).
 *
 * If we hit `${`, we push onto `templateStack` and return to the main loop
 * so that the expression is parsed as normal code (which may contain
 * comments, nested templates, etc.).
 *
 * If we hit the closing `` ` ``, we return and the template is done.
 *
 * @param {string} s
 * @param {number} i - index right after the `` ` `` or `}`
 * @param {number} len
 * @param {number[]} templateStack
 * @param {CommentRange[]} comments - passed through so inner comments are recorded
 * @returns {number} new index
 */
function scanTemplateTail(s, i, len, templateStack, comments) {
    void comments; // comments only found inside ${} which returns to main loop
    while (i < len) {
        const ch = s.charCodeAt(i);
        if (ch === 0x5c /* \ */) {
            i += 2; // skip escape sequence
            continue;
        }
        if (ch === 0x60 /* ` */) {
            i++; // closing backtick
            return i;
        }
        if (ch === 0x24 /* $ */ && i + 1 < len && s.charCodeAt(i + 1) === 0x7b /* { */) {
            i += 2; // skip ${
            templateStack.push(0); // push new brace depth for this expression
            return i; // return to main loop for expression parsing
        }
        i++;
    }
    return i;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse the `--strip-comments` flag value into a `Set` of comment types.
 *
 * - `'all'` or `true`  → `{'jsdoc', 'license', 'regular'}`
 * - `'jsdoc,regular'`  → `{'jsdoc', 'regular'}`
 *
 * @param {string | true} value
 * @returns {Set<CommentType>}
 */
export function parseCommentTypes(value) {
    if (value === true || value === 'all') {
        return new Set(/** @type {CommentType[]} */ (['jsdoc', 'license', 'regular']));
    }

    const valid = /** @type {CommentType[]} */ (['jsdoc', 'license', 'regular']);
    const parts = String(value)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

    /** @type {Set<CommentType>} */
    const result = new Set();

    for (const part of parts) {
        if (part === 'all') {
            return new Set(valid);
        }
        if (!valid.includes(/** @type {CommentType} */ (part))) {
            throw new Error(`unknown comment type "${part}" (expected: ${valid.join(', ')}, all)`);
        }
        result.add(/** @type {CommentType} */ (part));
    }

    if (result.size === 0) {
        return new Set(valid); // fallback to all
    }

    return result;
}

/**
 * Strip comments from `source` whose type is in `typesToStrip`.
 *
 * @param {string} source
 * @param {Set<CommentType>} typesToStrip
 * @returns {string}
 */
export function stripComments(source, typesToStrip) {
    const comments = scanComments(source);

    if (comments.length === 0) return source;

    // Filter to only the comments we want to remove.
    const toRemove = comments.filter(c => typesToStrip.has(c.type));

    if (toRemove.length === 0) return source;

    // Build output by copying non-removed ranges.
    /** @type {string[]} */
    const parts = [];
    let pos = 0;

    for (const { start, end } of toRemove) {
        if (start > pos) {
            parts.push(source.slice(pos, start));
        }
        pos = end;
    }

    if (pos < source.length) {
        parts.push(source.slice(pos));
    }

    let result = parts.join('');

    // Clean up artefacts left behind by comment removal:
    // 1. Lines that now contain only whitespace → collapse.
    // 2. Runs of 2+ blank lines → at most 1 blank line.
    // 3. Leading blank lines (after an optional hashbang) → remove.

    // Trim trailing whitespace from every line (catches spaces left when
    // a trailing comment is removed, e.g. `const x = 1; // comment`).
    result = result.replace(/[ \t]+$/gm, '');

    // Collapse 3+ consecutive newlines (= 2+ blank lines) into 2 newlines
    // (= 1 blank line). We use a loop-safe regex.
    result = result.replace(/\n{3,}/g, '\n\n');

    // Remove leading blank lines (but preserve a hashbang on line 1).
    if (result.startsWith('#!')) {
        // Keep the hashbang line, strip blanks after it.
        const hashbangEnd = result.indexOf('\n');
        if (hashbangEnd !== -1) {
            const before = result.slice(0, hashbangEnd + 1);
            const after = result.slice(hashbangEnd + 1).replace(/^\n+/, '');
            result = before + after;
        }
    } else {
        result = result.replace(/^\n+/, '');
    }

    // Ensure the file ends with exactly one newline (if it originally did).
    if (source.endsWith('\n') && result.length > 0) {
        result = result.replace(/\n*$/, '\n');
    }

    return result;
}
