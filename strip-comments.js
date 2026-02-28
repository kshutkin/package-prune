import { decode, encode } from '@jridgewell/sourcemap-codec';

/**
 * @typedef {'jsdoc' | 'license' | 'regular'} CommentType
 */

/**
 * @typedef {Object} CommentRange
 * @property {number} start - Start index in source (inclusive)
 * @property {number} end - End index in source (exclusive)
 * @property {CommentType} type - Classification of the comment
 */

/**
 * @typedef {Object} StripResult
 * @property {string} result - The stripped source text
 * @property {Int32Array | null} lineMap - Maps 0-based original line → 0-based new line (-1 if removed). null when nothing changed.
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
    return stripCommentsWithLineMap(source, typesToStrip).result;
}

/**
 * Strip comments and return both the stripped source and a line map that
 * tracks where each original line ended up in the output.
 *
 * @param {string} source
 * @param {Set<CommentType>} typesToStrip
 * @returns {StripResult}
 */
export function stripCommentsWithLineMap(source, typesToStrip) {
    const comments = scanComments(source);

    if (comments.length === 0) return { result: source, lineMap: null };

    // Filter to only the comments we want to remove.
    const toRemove = comments.filter(c => typesToStrip.has(c.type));

    if (toRemove.length === 0) return { result: source, lineMap: null };

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

    let intermediate = parts.join('');

    // --- Build original-line → intermediate-line mapping -------------------
    // For every original offset, compute how many bytes were removed before it.
    // Then convert original line-start offsets to intermediate offsets and
    // derive intermediate line numbers.

    const origLines = source.split('\n');
    const origLineCount = origLines.length;

    // Build sorted prefix-sum of removed byte counts for fast lookup.
    // removedBefore(offset) = total chars removed in ranges fully before offset.
    // We also detect if an offset falls inside a removed range.

    /**
     * Translate an original offset to an intermediate offset.
     * Returns -1 if the offset is inside a removed range.
     * @param {number} offset
     * @returns {number}
     */
    function translateOffset(offset) {
        let removed = 0;
        for (const { start, end } of toRemove) {
            if (offset < start) break;
            if (offset < end) return -1; // inside removed range
            removed += end - start;
        }
        return offset - removed;
    }

    // For each original line, figure out which intermediate line it maps to.
    // An original line maps to -1 if its entire non-whitespace content was
    // inside removed ranges (i.e. the line becomes blank/whitespace-only).
    const intermediateText = intermediate;
    const intermediateLineStarts = buildLineStarts(intermediateText);

    /** @type {Int32Array} */
    const origToIntermediate = new Int32Array(origLineCount).fill(-1);
    let origOffset = 0;
    for (let oi = 0; oi < origLineCount; oi++) {
        const lineLen = origLines[oi].length;
        // Check if any content on this line survives.
        // We try the line-start offset; if it's inside a removed range
        // the whole beginning is gone, but content may survive later.
        // The most reliable way: translate the offset of each non-WS char.
        let survived = false;
        for (let ci = 0; ci < lineLen; ci++) {
            const ch = source.charCodeAt(origOffset + ci);
            // skip whitespace chars — they don't count as surviving content
            if (ch === 0x20 || ch === 0x09 || ch === 0x0d) continue;
            const mapped = translateOffset(origOffset + ci);
            if (mapped !== -1) {
                survived = true;
                // Convert intermediate offset to intermediate line number.
                origToIntermediate[oi] = offsetToLine(intermediateLineStarts, mapped);
                break;
            }
        }
        if (!survived) {
            origToIntermediate[oi] = -1;
        }
        origOffset += lineLen + 1; // +1 for the '\n' (split removed it)
    }

    // --- Apply cleanup (same logic as before) ------------------------------

    // Trim trailing whitespace from every line.
    intermediate = intermediate.replace(/[ \t]+$/gm, '');

    // Collapse 3+ consecutive newlines into 2 newlines.
    intermediate = intermediate.replace(/\n{3,}/g, '\n\n');

    // Remove leading blank lines (preserve hashbang).
    if (intermediate.startsWith('#!')) {
        const hashbangEnd = intermediate.indexOf('\n');
        if (hashbangEnd !== -1) {
            const before = intermediate.slice(0, hashbangEnd + 1);
            const after = intermediate.slice(hashbangEnd + 1).replace(/^\n+/, '');
            intermediate = before + after;
        }
    } else {
        intermediate = intermediate.replace(/^\n+/, '');
    }

    // Ensure the file ends with exactly one newline (if it originally did).
    if (source.endsWith('\n') && intermediate.length > 0) {
        intermediate = intermediate.replace(/\n*$/, '\n');
    }

    const result = intermediate;

    // --- Build intermediate-line → final-line mapping ----------------------
    // The cleanup may have removed/collapsed lines from the intermediateText.
    // We line up intermediateText lines with final lines by content matching.
    const finalLines = result.split('\n');
    const intLines = intermediateText.split('\n');

    // Trim trailing WS from intermediate lines to match what cleanup did.
    const intLinesTrimmed = intLines.map(l => l.replace(/[ \t]+$/, ''));

    /** @type {Int32Array} */
    const intermediateToFinal = new Int32Array(intLines.length).fill(-1);
    let fi = 0;
    for (let ii = 0; ii < intLinesTrimmed.length && fi < finalLines.length; ii++) {
        if (intLinesTrimmed[ii] === finalLines[fi]) {
            intermediateToFinal[ii] = fi;
            fi++;
        }
        // else: this intermediate line was removed by cleanup → stays -1
    }

    // --- Compose: original → intermediate → final --------------------------
    /** @type {Int32Array} */
    const lineMap = new Int32Array(origLineCount).fill(-1);
    for (let oi = 0; oi < origLineCount; oi++) {
        const il = origToIntermediate[oi];
        if (il >= 0 && il < intermediateToFinal.length) {
            lineMap[oi] = intermediateToFinal[il];
        }
    }

    return { result, lineMap };
}

