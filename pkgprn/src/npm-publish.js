import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import packlist from 'npm-packlist';

const exec = promisify(execFile);

/** @returns {Promise<{globalIgnoreFile: string}>} */
export async function resolvePublishOptions() {
    // Ask npm to apply its environment, project, user and prefix configuration.
    const npmCli = process.env.npm_execpath;
    const command = npmCli && path.basename(npmCli) === 'npm-cli.js' ? process.execPath : 'npm';
    const args = command === process.execPath ? [/** @type {string} */ (npmCli)] : [];
    let config;
    try {
        const { stdout } = await exec(command, [...args, 'config', 'list', '--json']);
        config = JSON.parse(stdout);
    } catch (error) {
        if (!(typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT')) throw error;
        config = { prefix: path.dirname(path.dirname(process.execPath)) };
    }
    return { globalIgnoreFile: config['global-ignore-file'] ?? path.resolve(config.prefix, 'etc/npmignore') };
}

/**
 * @param {11|12} [requested]
 * @returns {Promise<11|12>}
 */
export async function resolveNpmVersion(requested) {
    if (requested !== undefined) {
        if (requested !== 11 && requested !== 12) throw new Error('npmVersion must be 11 or 12');
        return requested;
    }
    const agent = /(?:^|\s)npm\/(\d+)(?:\.|\s|$)/.exec(process.env.npm_config_user_agent ?? '');
    if (agent) return Number(agent[1]) >= 12 ? 12 : 11;
    try {
        const { stdout } = await exec('npm', ['--version']);
        const major = Number(stdout.trim().split('.')[0]);
        if (Number.isInteger(major) && major > 0) return major >= 12 ? 12 : 11;
    } catch (error) {
        if (typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT') return 11;
        throw error;
    }
    throw new Error('Could not detect npm version; specify npmVersion as 11 or 12');
}

/**
 * Resolve a root package without traversing bundled dependencies, whose contents
 * are independent of its files field. Only regular inventory files supply ignores.
 * @param {import('./prune.js').PackageJson} pkg
 * @param {11|12} version
 * @param {string[]} inventory
 * @param {string[]} binFiles
 * @param {{globalIgnoreFile?: string}} [options]
 * @returns {Promise<string[]>}
 */
export async function getPublishFiles(pkg, version, inventory, binFiles, options = {}) {
    const selectedPacklist = version === 12 ? (await import('npm-packlist-v12')).default : packlist;
    const available = new Set(inventory);
    const tree = {
        path: path.resolve('.'),
        isProjectRoot: true,
        package: {
            ...pkg,
            bin: Object.fromEntries(binFiles.map(file => [file, path.normalize(file)])),
            bundleDependencies: [],
        },
    };
    /** @typedef {import('ignore-walk').Walker & {processPackage: (next: () => void) => void}} PackWalker */
    const implementation =
        /** @type {{Walker: new (root: typeof tree, options?: import('ignore-walk').WalkerOptions & {isPackage?: boolean, globalIgnoreFile?: string}) => PackWalker}} */ (
            /** @type {unknown} */ (selectedPacklist)
        );
    class InventoryWalker extends implementation.Walker {
        /** @param {string} file */
        isIgnoreFile(file) {
            if ((file === '.npmignore' || file === '.gitignore') && !available.has(path.relative('.', path.join(this.path, file)))) {
                return false;
            }
            return super.isIgnoreFile(file);
        }

        /**
         * @param {string} entry
         * @param {import('ignore-walk').WalkerOptions|undefined} options
         * @param {() => void} next
         */
        walker(entry, options, next) {
            new InventoryWalker(tree, this.walkerOpt(entry, options)).on('done', next).start();
        }
    }
    /** @type {Promise<string[]>} */
    const pending = new Promise((resolve, reject) => {
        const walker = new InventoryWalker(tree, { ...options, isPackage: true }).on('done', resolve).on('error', reject);
        if (available.has('package.json')) walker.start();
        // The API can receive a manifest that has not been written to disk yet.
        else walker.processPackage(() => walker.start());
    });
    const files = await pending;
    return files.map(file => path.normalize(file)).filter(file => available.has(file));
}
