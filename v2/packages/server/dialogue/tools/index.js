const { RECORD_TOOLS, runRecordTool } = require('./record.js');
const { FILE_TOOLS, runFileTool } = require('./file.js');
const { MEMORY_TOOLS, runMemoryTool } = require('./memory.js');
const { TIME_TOOLS, runTimeTool } = require('./time.js');

const ALL_TOOLS = [...RECORD_TOOLS, ...FILE_TOOLS, ...MEMORY_TOOLS, ...TIME_TOOLS];

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

async function runTool(name, args) {
  const a = parseToolArgs(args);
  if (RECORD_TOOLS.some((t) => t.function.name === name)) {
    return runRecordTool(name, a);
  }
  if (FILE_TOOLS.some((t) => t.function.name === name)) {
    return runFileTool(name, a);
  }
  if (MEMORY_TOOLS.some((t) => t.function.name === name)) {
    return runMemoryTool(name, a);
  }
  if (TIME_TOOLS.some((t) => t.function.name === name)) {
    return runTimeTool(name);
  }
  return { ok: false, error: 'Unknown tool: ' + name };
}

module.exports = { ALL_TOOLS, runTool, parseToolArgs };
