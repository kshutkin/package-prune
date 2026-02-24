import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * @typedef {Object} Logger
 * @property {function(string): void} update
 */

/**
 * @typedef {Object} PackageJson
 * @property {Object.<string, string>} [scripts]
 * @property {Object.<string, string>} [devDependencies]
 * @property {string} [packageManager]
 * @property {string} [main]
 * @property {string|Object.<string, string>} [bin]
 * @property {Array<string>} [files]
 * @property {Object} [directories]
 * @property {Object} [exports]
 * @property {Object} [typesVersions]
 */

/**
 * @typedef {Object} PruneOptions
 * @property {string} profile
 * @property {string|boolean} flatten
 * @property {boolean} removeSourcemaps
 * @property {boolean} optimizeFiles
 */

/**
 * Prunes a package.json object according to the given options.
 * @param {PackageJson} pkg
 * @param {PruneOptions} options
 * @param {Logger} logger
 */
export async function prunePkg(pkg, options, logger) {
    const scriptsToKeep = getScriptsData();

    const keys = scriptsToKeep[/** @type {'library'|'app'} */ (options.profile)];

    if (!keys) {
        throw new Error(`unknown profile ${options.profile}`);
    }

    pkg.devDependencies = undefined;
    pkg.packageManager = undefined;

    if (pkg.scripts) {
        for (const key of Object.keys(pkg.scripts)) {
            if (!keys.has(key)) {
                delete pkg.scripts[key];
            }
        }

        if (Object.keys(pkg.scripts).length === 0) {
            pkg.scripts = undefined;
        }
    }

    if (options.flatten) {
        await flatten(pkg, options.flatten, logger);
    }

    if (options.removeSourcemaps) {
        const sourceMaps = await walkDir('.', ['node_modules']).then(files => files.filter(file => file.endsWith('.map')));
        for (const sourceMap of sourceMaps) {
            // find corresponding file
            const sourceFile = sourceMap.slice(0, -4);
            // load file
            const sourceFileContent = await readFile(sourceFile, 'utf8');
            // find sourceMappingURL
            const sourceMappingUrl = `\n//# sourceMappingURL=${path.basename(sourceMap)}`;
            // remove sourceMappingURL
            const newContent = sourceFileContent.replace(sourceMappingUrl, '');
            // write file
            await writeFile(sourceFile, newContent, 'utf8');
            // remove sourceMap
            await rm(sourceMap);
        }
    }

    if (pkg.files && Array.isArray(pkg.files) && options.optimizeFiles) {
        const filterFiles = ['package.json'];
        const specialFiles = ['README', 'LICENSE', 'LICENCE'];
        if (pkg.main && typeof pkg.main === 'string') {
            filterFiles.push(normalizePath(pkg.main));
        }
        if (pkg.bin) {
            if (typeof pkg.bin === 'string') {
                filterFiles.push(normalizePath(pkg.bin));
            }
            if (typeof pkg.bin === 'object' && pkg.bin !== null) {
                filterFiles.push(...Object.values(pkg.bin).map(normalizePath));
            }
        }

        const depthToFiles = new Map();

        for (const file of pkg.files.concat(filterFiles)) {
            const dirname = path.dirname(file);
            const depth = dirname.split('/').length;
            if (!depthToFiles.has(depth)) {
                depthToFiles.set(depth, [file]);
            } else {
                depthToFiles.get(depth)?.push(file);
            }
        }

        // walk depth keys from the highest to the lowest
        const maxDepth = Math.max(...depthToFiles.keys());
        for (let depth = maxDepth; depth > 0; --depth) {
            const files = depthToFiles.get(depth);
            const mapDirToFiles = new Map();
            for (const file of files) {
                const dirname = path.dirname(file);
                const basename = normalizePath(path.basename(file));
                if (!mapDirToFiles.has(dirname)) {
                    mapDirToFiles.set(dirname, [basename]);
                } else {
                    mapDirToFiles.get(dirname)?.push(basename);
                }
            }
            for (const [dirname, filesInDir] of mapDirToFiles) {
                // find out real content of the directory
                const realFiles = await readdir(dirname);
                // check if all files in the directory are in the filesInDir
                const allFilesInDir = realFiles.every(file => filesInDir.includes(file)) || realFiles.length === 0;
                if (allFilesInDir && dirname !== '.') {
                    if (!depthToFiles.has(depth - 1)) {
                        depthToFiles.set(depth - 1, [dirname]);
                    } else {
                        depthToFiles.get(depth - 1).push(dirname);
                    }
                    const thisDepth = depthToFiles.get(depth);
                    depthToFiles.set(
                        depth,
                        thisDepth.filter((/** @type {string} */ file) =>
                            filesInDir.every((/** @type {string} */ fileInDir) => path.join(dirname, fileInDir) !== file)
                        )
                    );
                }
            }
        }

        pkg.files = [...new Set(Array.from(depthToFiles.values()).flat())];

        pkg.files = pkg.files.filter((/** @type {string} */ file) => {
            const fileNormalized = normalizePath(file);
            const dirname = path.dirname(fileNormalized);
            const basenameWithoutExtension = path.basename(fileNormalized, path.extname(fileNormalized)).toUpperCase();
            return (
                !filterFiles.includes(fileNormalized) &&
                ((dirname !== '' && dirname !== '.') || !specialFiles.includes(basenameWithoutExtension))
            );
        });

        /**
         * @type {string[]}
         */
        const ignoreDirs = [];

        for (const fileOrDir of pkg.files) {
            if (await isDirectory(fileOrDir)) {
                const allFiles = await walkDir(fileOrDir);
                if (
                    allFiles.every((/** @type {string} */ file) => {
                        const fileNormalized = normalizePath(file);
                        return filterFiles.includes(fileNormalized);
                    })
                ) {
                    ignoreDirs.push(fileOrDir);
                }
            }
        }

        pkg.files = pkg.files.filter(dir => !ignoreDirs.includes(dir));

        if (pkg.files.length === 0) {
            pkg.files = undefined;
        }
    }
}

