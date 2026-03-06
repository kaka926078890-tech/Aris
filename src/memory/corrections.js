const { embed } = require('./embedding.js');
const { addMemory, search } = require('./lancedb.js');

const CORRECTION_PHRASES = ['你理解错了', '不是这样', '不对', '错了', '不是这个意思', '误解了'];

function isUserCorrection(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  return CORRECTION_PHRASES.some((p) => t.includes(p));
}

/**
 * Record a correction: previous model reply + user correction. Stored for retrieval so Aris can avoid repeating.
 */
async function recordCorrection(previousReply, userCorrectionText) {
  const combined = `[纠错] 我此前说: ${previousReply}\n用户纠正: ${userCorrectionText}`;
  const vector = await embed(combined);
  if (!vector) return;
  await addMemory({ text: combined, vector, type: 'correction' });
}

/**
 * Get recent corrections for prompt injection (optional: filter by retrieval already returns top-k).
 */
async function getCorrectionsForPrompt(limit = 5) {
  const vector = await embed('用户纠正 理解错了 不对');
  if (!vector) return [];
  const rows = await search(vector, limit);
  return rows.filter((r) => r.type === 'correction').map((r) => r.text);
}

module.exports = { isUserCorrection, recordCorrection, getCorrectionsForPrompt };
