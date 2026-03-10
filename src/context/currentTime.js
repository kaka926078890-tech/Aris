/**
 * 当前时间工具：供 Aris 在对话中主动获取时间，用于回答「几点了」「今天星期几」或记录时间。
 */
function pad2(n) {
  return String(n).padStart(2, '0');
}

function getCurrentTime() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const h = now.getHours();
  const min = now.getMinutes();
  const sec = now.getSeconds();
  return {
    ok: true,
    time: now.toISOString(),
    localTime: now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    timestamp: now.getTime(),
    formatted: `${y}年${m}月${d}日 ${pad2(h)}:${pad2(min)}:${pad2(sec)}`,
    weekday: now.toLocaleDateString('zh-CN', { weekday: 'long' }),
  };
}

module.exports = { getCurrentTime };