/**
 * Flattens the dist directory and updates package.json references.
 * Supports multiple directories (comma-separated when passed as a string).
 * @param {PackageJson} pkg
 * @param {string|true} flatten
 * @param {Logger} logger
 */
async function flatten(pkg, flatten, logger) {
    const { default: jsonata } = await import('jsonata');

    // find out where is the dist folder

    const expression = jsonata('[bin, bin.*, main, module, unpkg, umd, types, typings, exports[].*.*, typesVersions.*.*, directories.bin]');
    const allReferences = await expression.evaluate(pkg);

    /** @type {string[]} */
    let distDirs;

    // at this point we requested directories.bin, but it is the only one that is directory and not a file
    // later when we get dirname we can't flatten directories.bin completely
    // it is easy to fix by checking element is a directory but it is kind of good
    // to have it as a separate directory, but user still can flatten it by specifying the directory

    if (flatten === true) {
        let commonSegments;

        for (const entry of allReferences) {
            if (typeof entry !== 'string') {
                continue;
            }

            const dirname = path.dirname(entry);

            const cleanedSegments = dirname.split('/').filter(path => path && path !== '.');
            if (!commonSegments) {
                commonSegments = cleanedSegments;
            } else {
                for (let i = 0; i < commonSegments.length; ++i) {
                    if (commonSegments[i] !== cleanedSegments[i]) {
                        commonSegments.length = i;
                        break;
                    }
                }
            }
        }
        const distDir = commonSegments?.join('/');
        if (!distDir) {
            throw new Error('could not find dist folder');
        }
        distDirs = [distDir];
    } else {
        // split on comma to support multiple directories
        distDirs = flatten
            .split(',')
            .map(d => normalizePath(d.trim()))
            .filter(Boolean);
    }

    logger.update(`flattening ${distDirs.join(', ')}...`);

    // collect files from all dist directories

    /** @type {Map<string, { distDir: string, relativeDistDir: string, files: string[] }>} */
    const distDirInfo = new Map();

    for (const distDir of distDirs) {
        const relativeDistDir = `./${distDir}`;
        const files = await walkDir(relativeDistDir);
        distDirInfo.set(distDir, { distDir, relativeDistDir, files });
    }

    // check for conflicts: files already existing in root AND cross-directory collisions

    /** @type {Map<string, string>} */
    const destinationToSource = new Map();
    const existsPromises = [];
    /** @type {string[]} */
    const existsKeys = [];

    for (const [distDir, info] of distDirInfo) {
        for (const file of info.files) {
            const relativePath = path.relative(info.relativeDistDir, file);

            // check for cross-directory conflicts
            if (destinationToSource.has(relativePath)) {
                const otherDir = destinationToSource.get(relativePath);
                throw new Error(`cannot flatten because '${relativePath}' exists in both '${otherDir}' and '${distDir}'`);
            }
            destinationToSource.set(relativePath, distDir);

            // check if file already exists in root
            existsKeys.push(relativePath);
            existsPromises.push(isExists(relativePath));
        }
    }

    const exists = await Promise.all(existsPromises);

    const filesAlreadyExist = exists.filter(Boolean);

    if (filesAlreadyExist.length) {
        throw new Error(`dist folder cannot be flattened because files already exist: ${filesAlreadyExist.join(', ')}`);
    }

    // handle directories.bin special case for each dist dir
    for (const distDir of distDirs) {
        if (
            'directories' in pkg &&
            pkg.directories != null &&
            typeof pkg.directories === 'object' &&
            'bin' in pkg.directories &&
            typeof pkg.directories.bin === 'string' &&
            normalizePath(pkg.directories.bin) === distDir
        ) {
            delete pkg.directories.bin;
            if (Object.keys(pkg.directories).length === 0) {
                pkg.directories = undefined;
            }
            const files = await readdir(distDir);
            if (files.length === 1) {
                pkg.bin = files[0];
            } else {
                pkg.bin = {};
                for (const file of files) {
                    pkg.bin[path.basename(file, path.extname(file))] = file;
                }
            }
        }
    }

    // create new directory structure
    const mkdirPromises = [];
    for (const [, info] of distDirInfo) {
        for (const file of info.files) {
            const relativePath = path.relative(info.relativeDistDir, file);
            mkdirPromises.push(mkdir(path.dirname(relativePath), { recursive: true }));
        }
    }

    await Promise.all(mkdirPromises);

    // move files to root dir (rename)
    const renamePromises = [];
    const newFiles = [];

    for (const [, info] of distDirInfo) {
        for (const file of info.files) {
            const relativePath = path.relative(info.relativeDistDir, file);
            newFiles.push(relativePath);
            renamePromises.push(rename(file, relativePath));
        }
    }

    await Promise.all(renamePromises);

    // clean up empty source directories
    /** @type {string[]} */
    const cleanedDirs = [];
    for (const [, info] of distDirInfo) {
        let cleanedDir = info.relativeDistDir;
        while (await isEmptyDir(cleanedDir)) {
            await rm(cleanedDir, { recursive: true, force: true });
            const parentDir = path.dirname(cleanedDir);
            if (parentDir === '.') {
                break;
            }
            cleanedDir = parentDir;
        }
        cleanedDirs.push(normalizePath(cleanedDir));
    }

    const allReferencesSet = new Set(allReferences);

    // update package.json - replace each distDir prefix in references
    const stringsToReplace = distDirs.map(d => `${d}/`);
    const pkgClone = cloneAndUpdate(pkg, value => {
        if (!allReferencesSet.has(value)) {
            return value;
        }
        for (const stringToReplace of stringsToReplace) {
            if (value.includes(stringToReplace)) {
                return value.replace(stringToReplace, '');
            }
        }
        return value;
    });
    Object.assign(pkg, pkgClone);

    // update files
    let files = pkg.files;
    if (files) {
        files = files.filter(file => {
            const fileNormalized = normalizePath(file);
            return !cleanedDirs.some(cleanedDir => isSubDirectory(cleanedDir, fileNormalized) || fileNormalized === cleanedDir);
        });
        files.push(...newFiles);
        pkg.files = [...files];
    }

    // remove extra directories with package.json
    const exports = pkg.exports ? Object.keys(pkg.exports) : [];
    for (const key of exports) {
        if (key === '.') {
            continue;
        }
        const isDir = await isDirectory(key);
        if (isDir) {
            const pkgPath = path.join(key, 'package.json');
            const pkgExists = await isExists(pkgPath);
            // ensure nothing else is in the directory
            const files = await readdir(key);
            if (files.length === 1 && pkgExists) {
                await rm(key, { recursive: true, force: true });
            }
        }
    }
}

