/**
 * 在 apps/renderer 下执行 npm install，供 postinstall 跨平台使用（Windows / macOS / Linux）。
 */
const path = require('path');
const { execSync } = require('child_process');

const rendererDir = path.join(__dirname, '..', 'apps', 'renderer');
try {
  execSync('npm install', {
    cwd: rendererDir,
    stdio: 'inherit',
    shell: true,
  });
} catch (e) {
  console.warn('[aris-v2] apps/renderer install skipped or failed:', e.message || e);
}
