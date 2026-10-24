import { access, lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { escape as escapeGlob, Minimatch } from 'minimatch';

import { extractReferences } from './extract-references.js';
import { filterNpmIgnore } from './npmignore.js';
import { removeSourceMappingComments } from './sourcemap-comments.js';
import { adjustSourcemapPositions, isStrippableFile, parseCommentTypes, stripCommentsWithLineMap } from './strip-comments.js';

/**
 * Files always included by npm regardless of the `files` array.
 * README & LICENSE/LICENCE are matched case-insensitively before any dot suffix.
 */
const alwaysIncludedExact = ['package.json'];
const alwaysIncludedBasenames = ['README', 'LICENSE', 'LICENCE'];

/**
 * Files/directories always ignored by npm by default.
 */
const alwaysIgnored = ['.DS_Store', '.hg', '.lock-wscript', '.svn', 'CVS', 'config.gypi', 'npm-debug.log'];

/**
 * Glob-like patterns for always-ignored files.
 * Shared by junk cleanup and npm ignore selection.
 */
const alwaysIgnoredPatterns = ['*.orig', '.*.swp', '._*', '.wafpickle-+([0-9])'];
const junkMatchers = alwaysIgnoredPatterns.map(pattern => new Minimatch(pattern, { dot: true }));

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
 * @property {string} [style]
 * @property {string|Record<string, string|false>} [browser]
 * @property {boolean|string[]} [sideEffects]
 * @property {string|Object.<string, string>} [bin]
 * @property {Array<string>} [files]
 * @property {Record<string, unknown>} [directories]
 * @property {string|Array<unknown>|Record<string, unknown>|null} [exports]
 * @property {Record<string, unknown>} [imports]
 * @property {Record<string, unknown>} [typesVersions]
 */

/**
 * @typedef {Object} PruneOptions
 * @property {string} profile
 * @property {true|string[]|false} flatten
 * @property {boolean} removeSourcemaps
 * @property {true|string[]|false} stripComments
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

    const typesToStrip = options.stripComments ? parseCommentTypes(options.stripComments) : undefined;

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

    const explicitFiles = [
        ...(pkg.files ?? []).map(file => (file === './' ? file : normalizePath(file))),
        ...(await getAlwaysIncludedFiles(pkg)),
    ];
    const inventory = await walkDir('.', ['node_modules', '.git'], false);
    const hasIgnoreFiles = inventory.some(file => ['.npmignore', '.gitignore'].includes(path.basename(file)));
    const rootWhitelist = pkg.files?.length === 1 && pkg.files[0] === './' ? pkg.files : undefined;
    /** @type {Set<string> | undefined} */
    let publishFiles;
    // Without cleanup, flattening must leave unpublished files in place even
    // when the whitelist is the only source of publish rules.
    if (hasIgnoreFiles || (pkg.files && options.flatten && !options.cleanupFiles)) {
        const required = [
            ...explicitFiles,
            ...inventory.filter(file => isAlwaysIncludedByBasename(file) || (rootWhitelist && path.dirname(file) === '.')),
        ];
        const selectedFiles = await filterNpmIgnore(inventory, {
            files: pkg.files,
            required,
            hardIgnored,
            defaults: [...alwaysIgnored, ...alwaysIgnoredPatterns, '.npmignore', '.gitignore'],
        });
        publishFiles = new Set(selectedFiles);
        if (hasIgnoreFiles) {
            pkg.files = selectedFiles;
            explicitFiles.push(...selectedFiles);
        }
    }
    if (!hasIgnoreFiles && pkg.files && Array.isArray(pkg.files)) {
        pkg.files = expandFileGlobs(pkg.files, inventory);
    }

    if (options.cleanupFiles) {
        await removeJunkFiles('.', explicitFiles, [...(pkg.files ?? []).map(normalizePath), ...explicitFiles]);
    } else if (options.flatten) {
        logger('cleanup is disabled, junk files may cause flatten to fail', 2);
    }

    if (pkg.files && Array.isArray(pkg.files) && options.cleanupFiles) {
        await cleanupDir(pkg, logger);
    }

    if (hasIgnoreFiles && rootWhitelist) pkg.files = rootWhitelist;

    if (options.flatten) {
        await flatten(pkg, options.flatten, logger, options.removeSourcemaps, publishFiles);
    }

    if (options.removeSourcemaps) {
        const allFiles = (await walkDir('.', ['node_modules', '.git'], false)).filter(file => !publishFiles || publishFiles.has(file));
        const sourceMaps = allFiles.filter(file => file.endsWith('.map'));
        const companions = new Set(sourceMaps.map(file => file.slice(0, -4)));
        for (const file of allFiles) {
            if (!/\.(?:[cm]?[jt]sx?|css)$/.test(file) && !companions.has(file)) continue;
            const content = await readFile(file, 'utf8');
            const stripped = removeSourceMappingComments(content, file);
            if (stripped !== content) await writeFile(file, stripped, 'utf8');
        }
        for (const sourceMap of sourceMaps) await rm(sourceMap);
        // remove deleted .map files from pkg.files (e.g. after flatten added them individually)
        if (pkg.files && sourceMaps.length > 0) {
            const removedMaps = new Set(sourceMaps.map(f => normalizePath(path.relative('.', f))));
            pkg.files = pkg.files.filter(f => !removedMaps.has(normalizePath(f)));
        }
    }

    if (typesToStrip) {
        logger.update('stripping comments...');
        const allFiles = (await walkDir('.', ['node_modules', '.git'], false)).filter(file => !publishFiles || publishFiles.has(file));
        const jsFiles = allFiles.filter(isStrippableFile);
        const declarationMaps = allFiles.filter(f => /\.d\.[cm]?ts\.map$/.test(f));
        const mapFiles = new Set(allFiles.filter(f => f.endsWith('.map')));

        // Reuse the same position maps for generated and declaration mappings.
        /** @type {Map<string, {mapPosition: import('./strip-comments.js').PositionMapper, source: string}>} */
        const positionMaps = new Map();
        for (const file of jsFiles) {
            const content = await readFile(file, 'utf8');
            const { result: stripped, mapPosition } = stripCommentsWithLineMap(content, typesToStrip);
            if (mapPosition) {
                await writeFile(file, stripped, 'utf8');
                positionMaps.set(path.normalize(file), { mapPosition, source: stripped });
                const mapFile = `${file}.map`;
                const map = mapFiles.has(mapFile) ? await readSourcemap(mapFile) : undefined;
                if (map) {
                    const previous = map.mappings;
                    adjustSourcemapPositions(map, mapPosition);
                    if (map.mappings !== previous) await writeFile(mapFile, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
                }
            }
        }

        // Adjust declaration maps that reference any of the stripped JS files.
        if (positionMaps.size > 0 && declarationMaps.length > 0) {
            for (const mapFile of declarationMaps) {
                const map = await readSourcemap(mapFile);
                if (!map || !Array.isArray(map.sources)) continue;

                let adjusted = false;
                for (let si = 0; si < map.sources.length; si++) {
                    const resolved = resolveSourceMapSource(map.sources[si], map.sourceRoot, mapFile);
                    if (resolved?.protocol !== 'file:') continue;
                    const edit = positionMaps.get(path.relative('.', fileURLToPath(resolved)));
                    if (edit) {
                        adjustSourcemapPositions(map, edit.mapPosition, si);
                        if (typeof map.sourcesContent?.[si] === 'string') map.sourcesContent[si] = edit.source;
                        adjusted = true;
                    }
                }
                if (adjusted) {
                    await writeFile(mapFile, `${JSON.stringify(map, null, '\t')}\n`, 'utf8');
                }
            }
        }
    }

    if (pkg.files && Array.isArray(pkg.files) && options.optimizeFiles && !options.cleanupFiles) {
        // npm does not implicitly include main when it starts with './'.
        const filterFiles = (await getAlwaysIncludedFiles(pkg)).filter(
            file => !pkg.main?.startsWith('./') || file !== normalizePath(pkg.main)
        );

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
            const files = depthToFiles.get(depth) ?? [];
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
                if (!(await isDirectory(dirname))) continue;
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
            return !filterFiles.includes(fileNormalized) && !isAlwaysIncludedByBasename(fileNormalized);
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
    }

    // Keep overrides that npm would otherwise replace with its default ignore rules.
    const preserveFiles =
        hasIgnoreFiles || pkg.files?.some(file => file === './' || normalizePath(file).split(path.sep).some(isAlwaysIgnored));
    if (options.cleanupFiles && !preserveFiles) {
        pkg.files = undefined;
    }
    if (pkg.files) {
        pkg.files = [
            ...new Set(
                await Promise.all(
                    pkg.files.map(async file => {
                        if (file === './') return file;
                        const literal = (hasIgnoreFiles ? normalizePath(file) : file).split(path.sep).join('/');
                        let escaped = escapeGlob(literal);
                        // npm cannot stat escaped directories to infer their recursive contents.
                        if (escaped !== literal && (await isDirectory(file))) escaped += '/**';
                        return hasIgnoreFiles || file.startsWith('!') ? `./${escaped}` : escaped;
                    })
                )
            ),
        ];
    }
}

/**
 * Flattens the dist directory and updates package.json references.
 * @param {PackageJson} pkg
 * @param {true|string[]} flatten
 * @param {Logger} logger
 * @param {boolean} [skipSourcemapAdjust] - skip sourcemap adjustment (e.g. when sourcemaps will be removed)
 * @param {Set<string>} [publishFiles] - Resolved publish selection, updated as files move.
 */
async function flatten(pkg, flatten, logger, skipSourcemapAdjust, publishFiles) {
    // find out where is the dist folder

    const allReferences = extractReferences(pkg);

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
            const wildcard = cleanedSegments.findIndex(segment => segment.includes('*'));
            if (wildcard !== -1) cleanedSegments.length = wildcard;
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
        distDirs = flatten.map(d => normalizePath(d.trim())).filter(Boolean);
    }

    distDirs = [...new Set(distDirs)];
    for (const [index, dir] of distDirs.entries()) {
        if (distDirs.slice(index + 1).some(other => isSubDirectory(dir, other) || isSubDirectory(other, dir))) {
            throw new Error('cannot flatten overlapping source directories');
        }
    }
    logger.update(`flattening ${distDirs.join(', ')}...`);

    // collect files from all dist directories

    /** @type {Map<string, { distDir: string, relativeDistDir: string, files: string[] }>} */
    const distDirInfo = new Map();

    for (const distDir of distDirs) {
        const relativeDistDir = `./${distDir}`;
        if (!(await isDirectory(relativeDistDir)) || !isSubDirectory(await realpath('.'), await realpath(relativeDistDir))) {
            throw new Error(`cannot flatten outside the package or through a symlink: ${distDir}`);
        }
        const files = (await walkDir(relativeDistDir)).filter(file => !publishFiles || publishFiles.has(normalizePath(file)));
        distDirInfo.set(distDir, { distDir, relativeDistDir, files });
    }

    // check for conflicts: files already existing in root AND cross-directory collisions

    /** @type {Map<string, string>} */
    const destinationToSource = new Map();
    /** @type {Set<string>} */
    const destinationDirs = new Set();
    const existsPromises = [];
    /** @type {string[]} */
    const existsKeys = [];

    for (const [distDir, info] of distDirInfo) {
        for (const file of info.files) {
            if (!skipSourcemapAdjust && file.endsWith('.map') && (await lstat(file)).isSymbolicLink()) {
                throw new Error(`cannot rebase a symlink sourcemap: ${file}`);
            }
            const relativePath = path.relative(info.relativeDistDir, file);

            // check for cross-directory conflicts
            if (destinationToSource.has(relativePath)) {
                const otherDir = destinationToSource.get(relativePath);
                throw new Error(`cannot flatten because '${relativePath}' exists in both '${otherDir}' and '${distDir}'`);
            }
            if (destinationDirs.has(relativePath)) {
                throw new Error(`cannot flatten because a destination is both a file and a directory: ${relativePath}`);
            }
            for (let parent = path.dirname(relativePath); parent !== '.'; parent = path.dirname(parent)) {
                if (destinationToSource.has(parent)) {
                    throw new Error(`cannot flatten because a destination is both a file and a directory: ${parent}`);
                }
                destinationDirs.add(parent);
            }
            destinationToSource.set(relativePath, distDir);

            // check if file already exists in root
            existsKeys.push(relativePath);
            existsPromises.push(isExists(relativePath));
        }
    }

    for (const dir of destinationDirs) {
        if ((await isExists(dir)) && !(await isDirectory(dir))) {
            throw new Error(`cannot flatten through a non-directory or symlink destination: ${dir}`);
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
            if (!pkg.bin) {
                const files = await getDirectoryBinFiles(distDir);
                pkg.bin = Object.fromEntries(files.map(file => [path.basename(file), file]));
                allReferences.push(...files);
            }
            delete pkg.directories.bin;
            if (Object.keys(pkg.directories).length === 0) {
                pkg.directories = undefined;
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
            if (publishFiles) {
                publishFiles.delete(normalizePath(file));
                publishFiles.add(relativePath);
            }
            renamePromises.push(rename(file, relativePath));
        }
    }

    await Promise.all(renamePromises);

    // Rebase moved maps and unmoved maps that reference moved sources.
    if (!skipSourcemapAdjust) {
        // build reverse map: normalized old path -> new path
        // so we can fix sources that point to files which themselves moved
        /** @type {Map<string, string>} */
        const oldToNew = new Map();
        for (const [newPath, oldPath] of movedFiles) {
            oldToNew.set(path.normalize(oldPath), newPath);
        }

        const sourcemapFiles = (await walkDir('.', ['node_modules', '.git'], false)).filter(
            file => file.endsWith('.map') && (!publishFiles || publishFiles.has(file))
        );
        for (const newMapPath of sourcemapFiles) {
            await adjustSourcemapPaths(newMapPath, movedFiles.get(newMapPath) ?? newMapPath, oldToNew);
        }
    }

    // clean up empty source directories
    /** @type {string[]} */
    const cleanedDirs = [];
    for (const [, info] of distDirInfo) {
        let cleanedDir = info.relativeDistDir;
        while ((await isDirectory(cleanedDir)) && (await isEmptyDir(cleanedDir))) {
            await rm(cleanedDir, { recursive: true, force: true });
            cleanedDirs.push(normalizePath(cleanedDir));
            const parentDir = path.dirname(cleanedDir);
            if (parentDir === '.') {
                break;
            }
            cleanedDir = parentDir;
        }
    }

    const allReferencesSet = new Set(allReferences);

    // update package.json - replace each distDir prefix in references
    const prefixes = distDirs.map(dir => `${dir}${path.sep}`);
    /** @param {string} value */
    const updatePath = value => {
        const normalized = normalizePath(value);
        for (const prefix of prefixes) {
            if (normalized.startsWith(prefix)) {
                return (value.startsWith('./') ? './' : '') + normalized.slice(prefix.length);
            }
        }
        return value;
    };
    /** @param {string} value */
    const updateReference = value => (allReferencesSet.has(value) ? updatePath(value) : value);
    const browser = pkg.browser;
    const sideEffects = pkg.sideEffects;
    const pkgClone = cloneAndUpdate(pkg, updateReference);
    Object.assign(pkg, pkgClone);
    if (Array.isArray(sideEffects)) {
        pkg.sideEffects = [
            ...new Set(
                sideEffects.flatMap(pattern => {
                    const updated = updatePath(pattern);
                    // Keep rewritten patterns anchored even when they lose their last slash.
                    if (updated !== pattern) return [`./${normalizePath(updated).split(path.sep).join('/')}`];
                    const relative = pattern.replace(/^(?:\.\/)+/, '');
                    const matcher = new Minimatch(relative.includes('/') ? relative : `**/${relative}`, {
                        dot: true,
                        nonegate: true,
                        nocomment: true,
                    });
                    const patterns = [pattern];
                    // Broader patterns may still cover files outside the flattened roots.
                    for (const [newPath, oldPath] of movedFiles) {
                        if (
                            matcher.match(normalizePath(oldPath).split(path.sep).join('/')) &&
                            !matcher.match(newPath.split(path.sep).join('/'))
                        ) {
                            patterns.push(`./${escapeGlob(newPath.split(path.sep).join('/'), { windowsPathsNoEscape: true })}`);
                        }
                    }
                    return patterns;
                })
            ),
        ];
    }
    if (browser && typeof browser === 'object') {
        pkg.browser = Object.fromEntries(
            Object.entries(browser).map(([key, value]) => [
                key.startsWith('./') ? updateReference(key) : key,
                typeof value === 'string' && value.startsWith('./') ? updateReference(value) : value,
            ])
        );
    }

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
    const references = extractReferences(pkg)
        .filter(reference => typeof reference === 'string')
        .map(normalizePath);
    for (const key of exports) {
        if (!key.startsWith('./') || !isSubDirectory('.', key)) {
            continue;
        }
        const isDir = await isDirectory(key);
        if (isDir) {
            const pkgPath = path.join(key, 'package.json');
            const pkgExists = await isExists(pkgPath);
            // ensure nothing else is in the directory
            const files = await readdir(key);
            if (files.length === 1 && pkgExists) {
                const referenced = references.some(
                    reference =>
                        reference === normalizePath(key) ||
                        reference === pkgPath ||
                        new Minimatch(reference, { dot: true, nonegate: true, nocomment: true }).match(pkgPath)
                );
                if (!referenced) await rm(key, { recursive: true, force: true });
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

/** @param {string} file */
async function readSourcemap(file) {
    const content = await readFile(file, 'utf8');
    try {
        const map = JSON.parse(content);
        return map?.version === 3 && typeof map.mappings === 'string' ? map : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Adjusts `sources` (and `sourceRoot`) in a v3 sourcemap when the map or a source moves.
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

    if (map?.version !== 3 || !Array.isArray(map.sources)) {
        return;
    }

    const newDir = path.dirname(newMapPath) || '.';
    let changed = newMapPath !== oldMapPath;
    const sources = map.sources.map((/** @type {string | null} */ source) => {
        const resolved = resolveSourceMapSource(source, map.sourceRoot, oldMapPath);
        if (resolved === null) return null;
        if (resolved.protocol !== 'file:') return resolved.href;
        const oldRelative = path.relative('.', fileURLToPath(resolved));
        if (oldToNew.has(oldRelative)) changed = true;
        const effective = oldToNew.get(oldRelative) ?? oldRelative;
        return path.relative(newDir, effective).split(path.sep).map(encodeURIComponent).join('/');
    });
    if (!changed) return;
    map.sources = sources;

    // sourceRoot has been incorporated into the individual source paths
    if (map.sourceRoot !== undefined) {
        delete map.sourceRoot;
    }

    await writeFile(newMapPath, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
}

/**
 * @param {string | null} source
 * @param {string | null | undefined} sourceRoot
 * @param {string} mapFile
 */
function resolveSourceMapSource(source, sourceRoot, mapFile) {
    if (source === null) return null;
    const prefix = sourceRoot ? `${sourceRoot.replace(/\/$/, '')}/` : '';
    return new URL(prefix + source, pathToFileURL(path.resolve(mapFile)));
}

/**
 * @param {string} parent
 * @param {string} child
 * @returns {boolean}
 */
function isSubDirectory(parent, child) {
    const rel = path.relative(parent, child);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/**
 * @param {string} dir
 * @returns {Promise<boolean>}
 */
async function isEmptyDir(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory() || !(await isEmptyDir(path.join(dir, entry.name)))) {
            return false;
        }
    }
    return true;
}

/**
 * @param {string} file
 * @returns {Promise<boolean>}
 */
async function isDirectory(file) {
    try {
        const fileStat = await lstat(file);
        return fileStat.isDirectory();
    } catch (e) {
        if (typeof e === 'object' && e != null && 'code' in e && e.code === 'ENOENT') {
            return false;
        }
        throw e;
    }
}

/**
 * @param {string} dir
 * @param {Array<string>} [ignoreDirs=[]]
 * @param {boolean} [includeSymlinks=true]
 * @returns {Promise<Array<string>>}
 */
async function walkDir(dir, ignoreDirs = [], includeSymlinks = true) {
    const entries = await readdir(dir, { withFileTypes: true });
    /**
     * @type {string[]}
     */
    const files = [];

    // Process files first
    for (const entry of entries) {
        if (!entry.isDirectory() && (includeSymlinks || !entry.isSymbolicLink())) {
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
                const childFiles = await walkDir(childPath, ignoreDirs, includeSymlinks);
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
 * @returns {Promise<string[]>}
 */
async function getAlwaysIncludedFiles(pkg) {
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
    } else if (typeof pkg.directories?.bin === 'string') {
        files.push(...(await getDirectoryBinFiles(pkg.directories.bin)));
    }
    return files;
}

/**
 * Discover executable paths declared by directories.bin without following symlinks.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function getDirectoryBinFiles(dir) {
    const binDir = normalizePath(dir);
    if (!isSubDirectory('.', binDir) || !(await isDirectory(binDir)) || !isSubDirectory(await realpath('.'), await realpath(binDir))) {
        return [];
    }
    const files = await walkDir(binDir, ['node_modules', '.git'], false);
    return files.filter(
        file =>
            !path
                .relative(binDir, file)
                .split(path.sep)
                .some(part => part.startsWith('.'))
    );
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
    return junkMatchers.some(pattern => pattern.match(basename));
}

/**
 * Recursively removes junk files (always-ignored by npm) from a directory tree.
 * @param {string} dir
 * @param {string[]} explicitFiles - Literal whitelist entries and always-included paths.
 * @param {string[]} selectedFiles - Expanded paths whose parent directories must survive.
 */
async function removeJunkFiles(dir, explicitFiles, selectedFiles) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (hardIgnored.has(entry.name)) {
            continue;
        }
        const fullPath = path.join(dir, entry.name);
        const included =
            explicitFiles.includes(fullPath) ||
            (dir === '.' && explicitFiles.includes('./')) ||
            selectedFiles.some(file => file.startsWith(`${fullPath}/`)) ||
            isAlwaysIncludedByBasename(fullPath);
        if (isAlwaysIgnored(entry.name) && !included) {
            await rm(fullPath, { recursive: true, force: true });
        } else if (entry.isDirectory()) {
            await removeJunkFiles(fullPath, explicitFiles, selectedFiles);
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
    const basenameWithoutExtension = path.basename(file).split('.')[0].toUpperCase();
    return alwaysIncludedBasenames.includes(basenameWithoutExtension);
}

/**
 * Resolve npm-style whitelist rules in order, including dotfiles and directory contents.
 * @param {string[]} files
 * @param {string[]} inventory
 * @returns {string[]}
 */
function expandFileGlobs(files, inventory) {
    const rules = files.map(entry => {
        const exclude = entry.startsWith('!');
        const pattern = (exclude ? entry.slice(1) : entry).replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');
        const options = { dot: true, nonegate: true, nocomment: true, magicalBraces: true };
        return {
            exclude,
            matcher: new Minimatch(pattern, options),
            contents: new Minimatch(`${pattern}/**`, options),
        };
    });
    // Literal whitelist entries already preserve directory and npmignore semantics.
    if (rules.every(rule => !rule.exclude && !rule.matcher.hasMagic() && !rule.matcher.pattern.includes('\\'))) return files;

    return inventory.filter(file => {
        const candidate = normalizePath(file).split(path.sep).join('/');
        let included = false;
        for (const rule of rules) {
            if (rule.matcher.match(candidate) || rule.contents.match(candidate)) included = !rule.exclude;
        }
        return included;
    });
}

/**
 * Removes files from the working directory that are not included in the `files` array
 * or the always-included list, then drops the `files` array from package.json.
 * @param {PackageJson} pkg
 * @param {Logger} logger
 */
async function cleanupDir(pkg, logger) {
    logger.update('cleaning up files...');

    // npm's explicit root entry includes everything and overrides root ignore rules.
    if (pkg.files?.includes('./')) return;

    const alwaysIncludedFiles = await getAlwaysIncludedFiles(pkg);
    const filesEntries = [.../** @type {string[]} */ (pkg.files).map(normalizePath), ...alwaysIncludedFiles];

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
        if (filesEntries.some(f => f.startsWith(`${normalized}/`)) && (await isDirectory(normalized))) {
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
        if (filesEntries.some(f => f.startsWith(`${normalized}/`)) && (await isDirectory(normalized))) {
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
