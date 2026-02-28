import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { adjustSourcemapLineMappings, isStrippableFile, parseCommentTypes, stripCommentsWithLineMap } from './strip-comments.js';

/**
 * Files always included by npm regardless of the `files` array.
 * README & LICENSE/LICENCE are matched case-insensitively by basename (without extension).
 */
const alwaysIncludedExact = ['package.json'];
const alwaysIncludedBasenames = ['README', 'LICENSE', 'LICENCE'];

/**
 * Files/directories always ignored by npm by default.
 */
const alwaysIgnored = ['.DS_Store', '.hg', '.lock-wscript', '.svn', 'CVS', 'config.gypi', 'npm-debug.log'];

/**
 * Glob-like patterns for always-ignored files.
 * Each entry has a `test` function that checks whether a basename matches.
 */
const alwaysIgnoredPatterns = [
    /** `*.orig` */
    { test: (/** @type {string} */ basename) => basename.endsWith('.orig') },
    /** `.*.swp` */
    { test: (/** @type {string} */ basename) => basename.startsWith('.') && basename.endsWith('.swp') },
    /** `._*` */
    { test: (/** @type {string} */ basename) => basename.startsWith('._') },
    /** `.wafpickle-N` */
    { test: (/** @type {string} */ basename) => /^\.wafpickle-\d+$/.test(basename) },
];

/**
 * Subset of always-ignored that can never be included, even if listed in `files`.
 */
