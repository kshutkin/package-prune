#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createLogger } from '@niceties/logger';
import { parseArgsPlus } from '@niceties/node-parseargs-plus';
import { camelCase } from '@niceties/node-parseargs-plus/camel-case';
import { customValue } from '@niceties/node-parseargs-plus/custom-value';
import { help } from '@niceties/node-parseargs-plus/help';
import { optionalValue } from '@niceties/node-parseargs-plus/optional-value';
import { readPackageJson } from '@niceties/node-parseargs-plus/package-info';

import { prunePkg } from './prune.js';

/**
 * Parse a multi-value string option: split by commas, trim, and filter empty strings.
 * Empty result (from bare --flag usage) signals "use defaults" → true.
 * @param {string[]} values
 * @returns {true | string[]}
 */
function parseMultiString(values) {
    const items = values
        .flatMap(v => v.split(','))
        .map(s => s.trim())
        .filter(Boolean);
    return items.length ? items : true;
}

const logger = createLogger();
logger.update('preparing..');

try {
    const myPkgData = await readPackageJson(import.meta.url);

    logger.update('');

    const { values } = parseArgsPlus(
        {
            ...myPkgData,
            allowNegative: true,
            options: {
                profile: {
                    type: 'string',
                    description: 'profile to use',
                    default: 'library',
                },
                flatten: {
                    type: /** @type {(values: string[]) => true | string[]} */ (parseMultiString),
                    multiple: true,
                    optionalValue: true,
                    description: 'flatten package files (omit value to auto-detect, or specify directories)',
                },
                removeSourcemaps: {
                    type: 'boolean',
                    description: 'remove sourcemaps',
                    default: false,
                },
                stripComments: {
                    type: /** @type {(values: string[]) => true | string[]} */ (parseMultiString),
                    multiple: true,
                    optionalValue: true,
                    description: 'strip comments (omit value for defaults, or specify types: jsdoc, license, regular, annotation)',
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
        [camelCase, customValue, optionalValue, help]
    );

    const flags = {
        ...values,
        flatten: values.flatten ?? false,
        stripComments: values.stripComments ?? false,
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
