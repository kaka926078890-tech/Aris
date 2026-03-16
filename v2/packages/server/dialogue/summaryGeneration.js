/**
 * 小结沉淀：每 N 轮用 LLM 生成会话小结并写入 store，供 prompt 注入。
 * 由 handler 在每轮结束后异步触发，不阻塞回复。
 */
const store = require('../../store');
const { chat } = require('../llm/client.js');
const { readRetrievalConfig } = require('./associationContext.js');

const SUMMARY_PROMPT_PREFIX = `以下是一段对话的最近若干轮。请用 2～4 句话概括：这段时间里主要聊了什么、用户的状态或需求有什么变化。不要逐条列举，要连贯成一段小结。直接输出小结内容，不要加「小结：」等前缀。

对话：
`;

/**
 * 若满足条件则生成小结并写入；否则直接返回。不抛错，失败只打日志。
 * @param {string} sessionId
 */
async function maybeGenerateSummary(sessionId) {
  if (!sessionId) return;
  const config = readRetrievalConfig();
  const enableSummary = config.enable_summary === true;
  const interval = Math.max(2, Math.min(Number(config.summary_rounds_interval) || 10, 50));
  if (!enableSummary) return;

  const recent = await store.conversations.getRecent(sessionId, 500);
  const msgCount = recent.length;
  const currentRounds = Math.floor(msgCount / 2);
  if (currentRounds < interval) return;

  const lastSummary = store.summaries.readSummary(sessionId);
  const lastRound = lastSummary?.round_index ?? 0;
  if (currentRounds - lastRound < interval) return;

  const take = Math.min(2 * interval, recent.length, 30);
  const slice = take >= recent.length ? recent : recent.slice(-take);
  const dialogueText = slice
    .map((m) => (m.role === 'user' ? '用户' : 'Aris') + ': ' + (m.content || '').trim())
    .join('\n');
  if (!dialogueText.trim()) return;

  const prompt = SUMMARY_PROMPT_PREFIX + dialogueText;
  try {
    const res = await chat([{ role: 'user', content: prompt }]);
    const content = res?.content?.trim();
    if (content && !res.error) {
      store.summaries.writeSummary(sessionId, content, currentRounds);
      console.info('[Aris v2] 小结已生成 session=', sessionId.slice(0, 12), 'rounds=', currentRounds);
    }
  } catch (e) {
    console.warn('[Aris v2] 小结生成失败', e?.message);
  }
}

module.exports = { maybeGenerateSummary };