const hardIgnored = new Set(['.git', '.npmrc', 'node_modules', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb']);

/**
 * @typedef {import('@niceties/logger').Logger} Logger
 */

/**
 * @typedef {Object} PackageJson
 * @property {Object.<string, string>} [scripts]
 * @property {Object.<string, string>} [devDependencies]
 * @property {string} [packageManager]
 * @property {string} [main]
 * @property {string|Object.<string, string>} [bin]
 * @property {Array<string>} [files]
 * @property {Record<string, unknown>} [directories]
 * @property {Record<string, unknown>} [exports]
 * @property {Record<string, unknown>} [typesVersions]
 */

/**
 * @typedef {Object} PruneOptions
 * @property {string} profile
 * @property {string|boolean} flatten
 * @property {boolean} removeSourcemaps
 * @property {string|boolean} stripComments
 * @property {boolean} optimizeFiles
 * @property {boolean} cleanupFiles
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

    if (options.cleanupFiles) {
        await removeJunkFiles('.');
    } else if (options.flatten) {
        logger('cleanup is disabled, junk files may cause flatten to fail', 2);
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

    if (options.stripComments) {
        const typesToStrip = parseCommentTypes(/** @type {string | true} */ (options.stripComments));
        logger.update('stripping comments...');
        const allFiles = await walkDir('.', ['node_modules']);
        const jsFiles = allFiles.filter(isStrippableFile);
        const dtsMapFiles = allFiles.filter(f => f.endsWith('.d.ts.map'));

        // Strip comments from JS files and collect line maps keyed by file path.
        /** @type {Map<string, Int32Array>} */
        const lineMaps = new Map();
        for (const file of jsFiles) {
            const content = await readFile(file, 'utf8');
            const { result: stripped, lineMap } = stripCommentsWithLineMap(content, typesToStrip);
            if (lineMap) {
                await writeFile(file, stripped, 'utf8');
                lineMaps.set(path.normalize(file), lineMap);
            }
        }

        // Adjust .d.ts.map files that reference any of the stripped JS files.
        if (lineMaps.size > 0 && dtsMapFiles.length > 0) {
            for (const mapFile of dtsMapFiles) {
                const mapContent = await readFile(mapFile, 'utf8');
                let map;
                try {
                    map = JSON.parse(mapContent);
                } catch {
                    continue;
                }
                if (map.version !== 3 || !Array.isArray(map.sources)) continue;

                const mapDir = path.dirname(mapFile) || '.';
                let adjusted = false;
                for (let si = 0; si < map.sources.length; si++) {
                    const resolved = path.normalize(path.join(mapDir, map.sourceRoot || '', map.sources[si]));
                    const lineMap = lineMaps.get(resolved);
                    if (lineMap) {
                        adjustSourcemapLineMappings(map, si, lineMap);
                        adjusted = true;
                    }
                }
                if (adjusted) {
                    await writeFile(mapFile, `${JSON.stringify(map, null, '\t')}\n`, 'utf8');
                }
            }
        }
    }

    if (pkg.files && Array.isArray(pkg.files) && options.optimizeFiles) {
        const filterFiles = getAlwaysIncludedFiles(pkg);

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
                ((dirname !== '' && dirname !== '.') || !alwaysIncludedBasenames.includes(basenameWithoutExtension))
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

    if (pkg.files && Array.isArray(pkg.files) && options.cleanupFiles) {
        await cleanupDir(pkg, logger);
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

    /** @type {Map<string, string>} maps new path -> old path */
    const movedFiles = new Map();

    for (const [, info] of distDirInfo) {
        for (const file of info.files) {
            const relativePath = path.relative(info.relativeDistDir, file);
            newFiles.push(relativePath);
            movedFiles.set(relativePath, file);
            renamePromises.push(rename(file, relativePath));
        }
    }

    await Promise.all(renamePromises);

    // adjust sourcemap paths for explicit flatten only
    // (automatic flatten is safe because the common prefix is derived from package.json references)
    if (typeof flatten === 'string') {
        // build reverse map: normalized old path -> new path
        // so we can fix sources that point to files which themselves moved
        /** @type {Map<string, string>} */
        const oldToNew = new Map();
        for (const [newPath, oldPath] of movedFiles) {
            oldToNew.set(path.normalize(oldPath), newPath);
        }

        const sourcemapFiles = newFiles.filter(f => f.endsWith('.map'));
        for (const newMapPath of sourcemapFiles) {
            const oldMapPath = movedFiles.get(newMapPath);
            if (oldMapPath) {
                await adjustSourcemapPaths(newMapPath, oldMapPath, oldToNew);
            }
        }
    }

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
 * Adjusts the `sources` (and `sourceRoot`) in a v3 sourcemap file after it has been moved.
 * Resolves each source against the old location, then makes it relative to the new location.
 * If a source target was itself moved during flatten, the new location is used instead.
 * @param {string} newMapPath - The new path of the .map file (relative to project root).
 * @param {string} oldMapPath - The old path of the .map file (relative to project root).
 * @param {Map<string, string>} oldToNew - Map from normalized old file paths to their new paths.
 */
async function adjustSourcemapPaths(newMapPath, oldMapPath, oldToNew) {
    const content = await readFile(newMapPath, 'utf8');

    let map;
    try {
        map = JSON.parse(content);
    } catch {
        return; // not valid JSON, skip
    }

    if (map.version !== 3 || !Array.isArray(map.sources)) {
        return;
    }

    const oldDir = path.dirname(oldMapPath) || '.';
    const newDir = path.dirname(newMapPath) || '.';
    const sourceRoot = map.sourceRoot || '';

    map.sources = map.sources.map((/** @type {string} */ source) => {
        // Resolve source against old map location (incorporating sourceRoot)
        const resolved = path.normalize(path.join(oldDir, sourceRoot, source));
        // If the resolved source was itself moved, use its new location
        const effective = oldToNew.get(resolved) ?? resolved;
        // Make relative to new map location
        const newRelative = path.relative(newDir, effective);
        // Sourcemaps always use forward slashes
        return newRelative.split(path.sep).join('/');
    });

    // sourceRoot has been incorporated into the individual source paths
    if (map.sourceRoot !== undefined) {
        delete map.sourceRoot;
    }

    await writeFile(newMapPath, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
}

/**
 * @param {string} parent
 * @param {string} child
 * @returns {boolean}
 */
function isSubDirectory(parent, child) {
    const rel = path.relative(parent, child);
    return rel !== '' && !rel.startsWith('..');
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

/**
 * Returns the list of files always included by npm for a given package.
 * This includes `package.json`, the `main` entry, and all `bin` entries.
 * @param {PackageJson} pkg
 * @returns {string[]}
 */
function getAlwaysIncludedFiles(pkg) {
    const files = [...alwaysIncludedExact];
    if (pkg.main && typeof pkg.main === 'string') {
        files.push(normalizePath(pkg.main));
    }
    if (pkg.bin) {
        if (typeof pkg.bin === 'string') {
            files.push(normalizePath(pkg.bin));
        }
        if (typeof pkg.bin === 'object' && pkg.bin !== null) {
            files.push(...Object.values(pkg.bin).map(normalizePath));
        }
    }
    return files;
}

/**
 * Checks whether a file or directory name matches the always-ignored patterns.
 * @param {string} basename - The basename of the file or directory.
 * @returns {boolean}
 */
function isAlwaysIgnored(basename) {
    if (alwaysIgnored.includes(basename)) {
        return true;
    }
    return alwaysIgnoredPatterns.some(pattern => pattern.test(basename));
}

/**
 * Recursively removes junk files (always-ignored by npm) from a directory tree.
 * @param {string} dir
 */
async function removeJunkFiles(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (hardIgnored.has(entry.name)) {
            continue;
        }
        const fullPath = path.join(dir, entry.name);
        if (isAlwaysIgnored(entry.name)) {
            await rm(fullPath, { recursive: true, force: true });
        } else if (entry.isDirectory()) {
            await removeJunkFiles(fullPath);
        }
    }
}

/**
 * Checks whether a root-level file is always included by npm (case-insensitive basename match).
 * @param {string} file - The file path relative to the package root.
 * @returns {boolean}
 */
function isAlwaysIncludedByBasename(file) {
    const dir = path.dirname(file);
    if (dir !== '' && dir !== '.') {
        return false;
    }
    const basenameWithoutExtension = path.basename(file, path.extname(file)).toUpperCase();
    return alwaysIncludedBasenames.includes(basenameWithoutExtension);
}

/**
 * Removes files from the working directory that are not included in the `files` array
 * or the always-included list, then drops the `files` array from package.json.
 * @param {PackageJson} pkg
 * @param {Logger} logger
 */
async function cleanupDir(pkg, logger) {
    logger.update('cleaning up files...');

    const alwaysIncludedFiles = getAlwaysIncludedFiles(pkg);
    const filesEntries = /** @type {string[]} */ (pkg.files).map(normalizePath);

    const entries = await readdir('.');

    for (const entry of entries) {
        if (hardIgnored.has(entry)) {
            continue;
        }

        const normalized = normalizePath(entry);

        // check if matched by files entries (exact or parent directory)
        if (filesEntries.some(f => normalized === f || normalized.startsWith(`${f}/`))) {
            continue;
        }

        // check if any files entry is under this directory
        if (filesEntries.some(f => f.startsWith(`${normalized}/`))) {
            // need to recurse into this directory for granular cleanup
            await cleanupSubDir(normalized, filesEntries, alwaysIncludedFiles);
            continue;
        }

        // check if always-included by exact path
        if (alwaysIncludedFiles.includes(normalized)) {
            continue;
        }

        // check if always-included by basename (root level)
        if (isAlwaysIncludedByBasename(normalized)) {
            continue;
        }

        // not matched - remove
        await rm(entry, { recursive: true, force: true });
    }

    pkg.files = undefined;
}

/**
 * Recursively cleans up a subdirectory, keeping only files matched by the files entries
 * or always-included files.
 * @param {string} dir
 * @param {string[]} filesEntries
 * @param {string[]} alwaysIncludedFiles
 */
async function cleanupSubDir(dir, filesEntries, alwaysIncludedFiles) {
    const entries = await readdir(dir);

    for (const entry of entries) {
        if (hardIgnored.has(entry)) {
            continue;
        }

        const fullPath = path.join(dir, entry);

        const normalized = normalizePath(fullPath);

        // check if matched by files entries
        if (filesEntries.some(f => normalized === f || normalized.startsWith(`${f}/`))) {
            continue;
        }

        // check if any files entry is under this path
        if (filesEntries.some(f => f.startsWith(`${normalized}/`))) {
            await cleanupSubDir(normalized, filesEntries, alwaysIncludedFiles);
            continue;
        }

        // check if always-included by exact path
        if (alwaysIncludedFiles.includes(normalized)) {
            continue;
        }

        // not matched - remove
        await rm(fullPath, { recursive: true, force: true });
    }

    // remove the directory if it's now empty
    const remaining = await readdir(dir);
    if (remaining.length === 0) {
        await rm(dir, { recursive: true, force: true });
    }
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
