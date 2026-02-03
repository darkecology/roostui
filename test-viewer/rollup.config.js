import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { join } from 'path';

export default {
  input: join('test-viewer', 'test-viewer.js'),
  output: {
    file: join('test-viewer', 'dist', 'test-viewer.js'),
    format: 'iife',
    sourcemap: true,
  },
  plugins: [
    resolve({ browser: true }),
    commonjs(),
  ],
};
