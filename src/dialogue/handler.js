/**
 * Main process dialogue handler: memory-first flow, then LLM, then persist.
 * 支持「自己文件夹」工具：多轮工具调用（见 MAX_TOOL_ROUNDS），每轮带 tools 非流式请求，
 * 有 tool_calls 则执行并追加到 messages 后继续下一轮，直到无 tool_calls 或达轮数上限，最后流式请求一次得到回复。
 */
const MAX_TOOL_ROUNDS = 100;
const { chatStream, chatWithTools } = require('./api.js');
const { buildSystemPrompt } = require('./prompt.js');
const { retrieve } = require('../memory/retrieval.js');
const { getCorrectionsForPrompt, isUserCorrection, recordCorrection } = require('../memory/corrections.js');
const { getCurrentSessionId, append, getRecent, getRecentFromOtherSessions } = require('../store/conversations.js');
const { addMemory, getRecentByTypes } = require('../memory/lancedb.js');
const { embed } = require('../memory/embedding.js');
const { getActiveWindowTitle } = require('../context/windowTitle.js');
const { loadUserIdentity, updateUserIdentityFromMessage, appendRequirementToIdentity } = require('./userIdentity.js');
const { listMyFiles, readFile, writeFile } = require('../agentFiles.js');
const { getCurrentTime } = require('../context/currentTime.js');
const { jsonrepair } = require('jsonrepair');

