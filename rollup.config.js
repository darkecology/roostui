import sourcemaps from 'rollup-plugin-sourcemaps';
import buble from '@rollup/plugin-buble';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import builtins from 'rollup-plugin-node-builtins';
import globals from 'rollup-plugin-node-globals';
import replace from 'rollup-plugin-replace';
import { uglify } from 'rollup-plugin-uglify';
import {join} from 'path';
import babel from '@rollup/plugin-babel';

const PRODUCTION = process.env['BUILD'] === 'production';

export default [{
  input: join('js', 'vis.js'),
  output: {
    file: join('dist', PRODUCTION ? 'demo.min.js' : 'demo.js'),
    format: 'iife',
    sourcemap: true,
    strict: true,
    globals: {
      'aws-sdk': 'AWS',
      'nexrad-js': 'nexrad',
	  'jquery': '$'
  },
  },
  external: ['aws-sdk', 'nexrad-js'],
  plugins: [
    sourcemaps(),
    PRODUCTION && uglify(),
	babel({
      exclude: 'node_modules/**',
	  babelHelpers: 'runtime'
    }),
    resolve({
      // use "module" field for ES6 module if possible
      module: true, // Default: true

      // use "jsnext:main" if possible
      // – see https://github.com/rollup/rollup/wiki/jsnext:main
      jsnext: true,  // Default: false

      // use "main" field or index.js, even if it's not an ES6 module
      // (needs to be converted from CommonJS to ES6
      // – see https://github.com/rollup/rollup-plugin-commonjs
      main: true,  // Default: true

      // some package.json files have a `browser` field which
      // specifies alternative files to load for people bundling
      // for the browser. If that's you, use this option, otherwise
      // pkg.browser will be ignored
      browser: true  // Default: false
    }),
    commonjs({
      namedExports: {
        'react-dom': ['render'],
        'react': ['Component', 'createElement']
      }
    }),
	
    builtins(),
    replace({
      // Production for production builds.
      'process.env.NODE_ENV': JSON.stringify(PRODUCTION ? 'production' : 'development' )
    }),
    globals()
  ].filter(Boolean)
},

{

  input: join('js', 'Viewer.js'),
  output: {
    file: join('dist', PRODUCTION ? 'demo2.min.js' : 'demo2.js'),
    format: 'iife',
    sourcemap: true,
    strict: true,
  },
  plugins: [
    sourcemaps(),
    PRODUCTION && uglify(),
	babel({
      exclude: 'node_modules/**',
	    babelHelpers: 'runtime'
    }),
    resolve({
      // use "module" field for ES6 module if possible
      module: true, // Default: true

      // use "jsnext:main" if possible
      // – see https://github.com/rollup/rollup/wiki/jsnext:main
      jsnext: true,  // Default: false

      // use "main" field or index.js, even if it's not an ES6 module
      // (needs to be converted from CommonJS to ES6
      // – see https://github.com/rollup/rollup-plugin-commonjs
      main: true,  // Default: true

      // some package.json files have a `browser` field which
      // specifies alternative files to load for people bundling
      // for the browser. If that's you, use this option, otherwise
      // pkg.browser will be ignored
      browser: true  // Default: false
    }),
    commonjs({
      namedExports: {
        'react-dom': ['render'],
        'react': ['Component', 'createElement']
      }
    }),
	
    builtins(),
    replace({
      // Production for production builds.
      'process.env.NODE_ENV': JSON.stringify(PRODUCTION ? 'production' : 'development' )
    }),
    globals()
  ].filter(Boolean)




}


];
