#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cli } from 'cleye';

import { createLogger } from '@niceties/logger';

import { prunePkg } from './prune.js';

// globals
const __dirname = dirname(fileURLToPath(import.meta.url));

const logger = createLogger();
logger.update('preparing..');

try {
    const version = await getMyVersion();

    logger.update('');
    process.stdout.moveCursor?.(0, -1);

    const cliOptions = cli({
        name: 'pkgprn',
        version: version ?? '<unknown>',
        description: 'prune devDependencies and redundant scripts from package.json',
        flags: {
            profile: {
                type: String,
                description: 'profile to use',
                default: 'library',
            },
            flatten: {
                type: FlattenParam,
                description: 'flatten package files (comma-separated for multiple directories)',
                default: false,
            },
            removeSourcemaps: {
                type: Boolean,
                description: 'remove sourcemaps',
                default: false,
            },
            optimizeFiles: {
                type: Boolean,
                description: 'optimize files array',
                default: true,
            },
        },
    });

    const pkg = await readPackage('.');
    if (!pkg) {
        throw new Error('Could not read package.json');
    }
    await prunePkg(pkg, cliOptions.flags, logger);

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

/**
 * @param {string | false} value
 */
function FlattenParam(value) {
    if (value === '') {
        return true; // means auto
    }
    return value; // string
}
