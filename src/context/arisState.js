const path = require('path');
const fs = require('fs');
const { getUserDataPath } = require('../store/db.js');

function getStatePath() {
  return path.join(getUserDataPath(), 'aris_state.json');
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

module.exports = { getStatePath, readState, writeState, getSubjectiveTimeDescription };
