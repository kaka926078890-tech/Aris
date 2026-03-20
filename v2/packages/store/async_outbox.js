/**
 * 对话后轮次副作用的持久化异步队列：向量写入、token 监控、dialogue 指标。
 * 先落盘再后台执行；失败按指数退避重试，耗尽写入 dead_letter；每次失败追加 retry_log。
 * 进程启动时会补跑 pending（补录）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDataDir } = require('../config/paths.js');

const facade = require('./facade.js');

let monitorMod = null;
try {
  monitorMod = require('./monitor.js');
} catch (_) {}

function loadDialogueMetrics() {
  try {
    return require('../server/dialogue/dialogueMetrics.js');
  } catch (_) {
    return { appendDialogueTurnMetricLine: () => {} };
  }
}

function isEnabled() {
  return process.env.ARIS_ASYNC_OUTBOX !== 'false';
}

function maxRetries() {
  const n = parseInt(process.env.ARIS_ASYNC_OUTBOX_MAX_RETRIES || '5', 10);
  return Number.isFinite(n) && n >= 0 ? n : 5;
}

function intervalMs() {
  const n = parseInt(process.env.ARIS_ASYNC_OUTBOX_INTERVAL_MS || '2000', 10);
  return Number.isFinite(n) && n >= 200 ? n : 2000;
}

function startupBurst() {
  const n = parseInt(process.env.ARIS_ASYNC_OUTBOX_STARTUP_BURST || '80', 10);
  return Number.isFinite(n) && n >= 1 ? n : 80;
}

function getDir() {
  const d = path.join(getDataDir(), 'async_outbox');
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

function pendingPath() {
  return path.join(getDir(), 'pending.json');
}

function deadLetterPath() {
  return path.join(getDir(), 'dead_letter.jsonl');
}

function retryLogPath() {
  return path.join(getDir(), 'retry_log.jsonl');
}

/** @type {Promise<void>} */
let chain = Promise.resolve();

function withLock(fn) {
  const next = chain.then(() => fn(), () => fn());
  chain = next.catch(() => {});
  return next;
}

function readPendingSync() {
  const p = pendingPath();
  if (!fs.existsSync(p)) return [];
  try {
    const raw = fs.readFileSync(p, 'utf8').trim();
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn('[Aris v2][async_outbox] read pending failed', e?.message);
    return [];
  }
}

function writePendingSync(jobs) {
  const p = pendingPath();
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(jobs, null, 0), 'utf8');
  fs.renameSync(tmp, p);
}

function appendJsonl(filePath, obj) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...obj }) + '\n';
  fs.appendFileSync(filePath, line, 'utf8');
}

function backoffMs(attempts) {
  const base = 1000 * Math.pow(2, Math.max(0, attempts - 1));
  return Math.min(300000, base);
}

/**
 * @param {'vector_dialogue'|'token_usage'|'dialogue_metric'} type
 * @param {object} payload
 * @returns {Promise<string|null>} job id
 */
