import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import { uglify } from 'rollup-plugin-uglify';
import { join } from 'path';

const PRODUCTION = process.env['BUILD'] === 'production';

export default {
  input: join('viewer', 'viewer.js'),
  output: {
    file: join('viewer', 'dist', PRODUCTION ? 'viewer.min.js' : 'viewer.js'),
    format: 'iife',
    sourcemap: true,
    strict: true,
  },
  plugins: [
    PRODUCTION && uglify(),
    replace({ 'process.env.NODE_ENV': JSON.stringify(PRODUCTION ? 'production' : 'development'), preventAssignment: true }),
    resolve({ browser: true }),
    commonjs(),
  ].filter(Boolean),
};
