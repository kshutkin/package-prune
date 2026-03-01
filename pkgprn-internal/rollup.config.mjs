import path from 'node:path';

import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import clean from '@rollup-extras/plugin-clean';
import externals from '@rollup-extras/plugin-externals';

const input = 'src/index.js';

const dest = 'dist';

const reported = new Set();

const plugins = [
    clean(),
    externals({
        external: (id, external, importer) => {
            const internals = ['pkgprn', '@niceties'];
            if (internals.includes(id) || internals.some(internal => id.startsWith(`${internal}/`))) {
                console.log('inlining', id);
                return false;
            }
            if (!importer || id.startsWith('node:') || (!id.startsWith('.') && !id.startsWith('/'))) {
                return external;
            }
            const relative = path.relative('.', path.resolve(path.dirname(importer), id));
            if (relative.startsWith('../pkgprn/')) {
                if (!reported.has(relative)) {
                    console.log('inlining', relative);
                    reported.add(relative);
                }
                return false;
            }
            if (internals.some(internal => relative.includes(`node_modules/${internal}/`))) {
                if (!reported.has(relative)) {
                    console.log('inlining', relative);
                    reported.add(relative);
                }
                return false;
            }
            return external;
        },
    }),
    resolve({
        exportConditions: ['default', 'require'],
    }),
    json(),
    commonjs(),
];

export default {
    input,

    output: {
        format: 'esm',
        dir: dest,
        entryFileNames: '[name].mjs',
        chunkFileNames: '[name].[hash].mjs',
    },

    plugins,
};
