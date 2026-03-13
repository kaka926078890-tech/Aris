const path = require('path');

const V2_ROOT = path.join(__dirname, '..', '..');
const RENDERER_INDEX = path.join(V2_ROOT, 'apps', 'renderer', 'dist', 'index.html');
const PRELOAD_SCRIPT = path.join(__dirname, 'preload.js');

module.exports = { V2_ROOT, RENDERER_INDEX, PRELOAD_SCRIPT };
