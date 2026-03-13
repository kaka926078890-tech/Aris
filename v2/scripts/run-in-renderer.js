/**
 * 在 apps/renderer 下执行 npm 脚本，跨平台（Windows / macOS / Linux）。
 * 用法: node scripts/run-in-renderer.js <script-name>
 */
const path = require('path');
const { execSync } = require('child_process');

const rendererDir = path.join(__dirname, '..', 'apps', 'renderer');
const script = process.argv[2] || 'dev';
execSync(`npm run ${script}`, {
  cwd: rendererDir,
  stdio: 'inherit',
  shell: true,
});
