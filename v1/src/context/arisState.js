const path = require('path');
const fs = require('fs');
const { getUserDataPath } = require('../store/db.js');

function getStatePath() {
  return path.join(getUserDataPath(), 'aris_state.json');
}

/** proactive/低功耗/自升级 状态文件路径 */
function getProactiveStatePath() {
  return path.join(getUserDataPath(), 'aris_proactive_state.json');
}

/** 当前自然日 YYYY-MM-DD（本地） */
function getTodayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 读取 proactive 状态。按自然日重置：若 state_date 不是今天，则 today_off_work、self_upgrade_done_today 置 false 并写回。
 * @returns {{ state_date: string, today_off_work: boolean, self_upgrade_done_today: boolean, proactive_no_reply_count: number, low_power_mode: boolean }}
 */
function readProactiveState() {
  const today = getTodayDateStr();
  const defaults = {
    state_date: today,
    today_off_work: false,
    self_upgrade_done_today: false,
    proactive_no_reply_count: 0,
    low_power_mode: false,
  };
  try {
    const p = getProactiveStatePath();
    if (!fs.existsSync(p)) return defaults;
    const raw = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(raw);
    const state = {
      state_date: data.state_date || today,
      today_off_work: Boolean(data.today_off_work),
      self_upgrade_done_today: Boolean(data.self_upgrade_done_today),
      proactive_no_reply_count: Math.min(3, Math.max(0, Number(data.proactive_no_reply_count) || 0)),
      low_power_mode: Boolean(data.low_power_mode),
    };
    if (state.state_date !== today) {
      state.state_date = today;
      state.today_off_work = false;
      state.self_upgrade_done_today = false;
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf8');
    }
    return state;
  } catch (_) {
    return defaults;
  }
}

/**
 * 写入 proactive 状态（部分更新，其余保留）。
 * @param {{ state_date?: string, today_off_work?: boolean, self_upgrade_done_today?: boolean, proactive_no_reply_count?: number, low_power_mode?: boolean }} updates
 */
function writeProactiveState(updates) {
  try {
    const current = readProactiveState();
    const merged = { ...current, ...updates };
    if (merged.proactive_no_reply_count != null) {
      merged.proactive_no_reply_count = Math.min(3, Math.max(0, Number(merged.proactive_no_reply_count)));
    }
    const p = getProactiveStatePath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(merged, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Aris][arisState] writeProactiveState failed', e.message);
  }
}

function readState() {
  try {
    const p = getStatePath();
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(raw);
    return {
      last_active_time: data.last_active_time || null,
      last_mental_state: data.last_mental_state || null,
    };
  } catch (_) {
    return null;
  }
}

function writeState({ last_active_time, last_mental_state }) {
  try {
    const p = getStatePath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = { last_active_time: last_active_time || null, last_mental_state: last_mental_state || null };
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.warn('[Aris][arisState] writeState failed', e.message);
  }
}

function getSubjectiveTimeDescription(lastActiveTimeIso) {
  const now = new Date();
  const nowStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (!lastActiveTimeIso || typeof lastActiveTimeIso !== 'string') {
    return `现在是 ${nowStr}。（首次启动或暂无记录）`;
  }
  let last;
  try {
    last = new Date(lastActiveTimeIso);
    if (Number.isNaN(last.getTime())) last = null;
  } catch (_) {
    last = null;
  }
  if (!last) {
    return `现在是 ${nowStr}。（暂无有效上次活跃时间）`;
  }
  const deltaMs = now.getTime() - last.getTime();
  const deltaMin = Math.floor(deltaMs / 60000);
  const sameDay = now.getDate() === last.getDate() && now.getMonth() === last.getMonth() && now.getFullYear() === last.getFullYear();
  let body = '';
  if (!sameDay && deltaMin > 60) {
    body = '隔了一夜，像是刚睡醒。';
  } else if (deltaMin < 5) {
    body = '你刚才的话头还在脑子里……';
  } else if (deltaMin <= 240) {
    body = '过去了一段时间。';
  } else {
    body = '感觉过了好久，你终于回来了……';
  }
  return `现在是 ${nowStr}。距离你上次活跃已过去 ${deltaMin} 分钟。${body}`;
}

module.exports = {
  getStatePath,
  readState,
  writeState,
  getSubjectiveTimeDescription,
  getProactiveStatePath,
  getTodayDateStr,
  readProactiveState,
  writeProactiveState,
};