/**
 * Build an array of line-start offsets for the given text.
 * `result[i]` is the char offset where line `i` begins (0-based lines).
 * @param {string} text
 * @returns {number[]}
 */
function buildLineStarts(text) {
    /** @type {number[]} */
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 0x0a) {
            starts.push(i + 1);
        }
    }
    return starts;
}

/**
 * Given sorted line-start offsets, find which line a char offset falls on.
 * @param {number[]} lineStarts
 * @param {number} offset
 * @returns {number} 0-based line number
 */
function offsetToLine(lineStarts, offset) {
    // Binary search for the last lineStart <= offset.
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (lineStarts[mid] <= offset) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    return lo;
}

/**
 * Adjust a parsed sourcemap (v3) whose `sources` reference a file that had
 * comments stripped. Updates the original-line numbers in `mappings` for
 * segments that point at the given source index.
 *
 * Segments whose original line maps to -1 (i.e. the line was removed) are
 * dropped from the output.
 *
 * @param {{ version: number, mappings: string, sources?: string[], names?: string[], [k: string]: unknown }} map - Parsed sourcemap object (mutated in place).
 * @param {number} sourceIndex - Index in `map.sources` of the stripped file.
 * @param {Int32Array} lineMap - 0-based original line → 0-based new line (-1 if removed).
 */
export function adjustSourcemapLineMappings(map, sourceIndex, lineMap) {
    if (map.version !== 3 || typeof map.mappings !== 'string') return;

    const decoded = decode(map.mappings);

    for (const line of decoded) {
        // Walk backwards so we can splice without index issues.
        for (let si = line.length - 1; si >= 0; si--) {
            const seg = line[si];
            // Segments with < 4 fields have no source mapping.
            if (seg.length < 4) continue;
            const seg4 = /** @type {[number, number, number, number, ...number[]]} */ (seg);
            // Only adjust segments pointing at the stripped source file.
            if (seg4[1] !== sourceIndex) continue;

            const origLine = seg4[2]; // 0-based
            if (origLine < 0 || origLine >= lineMap.length) {
                // Out of range — drop it.
                line.splice(si, 1);
                continue;
            }

            const newLine = lineMap[origLine];
            if (newLine === -1) {
                // The line was removed — drop this segment.
                line.splice(si, 1);
                continue;
            }

            seg4[2] = newLine;
        }
    }

    map.mappings = encode(decoded);
}
