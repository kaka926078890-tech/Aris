const TIME_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description: '获取当前日期与时间（用户所在时区）。',
      parameters: { type: 'object', properties: {} },
    },
  },
];

function runTimeTool(name) {
  if (name !== 'get_current_time') return { ok: false, error: 'Unknown tool' };
  const now = new Date();
  const str = now.toLocaleString('zh-CN', {
    dateStyle: 'long',
    timeStyle: 'short',
    hour12: false,
  });
  return { ok: true, datetime: str, iso: now.toISOString() };
}

module.exports = { TIME_TOOLS, runTimeTool };