function enqueue(type, payload) {
  if (!isEnabled()) return Promise.resolve(null);
  if (!payload || typeof payload !== 'object') return Promise.resolve(null);
  const id = crypto.randomUUID ? crypto.randomUUID() : `job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const job = {
    id,
    type,
    payload,
    attempts: 0,
    nextRetryAt: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return withLock(() => {
    const list = readPendingSync();
    list.push(job);
    writePendingSync(list);
  })
    .then(() => {
      scheduleTick();
      return id;
    })
    .catch((e) => {
      console.warn('[Aris v2][async_outbox] enqueue lock failed', e?.message);
      return null;
    });
}

async function runJob(job) {
  const { type, payload } = job;
  if (type === 'vector_dialogue') {
    const blockText = payload.blockText;
    const sessionId = payload.sessionId;
    const relatedEntities = Array.isArray(payload.relatedEntities) ? payload.relatedEntities : [];
    if (typeof blockText !== 'string' || !blockText.trim()) throw new Error('empty blockText');
    const vec = await facade.embedForDialogue(blockText, { prefix: 'document' });
    if (!vec) throw new Error('embed returned null');
    await facade.addVectorBlock({
      text: blockText,
      vector: vec,
      type: 'dialogue_turn',
      metadata: { session_id: sessionId, related_entities: relatedEntities },
    });
    return;
  }
  if (type === 'token_usage') {
    if (!monitorMod || !monitorMod.recordTokenUsage) return;
    monitorMod.recordTokenUsage(
      payload.sessionId,
      payload.roundId,
      Number(payload.inputTokens) || 0,
      Number(payload.outputTokens) || 0,
      !!payload.isEstimated,
    );
    return;
  }
  if (type === 'dialogue_metric') {
    const dm = loadDialogueMetrics();
    dm.appendDialogueTurnMetricLine(payload.entry || {});
    return;
  }
  throw new Error(`unknown job type: ${type}`);
}

function failJob(job, errMsg) {
  const attempts = (job.attempts || 0) + 1;
  const max = maxRetries();
  job.attempts = attempts;
  job.lastError = errMsg;
  job.updatedAt = new Date().toISOString();
  try {
    appendJsonl(retryLogPath(), {
      jobId: job.id,
      type: job.type,
      attempt: attempts,
      error: errMsg,
    });
  } catch (_) {}

  if (attempts >= max) {
    try {
      appendJsonl(deadLetterPath(), {
        ...job,
        terminalAt: new Date().toISOString(),
        reason: 'max_retries',
      });
    } catch (e) {
      console.warn('[Aris v2][async_outbox] dead letter write failed', e?.message);
    }
    return 'dead';
  }
  job.nextRetryAt = Date.now() + backoffMs(attempts);
  return 'retry';
}

let processMutex = false;

async function processOne() {
  if (!isEnabled()) return false;
  if (processMutex) return false;
  processMutex = true;
  let job = null;
  try {
  await withLock(() => {
    const list = readPendingSync();
    const now = Date.now();
    for (let i = 0; i < list.length; i++) {
      const j = list[i];
      const when = typeof j.nextRetryAt === 'number' ? j.nextRetryAt : 0;
      if (when <= now) {
        job = j;
        break;
      }
    }
  });
  if (!job) return false;
  try {
    await runJob(job);
    await withLock(() => {
      const list = readPendingSync();
      const idx = list.findIndex((x) => x.id === job.id);
      if (idx >= 0) {
        list.splice(idx, 1);
        writePendingSync(list);
      }
    });
    return true;
  } catch (e) {
    const msg = e && (e.message || String(e));
    await withLock(() => {
      const list = readPendingSync();
      const idx = list.findIndex((x) => x.id === job.id);
      if (idx >= 0) {
        const j = list[idx];
        const outcome = failJob(j, msg);
        if (outcome === 'dead') {
          list.splice(idx, 1);
        }
        writePendingSync(list);
      }
    });
    console.warn('[Aris v2][async_outbox] job failed', job.type, job.id, msg);
    return true;
  }
  } finally {
    processMutex = false;
  }
}

let tickScheduled = false;
function scheduleTick() {
  if (tickScheduled) return;
  tickScheduled = true;
  setImmediate(() => {
    tickScheduled = false;
    processOne().catch((e) => console.warn('[Aris v2][async_outbox] processOne', e?.message));
  });
}

async function drainBurst(max) {
  const lim = max != null ? max : startupBurst();
  for (let i = 0; i < lim; i++) {
    const more = await processOne();
    if (!more) break;
  }
}

let loopStarted = false;
function startDrainLoop() {
  if (!isEnabled() || loopStarted) return;
  loopStarted = true;
  setImmediate(() => {
    drainBurst(startupBurst()).catch((e) => console.warn('[Aris v2][async_outbox] startup drain', e?.message));
  });
  setInterval(() => {
    processOne().catch((e) => console.warn('[Aris v2][async_outbox] tick', e?.message));
  }, intervalMs());
}

function getPendingCount() {
  try {
    return readPendingSync().length;
  } catch (_) {
    return 0;
  }
}

module.exports = {
  isEnabled,
  enqueue,
  drainBurst,
  startDrainLoop,
  getPendingCount,
  _processOne: processOne,
};

if (typeof setImmediate !== 'undefined') {
  setImmediate(() => {
    try {
      startDrainLoop();
    } catch (e) {
      console.warn('[Aris v2][async_outbox] init', e?.message);
    }
  });
}
