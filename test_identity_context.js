/**
 * 与 handler 相同的上下文构建逻辑，逐段检查是否包含「改不动了」并调用 DeepSeek 看模型拿到的名字。
 * 在 Aris 目录执行：node test_identity_context.js
 */
require('dotenv').config();
const path = require('path');

process.chdir(path.join(__dirname));

const { retrieve } = require('./src/memory/retrieval.js');
const { getCorrectionsForPrompt } = require('./src/memory/corrections.js');
const { getCurrentSessionId, getRecent, getRecentFromOtherSessions } = require('./src/store/conversations.js');
const { getRecentByTypes } = require('./src/memory/lancedb.js');
const { loadUserIdentity } = require('./src/dialogue/userIdentity.js');
const { buildSystemPrompt } = require('./src/dialogue/prompt.js');
const { getActiveWindowTitle } = require('./src/context/windowTitle.js');
const { chat } = require('./src/dialogue/api.js');

const NOT_NAME_PHRASES = new Set([
  '谁', '什么', '对的', '好', '的', '呀', '啊', '哦', '嗯',
  '改不动了', '卡住了', '不行', '没办法', '错了', '不对',
]);

function extractIdentityFromMemories(memories) {
  if (!Array.isArray(memories) || memories.length === 0) return '';
  const seen = new Set();
  for (const m of memories) {
    const text = typeof m.text === 'string' ? m.text : String(m?.text ?? '');
    const match = text.match(/你是[「\"]?\s*([^\s」\"，。！？、]{1,20})[」\"]?/);
    const candidate = match && match[1] ? match[1].trim() : '';
    if (candidate && !NOT_NAME_PHRASES.has(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      return `用户名字：${candidate}`;
    }
  }
  return '';
}

const TARGET = '改不动了';
const MAX_MEMORY_CHARS = 3200;
const MAX_CROSS_SESSION_CHARS = 2800;

async function main() {
  const appSupportAris = path.join(process.env.HOME || require('os').homedir(), 'Library', 'Application Support', 'aris');
  if (!process.env.ARIS_DATA_DIR) process.env.ARIS_DATA_DIR = appSupportAris;
  console.log('LanceDB 数据目录:', process.env.ARIS_DATA_DIR, '\n');

  const testQuery = '用户是谁？你看到的用户名字是什么？';
  let sessionId = 'test_' + Date.now();
  let memories = [];
  let correctionsList = [];
  let recent = [];
  let crossSession = [];
  let requirementsFromVector = [];
  let windowTitle = '';
  try {
    sessionId = await getCurrentSessionId();
  } catch (_) {}
  try {
    [memories, correctionsList, recent, crossSession, requirementsFromVector, windowTitle] = await Promise.all([
      retrieve(testQuery, 12).catch((e) => { console.warn('retrieve 失败:', e.message); return []; }),
      getCorrectionsForPrompt(5).catch((e) => { console.warn('getCorrectionsForPrompt 失败:', e.message); return []; }),
      getRecent(sessionId, 12).catch((e) => { console.warn('getRecent 失败:', e.message); return []; }),
      getRecentFromOtherSessions(sessionId, 50).catch((e) => { console.warn('getRecentFromOtherSessions 失败:', e.message); return []; }),
      getRecentByTypes(['user_requirement'], 10).catch((e) => { console.warn('getRecentByTypes 失败:', e.message); return []; }),
      Promise.resolve(getActiveWindowTitle()).catch(() => ''),
    ]);
  } catch (e) {
    console.warn('拉取上下文失败:', e.message);
    try { windowTitle = getActiveWindowTitle(); } catch (_) {}
  }

  const identityFromFile = loadUserIdentity();
  const identityFromRetrieved = extractIdentityFromMemories(memories);
  const requirementTexts = Array.isArray(requirementsFromVector) && requirementsFromVector.length > 0
    ? requirementsFromVector.map((r) => (typeof r === 'string' ? r : r?.text ?? r)).filter(Boolean)
    : [];
  const userIdentityAndRequirements = [identityFromFile, identityFromRetrieved, ...requirementTexts]
    .filter(Boolean)
    .join('\n---\n') || '';

  let retrievedMemory = '';
  if (memories.length > 0) {
    const raw = memories.map((m) => m.text).join('\n---\n');
    retrievedMemory = raw.length > MAX_MEMORY_CHARS ? raw.slice(0, MAX_MEMORY_CHARS) + '…' : raw;
  }
  const corrections = correctionsList.length ? correctionsList.join('\n') : '';
  const contextWindow = recent
    .map((r) => `${r.role === 'user' ? '用户' : 'Aris'}: ${r.content}`)
    .join('\n');
  const crossSessionRaw = crossSession
    .map((r) => `${r.role === 'user' ? '用户' : 'Aris'}: ${r.content}`)
    .join('\n');
  const crossSessionDialogue = crossSessionRaw.length > MAX_CROSS_SESSION_CHARS
    ? crossSessionRaw.slice(-MAX_CROSS_SESSION_CHARS) + '…'
    : crossSessionRaw;

  const segments = [
    { name: 'identityFromFile', value: identityFromFile },
    { name: 'identityFromRetrieved', value: identityFromRetrieved },
    { name: 'requirementTexts', value: requirementTexts.join('\n') },
    { name: 'userIdentityAndRequirements（注入块）', value: userIdentityAndRequirements },
    { name: 'retrievedMemory', value: retrievedMemory },
    { name: 'corrections', value: corrections },
    { name: 'contextWindow', value: contextWindow },
    { name: 'crossSessionDialogue', value: crossSessionDialogue },
  ];

  console.log('========== 各段是否包含「' + TARGET + '」 ==========\n');
  let foundIn = null;
  for (const s of segments) {
    const has = (s.value || '').includes(TARGET);
    if (has) foundIn = foundIn ? foundIn + ', ' + s.name : s.name;
    console.log(`[${has ? '包含' : '无'}] ${s.name}`);
    if (s.value && s.value.length > 0 && s.value.length <= 500) console.log(`  内容: ${s.value.slice(0, 200)}${s.value.length > 200 ? '…' : ''}`);
    else if (s.value && s.value.length > 500) console.log(`  内容长度: ${s.value.length} 字符`);
    console.log('');
  }
  if (foundIn) console.log('>>> 「' + TARGET + '」出现在: ' + foundIn + '\n');
  else console.log('>>> 各注入段均未出现「' + TARGET + '」，可能来自模型本身或未纳入的上下文。\n');

  const systemPrompt = buildSystemPrompt({
    retrievedMemory,
    userIdentityAndRequirements: userIdentityAndRequirements || '（无）',
    crossSessionDialogue: crossSessionDialogue || '（无）',
    corrections,
    windowTitle: windowTitle || '（未知）',
    contextWindow,
  });

  if (systemPrompt.includes(TARGET)) {
    const idx = systemPrompt.indexOf(TARGET);
    const start = Math.max(0, idx - 80);
    const end = Math.min(systemPrompt.length, idx + 80);
    console.log('>>> 完整 systemPrompt 中包含「' + TARGET + '」的片段:\n' + systemPrompt.slice(start, end) + '\n');
  }

  console.log('========== 调用 DeepSeek：用户名字是什么 ==========\n');
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: '请根据上下文说出：你看到的用户名字是什么？只回答名字，不要解释。' },
  ];
  const res = await chat(messages);
  console.log('DeepSeek 回复:', res.content || res.error || '[空]');
  if (res.content && res.content.includes(TARGET)) {
    console.log('\n>>> 模型返回中出现了「' + TARGET + '」，说明该信息来自上述注入的某一段或模型推断。');
  }
  console.log('\n说明: 若 retrieve/search 报错导致 retrievedMemory 为空，无法排除「' + TARGET + '」曾来自向量记忆。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
