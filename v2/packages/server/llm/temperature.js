/**
 * 主对话默认采样温度：可通过 ARIS_CHAT_TEMPERATURE 覆盖（0～2），默认略低于 0.7 以利于风格稳定。
 */
function getChatTemperature() {
  const raw = process.env.ARIS_CHAT_TEMPERATURE;
  if (raw === undefined || raw === '') return 0.62;
  const t = Number(raw);
  if (Number.isNaN(t)) return 0.62;
  return Math.min(2, Math.max(0, t));
}

module.exports = { getChatTemperature };
