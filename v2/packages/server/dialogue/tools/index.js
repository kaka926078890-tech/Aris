const { RECORD_TOOLS, runRecordTool } = require('./record.js');
const { FILE_TOOLS, runFileTool } = require('./file.js');
const { MEMORY_TOOLS, runMemoryTool } = require('./memory.js');
const { TIME_TOOLS, runTimeTool } = require('./time.js');
const { GIT_TOOLS, runGitTool } = require('./git.js');
const { APP_TOOLS, runAppTool } = require('./app.js');
const { REPO_TOOLS, runRepoSearchTool } = require('./repo_search.js');

const BASE_TOOLS = [
  ...RECORD_TOOLS,
  ...FILE_TOOLS,
  ...REPO_TOOLS,
  ...MEMORY_TOOLS,
  ...APP_TOOLS,
  ...TIME_TOOLS,
  ...GIT_TOOLS,
];

function getTools() {
  return BASE_TOOLS;
}

function parseToolArgs(args) {
  if (args == null) return {};
  const str = typeof args === 'string' ? args.trim() || '{}' : JSON.stringify(args || {});
  try {
    return JSON.parse(str);
  } catch (_) {
    try {
      const { jsonrepair } = require('jsonrepair');
      return JSON.parse(jsonrepair(str));
    } catch (e) {
      return {};
    }
  }
}

async function runTool(name, args, context) {
  const a = parseToolArgs(args);
  if (RECORD_TOOLS.some((t) => t.function.name === name)) {
    return runRecordTool(name, a, context);
  }
  if (FILE_TOOLS.some((t) => t.function.name === name)) {
    return runFileTool(name, a, context);
  }
  if (REPO_TOOLS.some((t) => t.function.name === name)) {
    return runRepoSearchTool(name, a);
  }
  if (MEMORY_TOOLS.some((t) => t.function.name === name)) {
    return runMemoryTool(name, a);
  }
  if (TIME_TOOLS.some((t) => t.function.name === name)) {
    return runTimeTool(name);
  }
  if (GIT_TOOLS.some((t) => t.function.name === name)) {
    return runGitTool(name, a);
  }
  if (APP_TOOLS.some((t) => t.function.name === name)) {
    return runAppTool(name, a);
  }
  return { ok: false, error: 'Unknown tool: ' + name };
}

module.exports = { getTools, runTool };
