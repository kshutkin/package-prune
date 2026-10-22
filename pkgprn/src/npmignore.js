import path from 'node:path';

import ignoreWalk from 'ignore-walk';
import { escape as escapeGlob } from 'minimatch';

const { Walker } = ignoreWalk;

/**
 * Resolve npm's per-directory ignore rules and publish whitelist.
 * @param {string[]} inventory
 * @param {{files?: string[], required: string[], defaults: string[], hardIgnored: Set<string>}} policy
 * @returns {Promise<string[]>}
 */
export async function filterNpmIgnore(inventory, policy) {
    const available = new Set(inventory);
    const required = new Set(policy.required.filter(file => available.has(file)));

    class IgnoreWalker extends Walker {
        /** @param {import('ignore-walk').WalkerOptions} [options] */
        constructor(options = {}) {
            super({ path: path.resolve('.'), ...options, follow: false });
            this.ignoreFiles = [':defaults', ':files', '.npmignore', '.gitignore', ':required'];
            this.onReadIgnoreFile(':defaults', policy.defaults.join('\n'), () => {});
            if (!this.parent && policy.files) {
                const rules = policy.files.flatMap(entry => {
                    const exclude = entry.startsWith('!');
                    const source = exclude ? entry.slice(1) : entry;
                    const pattern = source.replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');
                    if (!pattern && !['', './', '/'].includes(source)) return [];
                    const rule = `${exclude ? '' : '!'}${pattern ? `/${pattern}` : ''}`;
                    return pattern ? [rule, `${rule}/**`] : [`${rule}/**`];
                });
                this.onReadIgnoreFile(':files', ['*', ...rules].join('\n'), () => {});
            }
            const localRequired = [...required]
                .map(file => path.relative(this.path, path.resolve(file)))
                .filter(file => file && !file.startsWith(`..${path.sep}`) && file !== '..' && !path.isAbsolute(file));
            this.onReadIgnoreFile(
                ':required',
                localRequired.map(file => `!/${escapeGlob(file.split(path.sep).join('/'))}`).join('\n'),
                () => {}
            );
        }

        /** @param {string} file */
        isIgnoreFile(file) {
            return (file === '.npmignore' || file === '.gitignore') && available.has(path.relative('.', path.join(this.path, file)));
        }

        /** @param {string[]} entries */
        onReaddir(entries) {
            super.onReaddir(entries.filter(entry => !policy.hardIgnored.has(entry)));
        }

        filterEntries() {
            if (!this.parent && policy.files) {
                delete this.ignoreRules['.npmignore'];
                delete this.ignoreRules['.gitignore'];
            } else if (this.ignoreRules['.npmignore']) {
                delete this.ignoreRules['.gitignore'];
            }
            super.filterEntries();
        }

        /** @param {Parameters<import('ignore-walk').Walker['onstat']>[0]} options
         * @param {() => void} next
         */
        onstat(options, next) {
            if (options.st.isFile() || options.st.isDirectory()) super.onstat(options, next);
            else next();
        }

        /** @param {string} entry
         * @param {import('ignore-walk').WalkerOptions | undefined} options
         * @param {() => void} next
         */
        walker(entry, options, next) {
            new IgnoreWalker(this.walkerOpt(entry, options)).on('done', next).start();
        }
    }

    /** @type {Promise<string[]>} */
    const pending = new Promise((resolve, reject) => new IgnoreWalker().on('done', resolve).on('error', reject).start());
    const files = await pending;
    return files.map(file => path.normalize(file)).filter(file => available.has(file));
}
