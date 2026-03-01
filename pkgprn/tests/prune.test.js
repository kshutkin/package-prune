import assert from 'node:assert';
import cd from 'node:child_process';
import fs from 'node:fs/promises';
import process from 'node:process';
import test, { after, describe } from 'node:test';
import { parseArgs, promisify } from 'node:util';

import { filesToString, stringToFiles } from 'cli-test-helper';

import tests from './tests.json' with { type: 'json' };

const exec = promisify(cd.exec);

const dir = './tests/tmp';

/**
 * @typedef {Object} TestCase
 * @property {number} id
 * @property {string} name
 * @property {string} input
 * @property {string} output
 * @property {string} stdout
 * @property {string} stderr
 * @property {string} [args]
 * @property {number} [exitCode]
 */

/**
 * @typedef {Record<string, TestCase[]>} TestSuites
 */

/**
 * @typedef {Object} ExecResult
 * @property {number} [code]
 * @property {string} [stdout]
 * @property {string} [stderr]
 */

/**
 * @typedef {Object} ExecError
 * @property {number} code
 * @property {string} [stdout]
 * @property {string} [stderr]
 */

const args = parseArgs({
    options: {
        update: {
            type: 'boolean',
            short: 'u',
            default: false,
        },
        capture: {
            type: 'string',
            short: 'c',
        },
        export: {
            type: 'string',
            short: 'e',
        },
        result: {
            type: 'string',
            short: 'r',
        },
    },
}).values;

/** @type {TestCase[]} */
const allTestCases = Object.entries(/** @type {TestSuites} */ (tests)).flatMap(entry =>
    entry[1].map(testCase => /** @type {TestCase} */ (testCase))
);

if ('capture' in args) {
    const capture = Number(args.capture) || allTestCases.reduce((max, testCase) => Math.max(max, testCase.id), 0) + 1;
    let testCase = allTestCases.find(testCase => testCase.id === capture);
    if (!testCase) {
        /** @type {TestCase} */
        testCase = {
            id: capture,
            name: '',
            input: '',
            output: '',
            stdout: '',
            stderr: '',
        };
        const testsObj = /** @type {Record<string, TestCase[]>} */ (tests);
        if (!testsObj.capture) {
            testsObj.capture = [];
        }
        testsObj.capture.push(testCase);
    }
    testCase.input = await captureFiles();
    await writeTestCases();
    process.exit(0);
}

if ('export' in args) {
    const exportN = Number(args.export);
    const testCase = allTestCases.find(testCase => testCase.id === exportN);
    if (!testCase) {
        console.error(`Test case not found: ${JSON.stringify(exportN)}`);
        process.exit(1);
    }
    await exportFiles(testCase);
    process.exit(0);
}

if ('result' in args) {
    const exportN = Number(args.result);
    const testCase = allTestCases.find(testCase => testCase.id === exportN);
    if (!testCase) {
        console.error(`Test case not found: ${JSON.stringify(exportN)}`);
        process.exit(1);
    }
    await exportFiles(testCase, true);
    process.exit(0);
}

for (const [suiteName, suiteTestCases] of Object.entries(tests)) {
    describe(suiteName, () => {
        for (const testCase of suiteTestCases) {
            const tc = /** @type {TestCase} */ (testCase);
            test(tc.name, async () => {
                await exportFiles(tc);
                /** @type {ExecResult | ExecError} */
                let result;
                try {
                    result = await exec(`cd ${dir}; node ../../src/index.js ${tc.args || ''}`);
                } catch (e) {
                    result = /** @type {ExecError} */ (e);
                }

                const actualOutput = await captureFiles();

                if (args.update) {
                    tc.output = actualOutput;
                    tc.exitCode = result?.code || 0;
                    tc.stdout = replaceTime(result?.stdout || '');
                    tc.stderr = result?.stderr || '';
                    assert.ok(true);
                } else {
                    assert.strictEqual(actualOutput, tc.output);
                    assert.strictEqual(result?.code || 0, tc.exitCode || 0);
                    assert.strictEqual(replaceTime(result?.stdout || ''), tc.stdout);
                    assert.strictEqual(result?.stderr || '', tc.stderr);
                }
            });
        }
    });
}

after(async () => {
    await cleanDir();
    if (args.update) {
        await writeTestCases();
    }
});

/**
 * @param {TestCase} testCase
 * @param {boolean} [output=false]
 */
async function exportFiles(testCase, output = false) {
    await cleanDir();
    await fs.mkdir(dir, { recursive: true });
    await stringToFiles(output ? testCase.output : testCase.input, dir);
}

/**
 * @returns {Promise<string>}
 */
async function captureFiles() {
    return await filesToString(dir, ['node_modules']);
}

/**
 * @returns {Promise<void>}
 */
function cleanDir() {
    return fs.rm(dir, { recursive: true, force: true });
}

/**
 * @param {string} str
 * @returns {string}
 */
function replaceTime(str) {
    if (!str) {
        return str;
    }
    return str.replaceAll(/in (\d+\.?\d+)m?s$/gm, 'in XXX');
}

/**
 * @returns {Promise<void>}
 */
function writeTestCases() {
    return fs.writeFile('./tests/tests.json', JSON.stringify(tests, null, 4));
}
