#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLogger } from '@niceties/logger';
import { parseArgsPlus } from '@niceties/node-parseargs-plus';
import { camelCase } from '@niceties/node-parseargs-plus/camel-case';
import { help } from '@niceties/node-parseargs-plus/help';
import { optionalValue } from '@niceties/node-parseargs-plus/optional-value';

import { prunePkg } from './prune.js';

// globals
const __dirname = dirname(fileURLToPath(import.meta.url));

const logger = createLogger();
logger.update('preparing..');

try {
    const version = await getMyVersion();

    logger.update('');
    process.stdout.moveCursor?.(0, -1);

    const { values } = parseArgsPlus(
        {
            name: 'pkgprn',
            version: version ?? '<unknown>',
            description: 'prune devDependencies and redundant scripts from package.json',
            allowPositionals: true,
            allowNegative: true,
            options: {
                profile: {
                    type: 'string',
                    description: 'profile to use',
                    default: 'library',
                },
                flatten: {
                    type: 'string',
                    multiple: true,
                    optionalValue: true,
                    description: 'flatten package files (use "auto" for auto-detect, or specify directories)',
                },
                removeSourcemaps: {
                    type: 'boolean',
                    description: 'remove sourcemaps',
                    default: false,
                },
                stripComments: {
                    type: 'string',
                    multiple: true,
                    optionalValue: true,
                    description: 'strip comments: all (default), jsdoc, license, regular',
                },
                optimizeFiles: {
                    type: 'boolean',
                    description: 'optimize files array',
                    default: true,
                },
                cleanupFiles: {
                    type: 'boolean',
                    description: 'cleanup files not included in files array',
                    default: true,
                },
            },
        },
        [camelCase, optionalValue, help]
    );

    const flattenDirs = values.flatten
        ?.flatMap(v => v.split(','))
        .map(s => s.trim())
        .filter(Boolean);

    const flags = {
        ...values,
        flatten: flattenDirs?.includes('auto') || values.flatten?.includes('') ? true : flattenDirs?.length ? flattenDirs : false,
        stripComments: values.stripComments?.length ? values.stripComments.filter(Boolean).join(',') || 'all' : false,
    };

    const pkg = await readPackage('.');
    if (!pkg) {
        throw new Error('Could not read package.json');
    }
    await prunePkg(pkg, flags, logger);

    await writePackage(pkg);
} catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.finish(`Error: ${errorMessage}`, 3);
    process.exit(255);
}

/**
 * @returns {Promise<string>}
 */
async function getMyVersion() {
    const pkg = await readPackage(resolve(__dirname));

    return pkg && 'version' in pkg && typeof pkg.version === 'string' ? pkg.version : '<unknown>';
}

/**
 * @param {string} dir
 * @returns {Promise<import('./prune.js').PackageJson | undefined>}
 */
async function readPackage(dir) {
    const packageFileName = resolve(dir, 'package.json');
    try {
        const pkgFile = await readFile(packageFileName);
        return JSON.parse(pkgFile.toString());
    } catch {
        /**/
    }
}

/**
 * @param {import('./prune.js').PackageJson} pkg
 */
async function writePackage(pkg) {
    await writeFile('./package.json', `${JSON.stringify(pkg, null, 2)}\n`);
}
