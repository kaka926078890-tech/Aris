/**
 * 运行状态：aris_state.json、aris_proactive_state.json
 */
const fs = require('fs');
const { getStatePath, getProactiveStatePath, getDataDir } = require('../config/paths.js');

function getTodayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

function writeState(updates) {
  try {
    const current = readState() || {};
    const data = {
      last_active_time: updates.last_active_time !== undefined ? updates.last_active_time : current.last_active_time,
      last_mental_state: updates.last_mental_state !== undefined ? updates.last_mental_state : current.last_mental_state,
    };
    const dir = getDataDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getStatePath(), JSON.stringify(data, null, 2), 'utf8');
    const timeline = require('./timeline.js');
    timeline.appendEntry({ type: 'state', payload: data, actor: 'system' });
  } catch (e) {
    console.warn('[Aris v2][store/state] writeState failed', e?.message);
  }
}

function readProactiveState() {
  const today = getTodayDateStr();
  const defaults = {
    state_date: today,
    today_off_work: false,
    self_upgrade_done_today: false,
    proactive_no_reply_count: 0,
    low_power_mode: false,
    /** 进入低功耗/静默的时间（ISO），用于判断「用户恢复」须为静默之后的新消息 */
    low_power_entered_at: null,
    /** 重要文档最后查看时间 { "docs/aris_ideas.md": "2025-03-17T00:00:00.000Z" }，用于 session 首条提醒 */
    doc_last_viewed: {},
    last_tired_or_quiet_at: null,
    recent_mood_or_scene: '',
    last_sent_expression_desires: [],
    /** 用户最近一次参与对话的时间（ISO），用于主动消息克制 */
    last_user_engaged_at: null,
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
      low_power_entered_at: data.low_power_entered_at || null,
      doc_last_viewed: data.doc_last_viewed && typeof data.doc_last_viewed === 'object' ? data.doc_last_viewed : {},
      last_tired_or_quiet_at: data.last_tired_or_quiet_at || null,
      recent_mood_or_scene: typeof data.recent_mood_or_scene === 'string' ? data.recent_mood_or_scene : '',
      last_sent_expression_desires: Array.isArray(data.last_sent_expression_desires) ? data.last_sent_expression_desires : [],
      last_user_engaged_at: data.last_user_engaged_at || null,
    };
    if (state.state_date !== today) {
      state.state_date = today;
      state.today_off_work = false;
      state.self_upgrade_done_today = false;
      const dir = getDataDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(p, JSON.stringify(state, null, 2), 'utf8');
    }
    return state;
  } catch (_) {
    return defaults;
  }
}

function writeProactiveState(updates) {
  try {
    const current = readProactiveState();
    const merged = { ...current, ...updates };
    if (merged.proactive_no_reply_count != null) {
      merged.proactive_no_reply_count = Math.min(3, Math.max(0, Number(merged.proactive_no_reply_count)));
    }
    const dir = getDataDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getProactiveStatePath(), JSON.stringify(merged, null, 2), 'utf8');
    const timeline = require('./timeline.js');
    timeline.appendEntry({ type: 'proactive_state', payload: merged, actor: 'system' });
  } catch (e) {
    console.warn('[Aris v2][store/state] writeProactiveState failed', e?.message);
  }
}

module.exports = {
  readState,
  writeState,
  readProactiveState,
  writeProactiveState,
  getTodayDateStr,
};
