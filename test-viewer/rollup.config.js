import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import { join } from 'path';

export default {
  input: join('test-viewer', 'test-viewer.js'),
  output: {
    file: join('test-viewer', 'dist', 'test-viewer.js'),
    format: 'iife',
    sourcemap: true,
  },
  plugins: [
    replace({ 'process.env.NODE_ENV': JSON.stringify('production'), preventAssignment: true }),
    resolve({ browser: true }),
    commonjs(),
  ],
};
