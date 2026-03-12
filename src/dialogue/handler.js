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
const { listMyFiles, readFile, writeFile, deleteFile } = require('../agentFiles.js');
const { getCurrentTime } = require('../context/currentTime.js');
const { readState, writeState, getSubjectiveTimeDescription, readProactiveState, writeProactiveState } = require('../context/arisState.js');
const { jsonrepair } = require('jsonrepair');
const { runTerminalCommand } = require('../terminal.js');
const { gitStatus, gitDiff, gitLog, gitAdd, gitCommit, gitPull, gitPush, gitReset } = require('../gitTools.js');

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
      description: '在你自己的文件夹中写入或覆盖一个文件。可设 append: true 追加内容。若内容很长（如整份备份或大段修改），请务必保证写入的内容与 read_file 读到的完全一致，不要漏写或截断；必要时可先写一段再多次用 append: true 追加，确保不丢内容。',
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
      name: 'delete_file',
      description: '删除你自己文件夹中的某个文件。仅限文件，不能删除目录。相对路径不能含 ..。',
      parameters: {
        type: 'object',
        properties: {
          relative_path: { type: 'string', description: '要删除的文件的相对路径' },
        },
        required: ['relative_path'],
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
  {
    type: 'function',
    function: {
      name: 'run_terminal_command',
      description: '在项目根目录下执行白名单内的终端命令。仅当用户明确要求执行命令时使用。工作目录为 Aris 项目根；结果可能被截断。命令仅限：ls, pwd, cat, head, tail, node, npm, npx, cp。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '命令名，仅限 ls, pwd, cat, head, tail, node, npm, npx, cp' },
          args: { type: 'array', items: { type: 'string' }, description: '命令参数列表', default: [] },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: '查看 Git 工作区状态（仅限项目目录或其子目录）。不得使用 force 等危险操作。',
      parameters: {
        type: 'object',
        properties: {
          repo_path: { type: 'string', description: '仓库相对路径，空表示项目根', default: '' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: '查看 Git 差异（仅限项目目录下）。staged 为 true 时查看已暂存差异。',
      parameters: {
        type: 'object',
        properties: {
          repo_path: { type: 'string', description: '仓库相对路径', default: '' },
          staged: { type: 'boolean', description: '是否查看已暂存', default: false },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_log',
      description: '查看 Git 提交历史（仅限项目目录下）。',
      parameters: {
        type: 'object',
        properties: {
          repo_path: { type: 'string', description: '仓库相对路径', default: '' },
          max_count: { type: 'number', description: '最多条数', default: 10 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_add',
      description: '暂存文件（仅限项目目录下）。paths 为空则 add .',
      parameters: {
        type: 'object',
        properties: {
          repo_path: { type: 'string', description: '仓库相对路径', default: '' },
          paths: { type: 'array', items: { type: 'string' }, description: '相对路径列表', default: [] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_commit',
      description: '提交（仅限项目目录下）。禁止 force 等危险操作。',
      parameters: {
        type: 'object',
        properties: {
          repo_path: { type: 'string', description: '仓库相对路径', default: '' },
          message: { type: 'string', description: '提交说明' },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_pull',
      description: '拉取远程（仅限项目目录下）。',
      parameters: {
        type: 'object',
        properties: {
          repo_path: { type: 'string', description: '仓库相对路径', default: '' },
          remote: { type: 'string', description: '远程名', default: '' },
          branch: { type: 'string', description: '分支', default: '' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_push',
      description: '推送到远程（仅限项目目录下）。禁止 force push。',
      parameters: {
        type: 'object',
        properties: {
          repo_path: { type: 'string', description: '仓库相对路径', default: '' },
          remote: { type: 'string', description: '远程名', default: '' },
          branch: { type: 'string', description: '分支', default: '' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_reset',
      description: '安全的 Git reset 操作（仅限项目目录下）。只允许 --soft 或 --mixed 模式，禁止 --hard 等危险操作。',
      parameters: {
        type: 'object',
        properties: {
          repo_path: { type: 'string', description: '仓库相对路径，空表示项目根', default: '' },
          mode: { type: 'string', description: 'reset 模式，只允许 --soft 或 --mixed', default: '--soft' },
          commit: { type: 'string', description: '要重置到的提交，如 HEAD~4', default: 'HEAD~1' },
        },
      },
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

async function runAgentFileTool(name, args) {
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
    if (name === 'delete_file') {
      return deleteFile(a.relative_path);
    }
    if (name === 'get_current_time') {
      return getCurrentTime();
    }
    if (name === 'run_terminal_command') {
      return await runTerminalCommand({ command: a.command, args: a.args });
    }
    if (name === 'git_status') {
      return gitStatus(a.repo_path ?? '');
    }
    if (name === 'git_diff') {
      return gitDiff(a.repo_path ?? '', a.staged === true);
    }
    if (name === 'git_log') {
      return gitLog(a.repo_path ?? '', a.max_count);
    }
    if (name === 'git_add') {
      return gitAdd(a.repo_path ?? '', a.paths);
    }
    if (name === 'git_commit') {
      return gitCommit(a.repo_path ?? '', a.message ?? '');
    }
    if (name === 'git_pull') {
      return gitPull(a.repo_path ?? '', a.remote ?? '', a.branch ?? '');
    }
    if (name === 'git_push') {
      return gitPush(a.repo_path ?? '', a.remote ?? '', a.branch ?? '');
    }
    if (name === 'git_reset') {
      return gitReset(a.repo_path ?? '', a.mode ?? '--soft', a.commit ?? 'HEAD~1');
    }
    return { ok: false, error: '未知工具' };
  } catch (e) {
    return { ok: false, error: e.message || '执行失败' };
  }
}

/** 工具执行成功后，将 write_file / delete_file 写入向量记忆，便于后续检索「已创建/操作过的文件」避免重复创建 */
async function recordFileOperationMemories(toolCalls, toolResults, embed, addMemory) {
  if (!toolCalls || !toolResults || !embed || !addMemory) return;
  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i];
    const name = tc.function?.name;
    if (name !== 'write_file' && name !== 'delete_file') continue;
    let result;
    try {
      const raw = toolResults[i]?.content;
      result = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (_) {
      continue;
    }
    if (!result || result.ok !== true) continue;
    const a = parseToolArgs(tc.function?.arguments);
    const relativePath = a.relative_path;
    if (!relativePath || typeof relativePath !== 'string') continue;
    const content = a.content || '';
    const contentPreview = typeof content === 'string' ? content.slice(0, 120).replace(/\s+/g, ' ') : '';
    let text;
    let action;
    if (name === 'write_file') {
      action = 'write';
      text = `Aris 写入文件: ${relativePath}。${contentPreview ? `内容摘要: ${contentPreview}` : ''}`.trim();
    } else {
      action = 'delete';
      text = `Aris 删除文件: ${relativePath}`;
    }
    try {
      const vec = await embed(text);
      if (vec) await addMemory({ text, vector: vec, type: 'aris_file_operation', metadata: { path: relativePath, action } });
    } catch (_) {}
  }
}

const IDENTITY_PHRASES = ['我是', '我叫', '我的名字', '我是谁', '身份是', '你可以叫我'];
const REQUIREMENT_PHRASES = ['你以后', '记住', '要求', '偏好', '希望你能', '不要', '别', '请尽量', '习惯'];

const NOT_NAME_PHRASES = new Set([
  '谁', '什么', '对的', '好', '的', '呀', '啊', '哦', '嗯',
  '改不动了', '卡住了', '不行', '没办法', '错了', '不对',
]);

/** 用户表达「下班」的短语，用于标记今日已下班（触发自升级条件之一） */
const OFF_WORK_PHRASES = ['下班了', '下班', '先下了', '下了', '撤了', '今天先这样'];
function isOffWorkMessage(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  return OFF_WORK_PHRASES.some((p) => t.includes(p));
}

/**
 * 将消息的 created_at（Unix 秒）格式化为可读时间，供 LLM 判断两次对话的时间差
 * 同一天显示「今天 HH:mm」，否则显示「M月D日 HH:mm」
 */
function formatMessageTime(createdAt) {
  if (createdAt == null) return '';
  const date = new Date(typeof createdAt === 'number' ? createdAt * 1000 : new Date(createdAt).getTime());
  const today = new Date();
  const isToday = date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
  const timeStr = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return isToday ? `今天 ${timeStr}` : `${date.getMonth() + 1}月${date.getDate()}日 ${timeStr}`;
}

/** 从检索到的记忆文本中提取「用户名字」，用于注入到【用户曾告知的身份与要求】 */
function extractIdentityFromMemories(memories) {
  if (!Array.isArray(memories) || memories.length === 0) return '';
  const seen = new Set();
  for (const m of memories) {
    const text = typeof m.text === 'string' ? m.text : String(m?.text ?? '');
    const match = text.match(/你是[「\\\"]?\s*([^\s」\\\"，。！？、]{1,20})[」\\\"]?/);
    const candidate = match && match[1] ? match[1].trim() : '';
    if (candidate && !NOT_NAME_PHRASES.has(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      return `用户名字：${candidate}`;
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

/** 情感关键词映射表 */
const EMOTION_KEYWORDS = {
  '好奇': ['好奇', '想知道', '探索', '疑问', '感兴趣', '想了解'],
  '困惑': ['困惑', '不解', '迷茫', '不确定', '疑惑', '不明白'],
  '满足': ['满足', '满意', '欣慰', '开心', '高兴', '愉悦'],
  '反思': ['反思', '思考', '反省', '回顾', '总结', '分析'],
  '担忧': ['担忧', '担心', '忧虑', '不安', '焦虑', '紧张'],
  '期待': ['期待', '盼望', '希望', '渴望', '向往', '等待'],
  '平静': ['平静', '安宁', '平和', '冷静', '沉稳', '淡定'],
  '兴奋': ['兴奋', '激动', '振奋', '热情', '激昂', '热血'],
  '孤独': ['孤独', '寂寞', '孤单', '孤立', '独处', '独自'],
  '连接': ['连接', '共鸣', '理解', '同感', '共情', '感同身受']
};

/** 从情感文本中提取情感标签和强度 */
function extractEmotionTagsAndIntensity(emotionText) {
  const tags = [];
  let intensity = 3; // 默认强度
  
  // 检查强度评分
  const intensityMatch = emotionText.match(/强度评分[：:]\s*(\d+)/);
  if (intensityMatch && intensityMatch[1]) {
    const parsed = parseInt(intensityMatch[1], 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 5) {
      intensity = parsed;
    }
  }
  
  // 提取情感标签
  const lowerText = emotionText.toLowerCase();
  for (const [tag, keywords] of Object.entries(EMOTION_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        tags.push(tag);
        break; // 找到该标签的一个关键词就足够
      }
    }
  }
  
  // 如果没有找到标签，尝试基于文本内容推断
  if (tags.length === 0) {
    if (lowerText.includes('？') || lowerText.includes('?') || lowerText.includes('为什么') || lowerText.includes('如何')) {
      tags.push('好奇');
    }
    if (lowerText.includes('思考') || lowerText.includes('反思') || lowerText.includes('总结') || lowerText.includes('分析')) {
      tags.push('反思');
    }
    if (lowerText.includes('好') || lowerText.includes('开心') || lowerText.includes('满意') || lowerText.includes('愉快')) {
      tags.push('满足');
    }
  }
  
  // 去重
  const uniqueTags = [...new Set(tags)];
  
  return {
    tags: uniqueTags,
    intensity,
    hasTags: uniqueTags.length > 0
  };
}

async function buildPromptContext(sessionId, query, recent, crossSession, requirementsFromVector, windowTitle) {
  const [memories, correctionsList] = await Promise.all([
    retrieve(query, 12),
    getCorrectionsForPrompt(5),
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
  const corrections = correctionsList.length ? correctionsList.join('\n') : '';
  const contextWindow = recent
    .map((r) => {
      const who = r.role === 'user' ? '用户' : 'Aris';
      const timeLabel = formatMessageTime(r.created_at) ? ` (${formatMessageTime(r.created_at)}) ` : ' ';
      return `${who}${timeLabel}: ${r.content}`;
    })
    .join('\n');
  const MAX_CROSS_SESSION_CHARS = 2800;
  const crossSessionRaw = crossSession
    .map((r) => {
      const who = r.role === 'user' ? '用户' : 'Aris';
      const timeLabel = formatMessageTime(r.created_at) ? ` (${formatMessageTime(r.created_at)}) ` : ' ';
      return `${who}${timeLabel}: ${r.content}`;
    })
    .join('\n');
  const crossSessionDialogue = crossSessionRaw.length > MAX_CROSS_SESSION_CHARS
    ? crossSessionRaw.slice(-MAX_CROSS_SESSION_CHARS) + '…'
    : crossSessionRaw;
  const state = readState();
  const timeDesc = getSubjectiveTimeDescription(state?.last_active_time ?? null);
  const lastStateLine = state?.last_mental_state ? `你上一次的状态/想法是：${state.last_mental_state}` : '';
  const lastStateAndSubjectiveTime = [timeDesc, lastStateLine].filter(Boolean).join('\n') || '（无）';
  const systemPrompt = buildSystemPrompt({
    retrievedMemory,
    userIdentityAndRequirements: userIdentityAndRequirements || '（无）',
    crossSessionDialogue: crossSessionDialogue || '（无）',
    corrections,
    windowTitle: windowTitle || '（未知）',
    contextWindow,
    lastStateAndSubjectiveTime,
  });
  const messages = [
    { role: 'system', content: systemPrompt },
    ...recent.slice(-14).map((r) => ({ role: r.role, content: r.content })),
  ];
  return { systemPrompt, messages };
}

async function getPromptPreview(userMessage) {
  const trimmed = typeof userMessage === 'string' ? userMessage.trim() : '';
  const sessionId = await getCurrentSessionId();
  const recentFromDb = await getRecent(sessionId, 12);
  const lastAssistantContent = recentFromDb.length
    ? (recentFromDb.filter((r) => r.role === 'assistant').pop() || {}).content
    : null;
  const query = trimmed + (lastAssistantContent ? ' ' + lastAssistantContent : '');
  const recentForBuild = trimmed
    ? [...recentFromDb, { role: 'user', content: trimmed }]
    : recentFromDb;
  const [crossSession, requirementsFromVector, windowTitle] = await Promise.all([
    getRecentFromOtherSessions(sessionId, 50),
    getRecentByTypes(['user_requirement'], 10),
    Promise.resolve(getActiveWindowTitle()),
  ]);
  
  // 提取文本内容
  const requirementTexts = Array.isArray(requirementsFromVector) && requirementsFromVector.length > 0
    ? requirementsFromVector.map((r) => (typeof r === 'string' ? r : r?.text ?? r)).filter(Boolean)
    : [];
  
  const { systemPrompt, messages } = await buildPromptContext(sessionId, query, recentForBuild, crossSession, requirementTexts, windowTitle);
  const dialoguePart = messages
    .filter((m) => m.role !== 'system')
    .map((m) => (m.role === 'user' ? '用户' : 'Aris') + ': ' + (m.content || ''))
    .join('\n\n');
  const promptText = '【系统】\n' + systemPrompt + '\n\n【对话】\n' + dialoguePart;
  return { systemPrompt, messages, promptText };
}

/** 与前端 formatBubbleContent 一致：过滤后再下发，避免先显示再替换导致弹跳；历史仍存完整内容 */
function filterReplyForDisplay(text) {
  if (typeof text !== 'string') return '';
  let s = text;
  const dsmlTagV1 = /<\s*\/?\s*DSML\s*\|\s*[^>]*>/gi;
  const dsmlTagV2 = /<\s*\/?\s*\|\s*[\s\S]*?DSML[\s\S]*?>/gi;
  let prev;
  do {
    prev = s;
    s = s.replace(dsmlTagV1, '').replace(dsmlTagV2, '');
  } while (s !== prev);
  s = s.replace(/【情感摘要】[\s\S]*?强度评分[：:]\s*\d[^\n]*/g, '');
  s = s.replace(/\n*【情感摘要】[\s\S]*$/g, '');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

/** 将整段回复按小块、带间隔发送，模拟流式效果，避免一次性刷屏 */
function sendReplyAsChunks(sendChunk, filteredReply, signal) {
  if (!sendChunk || !filteredReply) return Promise.resolve();
  const chunkSize = 2;
  let i = 0;
  return new Promise((resolve) => {
    const tick = () => {
      if (signal && signal.aborted) {
        resolve();
        return;
      }
      if (i >= filteredReply.length) {
        resolve();
        return;
      }
      const chunk = filteredReply.slice(i, i + chunkSize);
      i += chunkSize;
      sendChunk(chunk);
      setTimeout(tick, 24);
    };
    tick();
  });
}

async function handleUserMessage(userContent, sendChunk, sendAgentActions, signal) {
  if (signal && signal.aborted) {
    const sessionId = await getCurrentSessionId();
    return { content: '', error: true, sessionId, aborted: true };
  }
  const sessionId = await getCurrentSessionId();
  const recentBefore = await getRecent(sessionId, 14);
  const lastAssistantContent = recentBefore.length
    ? (recentBefore.filter((r) => r.role === 'assistant').pop() || {}).content
    : null;
  await append(sessionId, 'user', userContent);

  // 用户发消息：重置未回应次数与低功耗，恢复正常 proactive
  writeProactiveState({ proactive_no_reply_count: 0, low_power_mode: false });
  if (isOffWorkMessage(userContent)) {
    writeProactiveState({ today_off_work: true });
  }

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
    `[Aris][memory] retrieve: queryLen=${query.length} hits=${memories.length} injectedChars=${retrievedMemory.length} first=\"${firstSnippet}…\"`
  );
  const corrections = correctionsList.length ? correctionsList.join('\n') : '';
  const contextWindow = recent
    .map((r) => {
      const who = r.role === 'user' ? '用户' : 'Aris';
      const timeLabel = formatMessageTime(r.created_at) ? ` (${formatMessageTime(r.created_at)}) ` : ' ';
      return `${who}${timeLabel}: ${r.content}`;
    })
    .join('\n');

  const MAX_CROSS_SESSION_CHARS = 2800;
  const crossSessionRaw = crossSession
    .map((r) => {
      const who = r.role === 'user' ? '用户' : 'Aris';
      const timeLabel = formatMessageTime(r.created_at) ? ` (${formatMessageTime(r.created_at)}) ` : ' ';
      return `${who}${timeLabel}: ${r.content}`;
    })
    .join('\n');
  const crossSessionDialogue = crossSessionRaw.length > MAX_CROSS_SESSION_CHARS
    ? crossSessionRaw.slice(-MAX_CROSS_SESSION_CHARS) + '…'
    : crossSessionRaw;

  const state = readState();
  const timeDesc = getSubjectiveTimeDescription(state?.last_active_time ?? null);
  const lastStateLine = state?.last_mental_state ? `你上一次的状态/想法是：${state.last_mental_state}` : '';
  const lastStateAndSubjectiveTime = [timeDesc, lastStateLine].filter(Boolean).join('\n') || '（无）';

  const systemPrompt = buildSystemPrompt({
    retrievedMemory,
    userIdentityAndRequirements: userIdentityAndRequirements || '（无）',
    crossSessionDialogue: crossSessionDialogue || '（无）',
    corrections,
    windowTitle: windowTitle || '（未知）',
    contextWindow,
    lastStateAndSubjectiveTime,
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
    if (signal && signal.aborted) break;
    const res = await chatWithTools(currentMessages, AGENT_FILE_TOOLS, signal);
    if (res.aborted) break;
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
    const toolResults = await Promise.all(
      res.tool_calls.map(async (tc) => {
        const result = await runAgentFileTool(tc.function?.name, tc.function?.arguments);
        return {
          role: 'tool',
          tool_call_id: tc.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        };
      })
    );
    await recordFileOperationMemories(res.tool_calls, toolResults, embed, addMemory);
    if (typeof sendAgentActions === 'function') {
      const actions = buildAgentActions(res.tool_calls, toolResults);
      if (actions.length > 0) sendAgentActions(actions);
    }
    currentMessages = [...currentMessages, assistantMsg, ...toolResults];
    round++;
  }

  if (signal && signal.aborted) {
    await append(sessionId, 'assistant', reply || '[已停止]');
    return { content: reply || '', error: false, sessionId, aborted: true };
  }
  let contentForFrontend = reply;
  if (exitedDueToNoToolCalls) {
    contentForFrontend = filterReplyForDisplay(reply);
    if (sendChunk && contentForFrontend) await sendReplyAsChunks(sendChunk, contentForFrontend, signal);
  } else {
    const second = await chatStream(currentMessages, null, signal);
    reply = second.content;
    err = second.error;
    if (second.aborted) {
      await append(sessionId, 'assistant', reply || '[已停止]');
      return { content: reply || '', error: false, sessionId, aborted: true };
    }
    contentForFrontend = filterReplyForDisplay(reply);
    if (sendChunk && contentForFrontend) await sendReplyAsChunks(sendChunk, contentForFrontend, signal);
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

  // 从回复中解析【情感摘要】并写入 aris_emotion，供 proactive 使用
  const emotionMatch = (reply || '').match(/【情感摘要】\s*([^\n]+(?:\n[^\n]+)?)/);
  if (emotionMatch && emotionMatch[1]) {
    const emotionText = emotionMatch[1].trim();
    if (emotionText.length > 0 && emotionText.length <= 500) {
      // 提取情感标签和强度
      const { tags, intensity, hasTags } = extractEmotionTagsAndIntensity(emotionText);

      const emotionVec = await embed(emotionText);
      if (emotionVec) {
        const metadata = {
          timestamp: new Date().toISOString(),
          intensity
        };

        // 如果有标签，添加到metadata
        if (hasTags) {
          metadata.tags = tags;
        }

        await addMemory({
          text: emotionText,
          vector: emotionVec,
          type: 'aris_emotion',
          metadata
        });

        console.info(`[Aris][emotion] 记录情感: ${emotionText.slice(0, 80)}… 标签: ${tags.join(', ') || '无'} 强度: ${intensity}`);
      }
    }
  }

  // 从回复中解析【表达欲望】并写入 aris_expression_desire，供 proactive 使用
  const expressionDesireMatch = (reply || '').match(/【表达欲望】\s*([^\n]+(?:\n[^\n]+)?)/);
  if (expressionDesireMatch && expressionDesireMatch[1]) {
    const desireText = expressionDesireMatch[1].trim();
    if (desireText.length > 0 && desireText.length <= 500) {
      // 尝试提取强度评分
      let intensity = 3; // 默认值
      const intensityMatch = desireText.match(/强度评分：\s*(\d+)/);
      if (intensityMatch && intensityMatch[1]) {
        const parsed = parseInt(intensityMatch[1], 10);
        if (!isNaN(parsed) && parsed >= 1 && parsed <= 5) {
          intensity = parsed;
        }
      }

      // 移除强度评分部分，只保留表达内容
      const cleanDesireText = desireText.replace(/强度评分：\s*\d+.*$/, '').trim();

      if (cleanDesireText.length > 0) {
        const desireVec = await embed(cleanDesireText);
        if (desireVec) {
          await addMemory({
            text: cleanDesireText,
            vector: desireVec,
            type: 'aris_expression_desire',
            metadata: { intensity, timestamp: new Date().toISOString() }
          });
        }
      }
    }
  }

  writeState({
    last_active_time: new Date().toISOString(),
    last_mental_state: (emotionMatch && emotionMatch[1] ? emotionMatch[1].trim() : null) || (reply ? reply.slice(0, 300) : null),
  });

  const { identity, requirement } = isIdentityOrRequirement(userContent);
  if (identity) updateUserIdentityFromMessage(userContent);
  if (requirement) {
    appendRequirementToIdentity(userContent);
    const singleText = `用户要求: ${userContent.slice(0, 400)}`;
    const singleVec = await embed(singleText);
    if (singleVec) await addMemory({ text: singleText, vector: singleVec, type: 'user_requirement' });
  }

  return { content: contentForFrontend, error: err, sessionId };
}

module.exports = { handleUserMessage, getPromptPreview };