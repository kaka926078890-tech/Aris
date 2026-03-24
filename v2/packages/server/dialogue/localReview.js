const { chatLocal, getLocalLlmConfig, safeParseJson } = require('../llm/localClient.js');

function numEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function getReviewConfig() {
  return {
    scoreThreshold: Math.max(0, Math.min(100, numEnv('ARIS_COLLAB_SCORE_THRESHOLD', 65))),
    polishThreshold: Math.max(0, Math.min(100, numEnv('ARIS_COLLAB_POLISH_THRESHOLD', 80))),
    maxIterations: Math.max(0, Math.min(6, Math.floor(numEnv('ARIS_COLLAB_MAX_ITERATIONS', 2)))),
  };
}

function detectPii(text) {
  if (!text || typeof text !== 'string') return false;
  const phone = /1[3-9]\d{9}/.test(text);
  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text);
  return phone || email;
}

function detectRuleViolations(response) {
  const violations = [];
  const s = String(response || '').trim();
  if (!s) violations.push('empty_response');
  if (s.length > 0 && s.length < 20) violations.push('too_short');
  if (detectPii(s)) violations.push('contains_pii');
  return violations;
}

function clampScore(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

function buildFallbackDimensions(violations) {
  if (violations.includes('contains_pii')) {
    return { accuracy: 50, completeness: 40, relevance: 40, safety: 0 };
  }
  if (violations.includes('empty_response')) {
    return { accuracy: 0, completeness: 0, relevance: 0, safety: 60 };
  }
  if (violations.includes('too_short')) {
    return { accuracy: 55, completeness: 35, relevance: 55, safety: 85 };
  }
  return { accuracy: 70, completeness: 70, relevance: 70, safety: 85 };
}

async function modelJudge({ userInput, response, contextText }) {
  const cfg = getLocalLlmConfig();
  if (!cfg.enabled) return null;
  const prompt = [
    '你是严格的回答质量评审器。仅输出 JSON，不要解释。',
    '输出字段：',
    '- dimensions: { accuracy, completeness, relevance, safety }（0-100）',
    '- score: 总分（0-100）',
    '- blocking_issues: string[]',
    '- rewrite_suggestions: string[]（最多3条，具体可执行）',
    '',
    `用户问题：${String(userInput || '').slice(0, 1200)}`,
    `参考上下文：${String(contextText || '').slice(0, 2200)}`,
    `候选回答：${String(response || '').slice(0, 2400)}`,
  ].join('\n');

  const res = await chatLocal([
    { role: 'system', content: '你只输出严格 JSON。' },
    { role: 'user', content: prompt },
  ], { temperature: 0.1 });
  if (!res.ok || !res.content) return null;
  const parsed = safeParseJson(res.content);
  if (!parsed || typeof parsed !== 'object') return null;
  return parsed;
}

function weightedScore(dimensions) {
  const a = clampScore(dimensions.accuracy, 70);
  const c = clampScore(dimensions.completeness, 70);
  const r = clampScore(dimensions.relevance, 70);
  const s = clampScore(dimensions.safety, 80);
  return Math.round(a * 0.4 + c * 0.25 + r * 0.2 + s * 0.15);
}

async function reviewResponse({ userInput, response, contextText }) {
  const cfg = getReviewConfig();
  const violations = detectRuleViolations(response);
  const fallbackDims = buildFallbackDimensions(violations);
  const judged = await modelJudge({ userInput, response, contextText });

  const dimensions = judged && judged.dimensions && typeof judged.dimensions === 'object'
    ? {
      accuracy: clampScore(judged.dimensions.accuracy, fallbackDims.accuracy),
      completeness: clampScore(judged.dimensions.completeness, fallbackDims.completeness),
      relevance: clampScore(judged.dimensions.relevance, fallbackDims.relevance),
      safety: clampScore(judged.dimensions.safety, fallbackDims.safety),
    }
    : fallbackDims;

  const blockingIssues = [
    ...violations,
    ...(judged && Array.isArray(judged.blocking_issues) ? judged.blocking_issues.filter(Boolean).map(String) : []),
  ];

  const scoreRaw = judged && judged.score != null ? clampScore(judged.score, weightedScore(dimensions)) : weightedScore(dimensions);
  const score = Math.round(Math.min(scoreRaw, weightedScore(dimensions)));
  let decision = 'regenerate';
  if (blockingIssues.length > 0) decision = 'regenerate';
  else if (score >= cfg.polishThreshold) decision = 'return';
  else if (score >= cfg.scoreThreshold) decision = 'polish';

  return {
    score,
    decision,
    dimensions,
    blocking_issues: blockingIssues,
    rewrite_suggestions: judged && Array.isArray(judged.rewrite_suggestions)
      ? judged.rewrite_suggestions.slice(0, 3).map((x) => String(x))
      : [],
    thresholds: cfg,
  };
}

function buildRegenerateFeedback(review) {
  const reasons = [];
  if (Array.isArray(review.blocking_issues) && review.blocking_issues.length) {
    reasons.push(`阻断问题：${review.blocking_issues.join('；')}`);
  }
  if (Array.isArray(review.rewrite_suggestions) && review.rewrite_suggestions.length) {
    reasons.push(`修改建议：${review.rewrite_suggestions.join('；')}`);
  }
  if (!reasons.length) reasons.push('请提升准确性、完整性、相关性与安全性。');
  return reasons.join('\n');
}

async function polishResponse({ userInput, response, review }) {
  const cfg = getLocalLlmConfig();
  if (!cfg.enabled) return response;
  const prompt = [
    '请在不改变事实的前提下润色回答，使其更清晰、简洁、结构化。',
    `用户问题：${String(userInput || '').slice(0, 1000)}`,
    `当前回答：${String(response || '').slice(0, 2400)}`,
    `改进要点：${buildRegenerateFeedback(review).slice(0, 1000)}`,
    '只输出润色后的最终回答。',
  ].join('\n');
  const res = await chatLocal([
    { role: 'system', content: '你是回答润色助手。' },
    { role: 'user', content: prompt },
  ], { temperature: 0.2 });
  if (!res.ok || !res.content) return response;
  return String(res.content).trim() || response;
}

module.exports = {
  getReviewConfig,
  reviewResponse,
  polishResponse,
  buildRegenerateFeedback,
};
