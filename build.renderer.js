const esbuild = require('esbuild');
const path = require('path');

esbuild.build({
  entryPoints: [path.join(__dirname, 'src', 'renderer', 'main.js')],
  bundle: true,
  outfile: path.join(__dirname, 'src', 'renderer', 'dist', 'bundle.js'),
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
}).catch(() => process.exit(1));
