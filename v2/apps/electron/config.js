const fs = require('fs');
const path = require('path');

const V2_ROOT = path.join(__dirname, '..', '..');
/** Vite 构建产物（若存在且比源码新则优先，否则用源码，避免本地改了 index.html 却仍加载陈旧 dist） */
const RENDERER_INDEX_DIST = path.join(V2_ROOT, 'apps', 'renderer', 'dist', 'index.html');
const RENDERER_INDEX_SRC = path.join(V2_ROOT, 'apps', 'renderer', 'index.html');
const PRELOAD_SCRIPT = path.join(__dirname, 'preload.js');

function resolveRendererIndexPath() {
  try {
    const hasDist = fs.existsSync(RENDERER_INDEX_DIST);
    const hasSrc = fs.existsSync(RENDERER_INDEX_SRC);
    if (hasSrc && hasDist) {
      return fs.statSync(RENDERER_INDEX_SRC).mtimeMs >= fs.statSync(RENDERER_INDEX_DIST).mtimeMs
        ? RENDERER_INDEX_SRC
        : RENDERER_INDEX_DIST;
    }
    if (hasDist) return RENDERER_INDEX_DIST;
    return RENDERER_INDEX_SRC;
  } catch (_) {
    return fs.existsSync(RENDERER_INDEX_SRC) ? RENDERER_INDEX_SRC : RENDERER_INDEX_DIST;
  }
}

/** @deprecated 请用 resolveRendererIndexPath()；保留兼容旧引用 */
const RENDERER_INDEX = RENDERER_INDEX_DIST;

module.exports = {
  V2_ROOT,
  RENDERER_INDEX,
  RENDERER_INDEX_DIST,
  RENDERER_INDEX_SRC,
  PRELOAD_SCRIPT,
  resolveRendererIndexPath,
};
