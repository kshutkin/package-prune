/**
 * Extracts all file path references from a package.json object.
 *
 * Includes string export targets at any depth in subpath maps, conditions, and arrays.
 *
 * @param {Record<string, unknown>} pkg
 * @returns {unknown[]}
 */
export function extractReferences(pkg) {
    /** @type {unknown[]} */
    const result = [];

    // bin — included as-is (string or object; non-strings are skipped by consuming code)
    if (pkg.bin !== undefined && pkg.bin !== null) {
        result.push(pkg.bin);
    }

    // bin.* — all values when bin is an object
    if (typeof pkg.bin === 'object' && pkg.bin !== null && !Array.isArray(pkg.bin)) {
        for (const value of Object.values(pkg.bin)) {
            result.push(value);
        }
    }

    // simple top-level fields: main, module, style, unpkg, umd, types, typings
    const topLevelFields = ['main', 'module', 'style', 'unpkg', 'umd', 'types', 'typings'];
    for (const field of topLevelFields) {
        if (pkg[field] !== undefined && pkg[field] !== null) {
            result.push(pkg[field]);
        }
    }

    // Export targets can be strings, conditional/subpath objects, or fallback arrays.
    /** @param {unknown} target
     * @param {boolean} [localOnly]
     */
    function collectExportReferences(target, localOnly = false) {
        if (typeof target === 'string') {
            if (!localOnly || target.startsWith('./')) result.push(target);
        } else if (Array.isArray(target)) {
            for (const item of target) {
                collectExportReferences(item, localOnly);
            }
        } else if (typeof target === 'object' && target !== null) {
            for (const value of Object.values(target)) {
                collectExportReferences(value, localOnly);
            }
        }
    }
    collectExportReferences(pkg.exports);
    collectExportReferences(pkg.imports, true);

    if (typeof pkg.browser === 'string') {
        result.push(pkg.browser);
    } else if (pkg.browser && typeof pkg.browser === 'object' && !Array.isArray(pkg.browser)) {
        for (const [key, value] of Object.entries(pkg.browser)) {
            collectExportReferences([key, value], true);
        }
    }

    // typesVersions.*.* — 2 levels of wildcard, arrays are flattened
    if (typeof pkg.typesVersions === 'object' && pkg.typesVersions !== null && !Array.isArray(pkg.typesVersions)) {
        for (const level1 of Object.values(pkg.typesVersions)) {
            if (typeof level1 === 'object' && level1 !== null && !Array.isArray(level1)) {
                for (const level2 of Object.values(/** @type {Record<string, unknown>} */ (level1))) {
                    if (Array.isArray(level2)) {
                        for (const item of level2) {
                            result.push(item);
                        }
                    } else {
                        result.push(level2);
                    }
                }
            }
        }
    }

    // directories.bin
    if (typeof pkg.directories === 'object' && pkg.directories !== null) {
        const dirs = /** @type {Record<string, unknown>} */ (pkg.directories);
        if (dirs.bin !== undefined && dirs.bin !== null) {
            result.push(dirs.bin);
        }
    }

    return result;
}
