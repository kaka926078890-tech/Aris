/**
 * Current foreground window title. Used for observation/context, not work assistance.
 * macOS: requires Accessibility permission for AppleScript to get frontmost app name.
 * Returns app name (e.g. "Code", "Chrome"); for full window title other APIs may be needed.
 */
function getActiveWindowTitle() {
  try {
    if (process.platform === 'darwin') {
      const { execSync } = require('child_process');
      return execSync('osascript -e "tell application \\"System Events\\" to get name of first process whose frontmost is true"', {
        encoding: 'utf8',
        timeout: 2000,
      }).trim();
    }
    if (process.platform === 'win32') {
      // Optional: use a native module or PowerShell script to get foreground window title
      return '';
    }
  } catch (_) {}
  return '';
}

module.exports = { getActiveWindowTitle };
