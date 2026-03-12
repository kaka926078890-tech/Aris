const esbuild = require('esbuild');
const path = require('path');

const root = path.join(__dirname, '..');
esbuild.build({
  entryPoints: [path.join(root, 'src', 'renderer', 'main.js')],
  bundle: true,
  outfile: path.join(root, 'src', 'renderer', 'dist', 'bundle.js'),
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
}).catch(() => process.exit(1));