/**
 * @param {string} file
 * @returns {string}
 */
function normalizePath(file) {
    let fileNormalized = path.normalize(file);
    if (fileNormalized.endsWith('/') || fileNormalized.endsWith('\\')) {
        // remove trailing slash
        fileNormalized = fileNormalized.slice(0, -1);
    }
    return fileNormalized;
}

/**
 * Deep clones an object/array and updates all string values using the updater function
 * @param {unknown} pkg
 * @param {(value: string) => string} updater
 * @returns {unknown}
 */
function cloneAndUpdate(pkg, updater) {
    if (typeof pkg === 'string') {
        return updater(pkg);
    }
    if (Array.isArray(pkg)) {
        return pkg.map(value => cloneAndUpdate(value, updater));
    }
    if (typeof pkg === 'object' && pkg !== null) {
        /** @type {Record<string, unknown>} */
        const clone = {};
        for (const key of Object.keys(pkg)) {
            clone[key] = cloneAndUpdate(/** @type {Record<string, unknown>} */ (pkg)[key], updater);
        }
        return clone;
    }
    return pkg;
}

/**
 * @param {string} parent
 * @param {string} child
 * @returns {boolean}
 */
function isSubDirectory(parent, child) {
    return path.relative(child, parent).startsWith('..');
}

