/**
 * v2 Server 入口：供 Electron 主进程调用。
 */
const { handleUserMessage, getPromptPreview } = require('./dialogue/handler.js');
const { maybeProactiveMessage } = require('./dialogue/proactive.js');

module.exports = {
  handleUserMessage,
  getPromptPreview,
  maybeProactiveMessage,
};
