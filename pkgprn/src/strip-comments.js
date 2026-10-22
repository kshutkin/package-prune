import { decode, encode } from '@jridgewell/sourcemap-codec';

/**
 * @typedef {'jsdoc' | 'license' | 'regular' | 'annotation'} CommentType
 */

/**
 * @typedef {Object} CommentRange
 * @property {number} start - Start index in source (inclusive)
 * @property {number} end - End index in source (exclusive)
 * @property {CommentType} type - Classification of the comment
 */

/**
 * @typedef {{ line: number, column: number }} SourcePosition
 * @typedef {(line: number, column: number) => SourcePosition | null} PositionMapper
 *
 * @typedef {Object} StripResult
 * @property {string} result - The stripped source text
 * @property {PositionMapper | null} mapPosition - Maps original source positions to stripped positions.
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

/** @param {string} comment */
export function isSourceMappingComment(comment) {
    return /^\/[/*][#@]\s*sourceMappingURL\s*=/.test(comment);
}

/**
 * Keywords after which a `/` token begins a regex literal rather than division.
 */
const controlKeywords = new Set(['if', 'while', 'for', 'with', 'switch', 'catch']);

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
    'export',
    'import',
    'default',
    'extends',
    'else',
    'do',
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

    // Annotation: bundler hints like /*#__PURE__*/, /*@__PURE__*/, /*#__NO_SIDE_EFFECTS__*/, etc.
    if (/^[#@]__[A-Z_]+__$/.test(body.trim())) {
        return 'annotation';
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
 * @param {{ start: number, end: number }[]} [literals]
 * @returns {CommentRange[]}
 */
export function scanComments(source, literals = []) {
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
    /** @type {string | null} */
    let controlParen = null;
    let propertyAccess = false;
    let lastToken = '';
    let statementStart = true;
    let lineBreakKeyword = '';
    /** @type {boolean[]} */
    const objectBraces = [];
    /** @type {{control: string | null, braces: number, forBinding: boolean}[]} */
    const parens = [];
    /** @type {{keyword: string, expression: boolean, parens: number, braces: number}[]} */
    const bodies = [];

    function lineBreak() {
        if (lineBreakKeyword) {
            exprEnd = false;
            statementStart = true;
            lineBreakKeyword = '';
        }
    }

    // --- Hashbang ----------------------------------------------------------
    if (len >= 2 && source[0] === '#' && source[1] === '!') {
        // Skip the entire hashbang line — it is never a comment.
        while (i < len && !isLineTerminator(source.charCodeAt(i))) i++;
        // exprEnd stays false (hashbang is like the start of the file)
    }

    while (i < len) {
        const ch = source.charCodeAt(i);

        // ---- whitespace (skip, preserve exprEnd) --------------------------
        if (isWhitespace(ch)) {
            if (isLineTerminator(ch)) lineBreak();
            i++;
            continue;
        }

        // ---- single-line comment ------------------------------------------
        if (ch === 0x2f /* / */ && i + 1 < len && source.charCodeAt(i + 1) === 0x2f /* / */) {
            const start = i;
            i += 2;
            while (i < len && !isLineTerminator(source.charCodeAt(i))) i++;
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
            if (lineBreakKeyword && /[\r\n\u2028\u2029]/.test(source.slice(start, i))) lineBreak();
            comments.push({ start, end: i, type: classifyBlockComment(source, start, i) });
            // exprEnd unchanged
            continue;
        }

        // Only break/continue can carry a label before their terminating line break.
        if (!isIdentStart(ch) && !isDigit(ch)) lineBreakKeyword = '';

        // ---- regex literal ------------------------------------------------
        if (ch === 0x2f /* / */ && !exprEnd) {
            const start = i;
            i = skipRegex(source, i, len);
            literals.push({ start, end: i });
            exprEnd = true; // a regex is a value
            statementStart = false;
            lastToken = 'literal';
            continue;
        }

        // ---- single-quoted string ----------------------------------------
        if (ch === 0x27 /* ' */) {
            const start = i;
            i = skipSingleString(source, i, len);
            literals.push({ start, end: i });
            exprEnd = true;
            statementStart = false;
            lastToken = 'literal';
            continue;
        }

        // ---- double-quoted string ----------------------------------------
        if (ch === 0x22 /* " */) {
            const start = i;
            i = skipDoubleString(source, i, len);
            literals.push({ start, end: i });
            exprEnd = true;
            statementStart = false;
            lastToken = 'literal';
            continue;
        }

        // ---- template literal --------------------------------------------
        if (ch === 0x60 /* ` */) {
            i = scanTemplateTail(source, i + 1, len, templateStack, literals);
            exprEnd = source[i - 1] !== '{';
            lastToken = exprEnd ? 'literal' : '(';
            statementStart = false;
            continue;
        }

        // ---- closing brace: may end a template expression ----------------
        if (ch === 0x7d /* } */) {
            if (templateStack.length > 0) {
                const depth = templateStack[templateStack.length - 1];
                if (depth === 0) {
                    // Returning from a template expression back to the template body.
                    templateStack.pop();
                    i = scanTemplateTail(source, i + 1, len, templateStack, literals);
                    exprEnd = source[i - 1] !== '{';
                    lastToken = exprEnd ? 'literal' : '(';
                    statementStart = false;
                    continue;
                }
                templateStack[templateStack.length - 1] = depth - 1;
            }
            i++;
            // An object expression can end before division; a statement block cannot.
            exprEnd = objectBraces.pop() ?? false;
            statementStart = !exprEnd;
            lastToken = '}';
            continue;
        }

        // ---- opening brace -----------------------------------------------
        if (ch === 0x7b /* { */) {
            const body = bodies.at(-1);
            const startsBody =
                body &&
                body.parens === parens.length &&
                body.braces === objectBraces.length &&
                (body.keyword === 'class' || lastToken === ')');
            const arrow = lastToken === '=>';
            const expression = startsBody ? body.expression : arrow || (!statementStart && !exprEnd);
            if (startsBody) bodies.pop();
            objectBraces.push(expression);
            statementStart = !!startsBody || arrow || !expression;
            lastToken = '{';
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
            const paren = parens.at(-1);
            const forOf =
                !propertyAccess &&
                word === 'of' &&
                paren?.forBinding &&
                paren.braces === objectBraces.length &&
                exprEnd &&
                !['const', 'let', 'var'].includes(lastToken);
            if (forOf) paren.forBinding = false;
            if (!propertyAccess && (word === 'function' || word === 'class')) {
                bodies.push({ keyword: word, expression: !statementStart, parens: parens.length, braces: objectBraces.length });
            }
            controlParen = !propertyAccess && controlKeywords.has(word) ? word : word === 'await' && controlParen === 'for' ? 'for' : null;
            exprEnd = propertyAccess || (!forOf && !regexPrecedingKeywords.has(word));
            lineBreakKeyword =
                !propertyAccess && ['break', 'continue', 'debugger', 'return', 'yield'].includes(word)
                    ? word
                    : ['break', 'continue'].includes(lineBreakKeyword)
                      ? lineBreakKeyword
                      : '';
            statementStart =
                !propertyAccess &&
                (['else', 'do', 'try', 'finally'].includes(word) || (statementStart && ['async', 'export', 'default'].includes(word)));
            propertyAccess = false;
            lastToken = word;
            continue;
        }

        // ---- ++ and -- ----------------------------------------------------
        if ((ch === 0x2b /* + */ || ch === 0x2d) /* - */ && i + 1 < len && source.charCodeAt(i + 1) === ch) {
            i += 2;
            exprEnd = true; // `x++` / `x--` end an expression
            statementStart = false;
            continue;
        }

        if (ch === 0x28 /* ( */) {
            parens.push({ control: controlParen, braces: objectBraces.length, forBinding: controlParen === 'for' });
            lastToken = '(';
            controlParen = null;
            exprEnd = false;
            statementStart = false;
            i++;
            continue;
        }

        // A control condition ends before a statement, which may start with a regex.
        if (ch === 0x29 /* ) */ || ch === 0x5d /* ] */) {
            exprEnd = ch === 0x5d || !parens.pop()?.control;
            statementStart = !exprEnd;
            lastToken = source[i];
            i++;
            continue;
        }

        // ---- everything else: operators, punctuation ----------------------
        controlParen = null;
        propertyAccess = ch === 0x2e /* . */;
        // A reserved word followed by ':' was a property name, not a body header.
        if (ch === 0x3a && bodies.at(-1)?.keyword === lastToken) bodies.pop();
        const paren = parens.at(-1);
        const header = paren?.braces === objectBraces.length && paren.control;
        if (ch === 0x3b && header) paren.forBinding = false;
        statementStart = ch === 0x3b /* ; */ && !header;
        lastToken = source.startsWith('=>', i) ? '=>' : source[i];
        if (lastToken === '=>') i++;
        i++;
        exprEnd = false;
    }

    return comments;
}

// ---------------------------------------------------------------------------
// Character classification helpers
// ---------------------------------------------------------------------------

/** @param {number} ch */
function isLineTerminator(ch) {
    return ch === 0x0a || ch === 0x0d || ch === 0x2028 || ch === 0x2029;
}

/** @param {number} ch */
function isWhitespace(ch) {
    return ch <= 0x20 || ch === 0xfeff || ch === 0xa0 || isLineTerminator(ch);
}

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
        (ch > 0x7f && !isWhitespace(ch)) // non-ASCII (simplified – covers all Unicode ID_Start)
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
        if (isLineTerminator(ch)) break; // unterminated
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
        if (isLineTerminator(ch)) break; // unterminated
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
                if (isLineTerminator(cc)) break; // safety: unterminated
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
        if (isLineTerminator(ch)) break; // unterminated on this line
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
 * @param {{ start: number, end: number }[]} literals - raw template ranges to preserve
 * @returns {number} new index
 */
function scanTemplateTail(s, i, len, templateStack, literals) {
    const start = i;
    while (i < len) {
        const ch = s.charCodeAt(i);
        if (ch === 0x5c /* \ */) {
            i += 2; // skip escape sequence
            continue;
        }
        if (ch === 0x60 /* ` */) {
            i++; // closing backtick
            literals.push({ start, end: i });
            return i;
        }
        if (ch === 0x24 /* $ */ && i + 1 < len && s.charCodeAt(i + 1) === 0x7b /* { */) {
            i += 2; // skip ${
            templateStack.push(0); // push new brace depth for this expression
            literals.push({ start, end: i });
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
 * - `true`                    → `{'jsdoc', 'regular'}` (license and annotation are preserved by default)
 * - `['jsdoc', 'regular']`   → `{'jsdoc', 'regular'}`
 * - `['license']`            → `{'license'}` (must be explicitly requested)
 * - `['annotation']`         → `{'annotation'}` (must be explicitly requested)
 *
 * @param {string[] | true} value
 * @returns {Set<CommentType>}
 */
export function parseCommentTypes(value) {
    if (value === true) {
        return new Set(/** @type {CommentType[]} */ (['jsdoc', 'regular']));
    }

    const valid = /** @type {CommentType[]} */ (['jsdoc', 'license', 'regular', 'annotation']);

    /** @type {Set<CommentType>} */
    const result = new Set();

    for (const part of value) {
        if (!valid.includes(/** @type {CommentType} */ (part))) {
            throw new Error(`unknown comment type "${part}" (expected: ${valid.join(', ')})`);
        }
        result.add(/** @type {CommentType} */ (part));
    }

    if (result.size === 0) {
        return new Set(/** @type {CommentType[]} */ (['jsdoc', 'regular'])); // fallback to default
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
    const toRemove = scanComments(source)
        .filter(c => typesToStrip.has(c.type) && !isSourceMappingComment(source.slice(c.start, c.end)))
        .map(comment => ({
            ...comment,
            replacement: /[\r\n\u2028\u2029]/.test(source.slice(comment.start, comment.end))
                ? '\n'
                : /\s/.test(source[comment.start - 1] || ' ') || /\s/.test(source[comment.end] || ' ')
                  ? ''
                  : ' ',
        }));
    if (toRemove.length === 0) return { result: source, lineMap: null, mapPosition: null };

    let result = source;
    /** @type {((offset: number) => number | null)[]} */
    const stages = [];
    /** @param {{start: number, end: number, replacement: string}[]} edits */
    function apply(edits) {
        if (!edits.length) return;
        let output = '';
        let cursor = 0;
        for (const edit of edits) {
            output += result.slice(cursor, edit.start) + edit.replacement;
            cursor = edit.end;
        }
        result = output + result.slice(cursor);
        stages.push(offset => {
            let delta = 0;
            for (const edit of edits) {
                if (offset < edit.start) break;
                if (offset < edit.end) return null;
                delta += edit.replacement.length - (edit.end - edit.start);
            }
            return offset + delta;
        });
    }
    apply(toRemove);

    /** @type {{start: number, end: number}[]} */
    const literals = [];
    scanComments(result, literals);
    apply(
        [...result.matchAll(/[ \t]+$|\n{3,}/gm)]
            .filter(match => !literals.some(({ start, end }) => match.index < end && match.index + match[0].length > start))
            .map(match => ({
                start: match.index,
                end: match.index + match[0].length,
                replacement: match[0].startsWith('\n') ? '\n\n' : '',
            }))
    );

    const firstLine = result.startsWith('#!') ? result.indexOf('\n') + 1 : 0;
    const leading = /^\n+/.exec(result.slice(firstLine));
    if (leading) apply([{ start: firstLine, end: firstLine + leading[0].length, replacement: '' }]);
    if (source.endsWith('\n') && result.length) {
        const trailing = /\n*$/.exec(result);
        if (trailing && trailing[0] !== '\n') apply([{ start: trailing.index, end: result.length, replacement: '\n' }]);
    }

    const originalStarts = buildLineStarts(source);
    const finalStarts = buildLineStarts(result);
    /** @type {PositionMapper} */
    const mapPosition = (line, column) => {
        if (originalStarts[line] === undefined || column < 0) return null;
        let offset = originalStarts[line] + column;
        if (offset > source.length || offset >= (originalStarts[line + 1] ?? source.length + 1)) return null;
        for (const stage of stages) {
            const mapped = stage(offset);
            if (mapped === null) return null;
            offset = mapped;
        }
        const finalLine = offsetToLine(finalStarts, offset);
        return { line: finalLine, column: offset - finalStarts[finalLine] };
    };
    const lineMap = new Int32Array(originalStarts.length).fill(-1);
    for (const [line, start] of originalStarts.entries()) {
        const end = originalStarts[line + 1] ?? source.length;
        for (let offset = start; offset < end; offset++) {
            if (/\s/.test(source[offset])) continue;
            const mapped = mapPosition(line, offset - start);
            if (mapped) {
                lineMap[line] = mapped.line;
                break;
            }
        }
    }
    return { result, lineMap, mapPosition };
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
    for (const match of text.matchAll(/\r\n|[\r\n\u2028\u2029]/g)) starts.push(match.index + match[0].length);
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
    adjustSourcemapPositions(
        map,
        (line, column) => {
            const mapped = lineMap[line];
            return mapped === undefined || mapped < 0 ? null : { line: mapped, column };
        },
        sourceIndex
    );
}

/**
 * Remap generated positions, or original positions for one source index.
 * @param {{version: number, mappings: string, [key: string]: unknown}} map
 * @param {PositionMapper} mapPosition
 * @param {number} [sourceIndex]
 */
export function adjustSourcemapPositions(map, mapPosition, sourceIndex) {
    if (map.version !== 3 || typeof map.mappings !== 'string') return;
    const decoded = decode(map.mappings);
    const generated = sourceIndex === undefined;
    /** @type {import('@jridgewell/sourcemap-codec').SourceMapSegment[][]} */
    const output = Array.from({ length: generated ? 0 : decoded.length }, () => []);
    for (const [line, segments] of decoded.entries()) {
        for (const segment of segments) {
            let destination = line;
            if (generated || (segment.length >= 4 && segment[1] === sourceIndex)) {
                const original = /** @type {[number, number, number, number, ...number[]]} */ (segment);
                const position = generated ? mapPosition(line, segment[0]) : mapPosition(original[2], original[3]);
                if (position === null) continue;
                if (generated) {
                    destination = position.line;
                    segment[0] = position.column;
                } else if (segment.length >= 4) {
                    segment[2] = position.line;
                    segment[3] = position.column;
                }
            }
            while (output.length <= destination) output.push([]);
            output[destination].push(segment);
        }
    }
    for (const line of output) line.sort((a, b) => a[0] - b[0]);
    map.mappings = encode(output);
}
