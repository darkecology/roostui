import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import { uglify } from 'rollup-plugin-uglify';
import { join } from 'path';
import babel from '@rollup/plugin-babel';

const PRODUCTION = process.env['BUILD'] === 'production';

export default {
  input: join('js', 'vis.js'),
  output: {
    file: join('dist', PRODUCTION ? 'roostui.min.js' : 'roostui.js'),
    format: 'iife',
    sourcemap: true,
    strict: true,
  },
  plugins: [
    PRODUCTION && uglify(),
    babel({
      exclude: 'node_modules/**',
      babelHelpers: 'runtime',
    }),
    resolve({ browser: true }),
    commonjs(),
    replace({
      'process.env.NODE_ENV': JSON.stringify(PRODUCTION ? 'production' : 'development'),
      preventAssignment: true,
    }),
  ].filter(Boolean),
};
