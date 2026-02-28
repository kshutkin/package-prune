/**
 * Extracts all file path references from a package.json object.
 *
 * Replaces the jsonata expression:
 *   [bin, bin.*, main, module, unpkg, umd, types, typings, exports[].*.*, typesVersions.*.*, directories.bin]
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

    // simple top-level fields: main, module, unpkg, umd, types, typings
    const topLevelFields = ['main', 'module', 'unpkg', 'umd', 'types', 'typings'];
    for (const field of topLevelFields) {
        if (pkg[field] !== undefined && pkg[field] !== null) {
            result.push(pkg[field]);
        }
    }

    // exports[].*.* — navigate exactly 2 levels deep into the exports object.
    // Level 1: values of the exports object (e.g. exports["."], exports["./second"])
    // Level 2: values of each level-1 value (if it's an object)
    // String values at level 1 are skipped (jsonata wildcard on string yields nothing).
    // Array values at level 2 are flattened.
    if (typeof pkg.exports === 'object' && pkg.exports !== null && !Array.isArray(pkg.exports)) {
        for (const level1 of Object.values(pkg.exports)) {
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
