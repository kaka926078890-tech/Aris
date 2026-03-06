/**
 * Main process dialogue handler: memory-first flow, then LLM, then persist.
 */
const { chatStream } = require('./api.js');
const { buildSystemPrompt } = require('./prompt.js');
const { retrieve } = require('../memory/retrieval.js');
const { getCorrectionsForPrompt, isUserCorrection, recordCorrection } = require('../memory/corrections.js');
const { getCurrentSessionId, append, getRecent, getRecentFromOtherSessions } = require('../store/conversations.js');
const { addMemory, getRecentByTypes } = require('../memory/lancedb.js');
const { embed } = require('../memory/embedding.js');
const { getActiveWindowTitle } = require('../context/windowTitle.js');
const { loadUserIdentity, updateUserIdentityFromMessage } = require('./userIdentity.js');

const IDENTITY_PHRASES = ['我是', '我叫', '我的名字', '我是谁', '身份是', '你可以叫我'];
const REQUIREMENT_PHRASES = ['你以后', '记住', '要求', '偏好', '希望你能', '不要', '别', '请尽量', '习惯'];

function isIdentityOrRequirement(text) {
  if (!text || typeof text !== 'string') return { identity: false, requirement: false };
  const t = text.trim();
  if (t.length < 2) return { identity: false, requirement: false };
  const identity = IDENTITY_PHRASES.some((p) => t.includes(p));
  const requirement = REQUIREMENT_PHRASES.some((p) => t.includes(p));
  return { identity, requirement };
}

async function handleUserMessage(userContent, sendChunk) {
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
  const requirementTexts = Array.isArray(requirementsFromVector) && requirementsFromVector.length > 0
    ? requirementsFromVector.map((r) => (typeof r === 'string' ? r : r?.text ?? r)).filter(Boolean)
    : [];
  const userIdentityAndRequirements = [identityFromFile, ...requirementTexts].filter(Boolean).join('\n---\n') || '';

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

  const { content: reply, error } = await chatStream(messages, sendChunk);
  await append(sessionId, 'assistant', reply);

  if (isUserCorrection(userContent) && lastAssistantContent) {
    await recordCorrection(lastAssistantContent, userContent);
  }

  // 一轮对话存一条：用户 + Aris 合并向量化（不按句各存一条）
  const userPart = userContent.slice(0, 300);
  const arisPart = reply.slice(0, 500);
  const pairText = `用户: ${userPart}\nAris: ${arisPart}`;
  const vec = await embed(pairText);
  if (vec) await addMemory({ text: pairText, vector: vec, type: 'dialogue_turn' });

  const { identity, requirement } = isIdentityOrRequirement(userContent);
  if (identity) updateUserIdentityFromMessage(userContent);
  if (requirement) {
    const singleText = `用户要求: ${userContent.slice(0, 400)}`;
    const singleVec = await embed(singleText);
    if (singleVec) await addMemory({ text: singleText, vector: singleVec, type: 'user_requirement' });
  }

  return { content: reply, error, sessionId };
}

module.exports = { handleUserMessage };
