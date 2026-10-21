import { isSourceMappingComment, scanComments } from './strip-comments.js';

/**
 * Remove source mapping directives while preserving strings containing similar text.
 * @param {string} source
 * @param {string} filename
 */
export function removeSourceMappingComments(source, filename) {
    const comments = filename.endsWith('.css')
        ? [...source.matchAll(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\/\*[\s\S]*?\*\//g)]
              .filter(match => match[0].startsWith('/*'))
              .map(match => ({ start: match.index, end: match.index + match[0].length }))
        : scanComments(source);
    let result = '';
    let pos = 0;
    for (const { start, end } of comments) {
        if (!isSourceMappingComment(source.slice(start, end))) continue;
        const before = source.slice(pos, start).replace(/(?:\r?\n)?[ \t]*$/, '');
        result += before;
        pos = end;
    }
    return result + source.slice(pos);
}