/**
 * @param {string} dir
 * @returns {Promise<boolean>}
 */
async function isEmptyDir(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter(entry => !entry.isDirectory()).length === 0;
}

/**
 * @param {string} file
 * @returns {Promise<boolean>}
 */
async function isDirectory(file) {
    const fileStat = await stat(file);
    return fileStat.isDirectory();
}

/**
 * @param {string} dir
 * @param {Array<string>} [ignoreDirs=[]]
 * @returns {Promise<Array<string>>}
 */
async function walkDir(dir, ignoreDirs = []) {
    const entries = await readdir(dir, { withFileTypes: true });
    /**
     * @type {string[]}
     */
    const files = [];

    // Process files first
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            const childPath = path.join(entry.parentPath, entry.name);
            files.push(childPath);
        }
    }

    // Then process directories
    for (const entry of entries) {
        if (entry.isDirectory()) {
            const childPath = path.join(entry.parentPath, entry.name);
            const relativePath = path.relative(dir, childPath);
            const topLevelDir = relativePath.split(path.sep)[0];

            if (!ignoreDirs.includes(topLevelDir)) {
                const childFiles = await walkDir(childPath);
                files.push(...childFiles);
            }
        }
    }

    return files;
}

/**
 * @param {string} file
 */
async function isExists(file) {
    try {
        await access(file);
    } catch (e) {
        if (typeof e === 'object' && e != null && 'code' in e && e.code === 'ENOENT') {
            return false;
        }
        throw e;
    }
    return file;
}

function getScriptsData() {
    const libraryScripts = new Set(['preinstall', 'install', 'postinstall', 'prepublish', 'preprepare', 'prepare', 'postprepare']);

    const appScripts = new Set([
        ...libraryScripts,
        'prestart',
        'start',
        'poststart',
        'prerestart',
        'restart',
        'postrestart',
        'prestop',
        'stop',
        'poststop',
        'pretest',
        'test',
        'posttest',
    ]);

    return {
        library: libraryScripts,
        app: appScripts,
    };
}