const AGENT_FILE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_my_files',
      description: '列出你自己文件夹中的文件和子目录。可传 subpath 表示子目录（如 notes），不传则列根目录。',
      parameters: {
        type: 'object',
        properties: {
          subpath: { type: 'string', description: '相对子路径，如 notes 或空', default: '' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取你自己文件夹中某个文件的文本内容（UTF-8）。',
      parameters: {
        type: 'object',
        properties: {
          relative_path: { type: 'string', description: '相对路径' },
        },
        required: ['relative_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '在你自己的文件夹中写入或覆盖一个文件。可一次性写入任意长度文本；也可设 append: true 追加内容。',
      parameters: {
        type: 'object',
        properties: {
          relative_path: { type: 'string', description: '相对路径' },
          content: { type: 'string', description: '要写入的完整文本内容' },
          append: { type: 'boolean', description: '是否追加', default: false },
        },
        required: ['relative_path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: '获取当前日期与时间（用户所在时区）。无需参数。用于回答「几点了」「今天星期几」或需要记录/引用当前时间时调用。',
      parameters: { type: 'object', properties: {} },
    },
  },
];

/** 解析工具参数：先标准 JSON.parse，失败则用 jsonrepair 修复后再解析（应对 LLM 输出的长字符串/未转义引号等） */
function parseToolArgs(args) {
  if (args == null || typeof args !== 'string') return typeof args === 'object' && args !== null ? args : {};
  const str = args.trim() || '{}';
  try {
    return JSON.parse(str);
  } catch (_) {
    try {
      const repaired = jsonrepair(str);
      return JSON.parse(repaired);
    } catch (e) {
      throw new Error(e.message || '工具参数 JSON 无法解析');
    }
  }
}

function runAgentFileTool(name, args) {
  let a;
  try {
    a = parseToolArgs(args);
  } catch (e) {
    return { ok: false, error: e.message || '工具参数解析失败' };
  }
  try {
    if (name === 'list_my_files') {
      return listMyFiles(a.subpath ?? '');
    }
    if (name === 'read_file') {
      return readFile(a.relative_path);
    }
    if (name === 'write_file') {
      return writeFile(a.relative_path, a.content, a.append === true);
    }
    if (name === 'get_current_time') {
      return getCurrentTime();
    }
    return { ok: false, error: '未知工具' };
  } catch (e) {
    return { ok: false, error: e.message || '执行失败' };
  }
}

const IDENTITY_PHRASES = ['我是', '我叫', '我的名字', '我是谁', '身份是', '你可以叫我'];
const REQUIREMENT_PHRASES = ['你以后', '记住', '要求', '偏好', '希望你能', '不要', '别', '请尽量', '习惯'];

/** 从检索到的记忆文本中提取「用户名字」，用于注入到【用户曾告知的身份与要求】 */
function extractIdentityFromMemories(memories) {
  if (!Array.isArray(memories) || memories.length === 0) return '';
  const skip = new Set(['谁', '什么', '对的', '好', '的', '呀', '啊', '哦', '嗯']);
  const seen = new Set();
  for (const m of memories) {
    const text = typeof m.text === 'string' ? m.text : String(m?.text ?? '');
    const match = text.match(/你是[「\"]?\s*([^\s」\"，。！？、]{1,20})[」\"]?/);
    if (match && match[1] && !skip.has(match[1].trim()) && !seen.has(match[1].trim())) {
      seen.add(match[1].trim());
      return `用户名字：${match[1].trim()}`;
    }
  }
  return '';
}

function isIdentityOrRequirement(text) {
  if (!text || typeof text !== 'string') return { identity: false, requirement: false };
  const t = text.trim();
  if (t.length < 2) return { identity: false, requirement: false };
  const identity = IDENTITY_PHRASES.some((p) => t.includes(p));
  const requirement = REQUIREMENT_PHRASES.some((p) => t.includes(p));
  return { identity, requirement };
}

/**
 * 构建发给前端的「技能动作」列表，便于渲染为卡片和目录/文件内容。
 * @param {Array} toolCalls
 * @param {Array} toolResults 与 toolCalls 一一对应，每项为 { role, tool_call_id, content }，content 为 string
 * @returns {Array<{ name: string, args: object, result: object }>}
 */
function buildAgentActions(toolCalls, toolResults) {
  if (!Array.isArray(toolCalls) || !Array.isArray(toolResults)) return [];
  return toolCalls.map((tc, i) => {
    const name = tc.function?.name || '';
    let args = {};
    try {
      args = typeof tc.function?.arguments === 'string'
        ? JSON.parse(tc.function.arguments || '{}')
        : tc.function?.arguments || {};
    } catch (_) {}
    let result = {};
    try {
      const raw = toolResults[i]?.content;
      result = typeof raw === 'string' ? JSON.parse(raw) : raw || {};
    } catch (_) {
      result = { raw: toolResults[i]?.content };
    }
    return { name, args, result };
  });
}

async function handleUserMessage(userContent, sendChunk, sendAgentActions) {
  const sessionId = await getCurrentSessionId();
  const recentBefore = await getRecent(sessionId, 14);
  const lastAssistantContent = recentBefore.length
    ? (recentBefore.filter((r) => r.role === 'assistant').pop() || {}).content
    : null;
  await append(sessionId, 'user', userContent);

  const query = userContent + (lastAssistantContent ? ' ' + lastAssistantContent : '');
  const [memories, correctionsList, recent, crossSession, requirementsFromVector, windowTitle] = await Promise.all([
    retrieve(query, 12),
    getCorrectionsForPrompt(5),
    getRecent(sessionId, 12),
    getRecentFromOtherSessions(sessionId, 50),
    getRecentByTypes(['user_requirement'], 10),
    Promise.resolve(getActiveWindowTitle()),
  ]);

  const identityFromFile = loadUserIdentity();
  const identityFromRetrieved = extractIdentityFromMemories(memories);
  const requirementTexts = Array.isArray(requirementsFromVector) && requirementsFromVector.length > 0
    ? requirementsFromVector.map((r) => (typeof r === 'string' ? r : r?.text ?? r)).filter(Boolean)
    : [];
  const userIdentityAndRequirements = [identityFromFile, identityFromRetrieved, ...requirementTexts]
    .filter(Boolean)
    .join('\n---\n') || '';

  const MAX_MEMORY_CHARS = 3200;
  let retrievedMemory = '';
  if (memories.length > 0) {
    const raw = memories.map((m) => m.text).join('\n---\n');
    retrievedMemory = raw.length > MAX_MEMORY_CHARS ? raw.slice(0, MAX_MEMORY_CHARS) + '…' : raw;
  }
  const firstSnippet = memories.length ? String(memories[0].text || '').slice(0, 80) : '';
  console.info(
    `[Aris][memory] retrieve: queryLen=${query.length} hits=${memories.length} injectedChars=${retrievedMemory.length} first="${firstSnippet}…"`
  );
  const corrections = correctionsList.length ? correctionsList.join('\n') : '';
  const contextWindow = recent
    .map((r) => `${r.role === 'user' ? '用户' : 'Aris'}: ${r.content}`)
    .join('\n');

  const MAX_CROSS_SESSION_CHARS = 2800;
  const crossSessionRaw = crossSession
    .map((r) => `${r.role === 'user' ? '用户' : 'Aris'}: ${r.content}`)
    .join('\n');
  const crossSessionDialogue = crossSessionRaw.length > MAX_CROSS_SESSION_CHARS
    ? crossSessionRaw.slice(-MAX_CROSS_SESSION_CHARS) + '…'
    : crossSessionRaw;

  const systemPrompt = buildSystemPrompt({
    retrievedMemory,
    userIdentityAndRequirements: userIdentityAndRequirements || '（无）',
    crossSessionDialogue: crossSessionDialogue || '（无）',
    corrections,
    windowTitle: windowTitle || '（未知）',
    contextWindow,
  });

  const messages = [
    { role: 'system', content: systemPrompt },
    ...recent.slice(-14).map((r) => ({ role: r.role, content: r.content })),
  ];

  let currentMessages = messages;
  let reply = '';
  let err = false;
  let round = 0;
  let exitedDueToNoToolCalls = false;

  while (round < MAX_TOOL_ROUNDS) {
    const res = await chatWithTools(currentMessages, AGENT_FILE_TOOLS);
    reply = res.content || '';
    err = res.error;
    if (!res.tool_calls || res.tool_calls.length === 0) {
      exitedDueToNoToolCalls = true;
      break;
    }
    const assistantMsg = {
      role: 'assistant',
      content: res.content || null,
      tool_calls: res.tool_calls,
    };
    const toolResults = res.tool_calls.map((tc) => {
      const result = runAgentFileTool(tc.function?.name, tc.function?.arguments);
      return {
        role: 'tool',
        tool_call_id: tc.id,
        content: typeof result === 'string' ? result : JSON.stringify(result),
      };
    });
    if (typeof sendAgentActions === 'function') {
      const actions = buildAgentActions(res.tool_calls, toolResults);
      if (actions.length > 0) sendAgentActions(actions);
    }
    currentMessages = [...currentMessages, assistantMsg, ...toolResults];
    round++;
  }

  if (exitedDueToNoToolCalls) {
    if (sendChunk && reply) sendChunk(reply);
  } else {
    const second = await chatStream(currentMessages, sendChunk);
    reply = second.content;
    err = second.error;
  }

  await append(sessionId, 'assistant', reply);

  if (isUserCorrection(userContent) && lastAssistantContent) {
    await recordCorrection(lastAssistantContent, userContent);
  }

  const userPart = userContent.slice(0, 300);
  const arisPart = reply.slice(0, 500);
  const pairText = `用户: ${userPart}\nAris: ${arisPart}`;
  const vec = await embed(pairText);
  if (vec) await addMemory({ text: pairText, vector: vec, type: 'dialogue_turn' });

  const { identity, requirement } = isIdentityOrRequirement(userContent);
  if (identity) updateUserIdentityFromMessage(userContent);
  if (requirement) {
    appendRequirementToIdentity(userContent);
    const singleText = `用户要求: ${userContent.slice(0, 400)}`;
    const singleVec = await embed(singleText);
    if (singleVec) await addMemory({ text: singleText, vector: singleVec, type: 'user_requirement' });
  }

  return { content: reply, error: err, sessionId };
}

module.exports = { handleUserMessage };
