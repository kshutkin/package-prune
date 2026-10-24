import { isSourceMappingComment, scanComments } from './strip-comments.js';

/**
 * Remove source mapping directives while preserving strings containing similar text.
 * @param {string} source
 * @param {string} filename
 */
export function removeSourceMappingComments(source, filename) {
    const css = filename.endsWith('.css');
    const comments = css
        ? [...source.matchAll(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\/\*[\s\S]*?\*\//g)]
              .filter(match => match[0].startsWith('/*'))
              .map(match => ({ start: match.index, end: match.index + match[0].length }))
        : scanComments(source);
    let result = '';
    let pos = 0;
    const contentEnd = source.trimEnd().length;
    for (const { start, end } of comments) {
        if (!isSourceMappingComment(source.slice(start, end))) continue;
        const before = source.slice(pos, start);
        if (end >= contentEnd) {
            // A trailing directive has no following tokens to separate.
            result += before.replace(/(?:\r?\n)?[ \t]*$/, '');
        } else {
            result += before;
            if (!css) {
                const newline = /\r\n|[\n\r\u2028\u2029]/.exec(source.slice(start, end));
                result += newline ? newline[0] : /\s/.test(source[start - 1] || ' ') || /\s/.test(source[end] || ' ') ? '' : ' ';
            }
        }
        pos = end;
    }
    return result + source.slice(pos);
}
