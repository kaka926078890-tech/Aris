/**
 * 记忆检索：search_memories、get_conversation_near_time、get_user_profile_summary、search_memories_with_time。支持按关联实体过滤（分层记忆）。
 * 纠错与禁止用语已每轮注入【用户约束】，不提供单独工具。
 */
const fs = require('fs');
const store = require('../../../store');
const { getUserProfileSummaryPath } = require('../../../config/paths.js');
const { readRetrievalConfig, getCurrentRelatedEntityIds } = require('../associationContext.js');

const MEMORY_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_memories',
      description: '按语义检索与 query 相关的记忆（对话、偏好等）。仅做语义匹配，不按时间过滤。用户要「检索某时刻附近的对话」时请用 get_conversation_near_time。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词或问题' },
          limit: { type: 'number', description: '最多返回条数', default: 5 },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_conversation_near_time',
      description: '按时间查当前会话在该时刻附近的对话内容（如「16:27」「16:30」）。用户说「检索某时刻附近的记忆」时用此工具，不要用 search_memories 查时间。',
      parameters: {
        type: 'object',
        properties: {
          time_str: { type: 'string', description: '时刻，如 16:27、16:30、或 ISO 如 2026-03-16T08:27:00Z' },
          window_seconds: { type: 'number', description: '前后多少秒，默认 300（5 分钟）' },
        },
        required: ['time_str'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_user_profile_summary',
      description: '获取用户画像/主题线轻量摘要（常聊主题、近期偏好与情绪归纳）。数据来自 memory/user_profile_summary.md，可手动维护或由脚本生成。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_memories_with_time',
      description: '按语义检索记忆，并只保留在指定时间窗口内的结果（created_at 在该区间内）。用于需要「某段时间内的记忆」时。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词或问题' },
          start_time: { type: 'string', description: '时间窗口起点，ISO 如 2026-03-16T00:00:00Z 或 毫秒时间戳' },
          end_time: { type: 'string', description: '时间窗口终点，ISO 或毫秒' },
          limit: { type: 'number', description: '最多返回条数', default: 5 },
        },
        required: ['query', 'start_time', 'end_time'],
      },
    },
  },
];

/**
 * 智能生成检索query：基于原始query和上下文生成更好的检索关键词
 */
/**
 * 轻量字面重叠：弥补纯向量对专名、固定短语的弱匹配（非 BM25 全文替代）。
 */
function keywordOverlapBoost(query, text) {
  const q = String(query || '').toLowerCase().trim();
  const t = String(text || '').toLowerCase();
  if (!q.length || !t.length) return 0;
  if (t.includes(q) && q.length >= 2) return 0.12;
  const parts = q.split(/[\s\u3000,，.。!！?？;；]+/).filter((s) => s.length >= 2);
  if (parts.length === 0) return 0;
  let hits = 0;
  for (const p of parts) {
    if (t.includes(p)) hits += 1;
  }
  return Math.min(0.22, (hits / parts.length) * 0.22);
}

function generateSmartQuery(originalQuery, context) {
  if (!originalQuery || typeof originalQuery !== 'string') return originalQuery || '';
  
  const query = originalQuery.trim();
  
  // 如果是简单查询，直接返回
  if (query.length <= 20) return query;
  
  // 尝试提取关键信息
  const patterns = [
    // 提取问题关键词
    /(什么|怎么|如何|为什么|哪|谁|多少|多久|多大|多长|多远)([^？?。.!！]+)/,
    // 提取主题关键词
    /关于([^的]+)(的|问题|话题)/,
    // 提取具体对象
    /(游戏|记忆|系统|代码|配置|文件|工具|模型)([^？?。.!！]+)/,
  ];
  
  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match) {
      // 返回匹配到的关键部分
      const keyPart = match[1] || match[2] || match[0];
      if (keyPart && keyPart.length > 2 && keyPart.length < 50) {
        return keyPart.trim();
      }
    }
  }
  
  // 如果查询太长，取前50个字符
  if (query.length > 50) {
    return query.slice(0, 50);
  }
  
  return query;
}

/**
 * 动态计算记忆类型权重：根据对话上下文调整权重
 */
function calculateDynamicWeights(context, config) {
  const baseWeights = config.memory_type_weights || {
    dialogue_turn: 1.0,
    user_preference: 1.2,
    requirement: 1.5,
    identity: 1.8
  };
  
  if (!config.context_aware_weights) return baseWeights;
  
  const userMessage = context.userMessage || '';
  const recentTopics = context.recentTopics || [];
  
  // 根据上下文调整权重
  const adjustedWeights = { ...baseWeights };
  
  // 如果用户提到身份相关话题，提高身份权重
  if (userMessage.includes('身份') || userMessage.includes('名字') || userMessage.includes('称呼')) {
    adjustedWeights.identity = baseWeights.identity * 1.5;
  }
  
  // 如果用户提到要求或偏好，提高相关权重
  if (userMessage.includes('要求') || userMessage.includes('偏好') || userMessage.includes('喜欢')) {
    adjustedWeights.requirement = baseWeights.requirement * 1.3;
    adjustedWeights.user_preference = baseWeights.user_preference * 1.3;
  }
  
  // 如果最近讨论过系统或代码，提高要求权重（通常是配置相关）
  if (recentTopics.some(topic => topic.includes('系统') || topic.includes('代码') || topic.includes('配置'))) {
    adjustedWeights.requirement = baseWeights.requirement * 1.4;
  }
  
  return adjustedWeights;
}

/**
 * 应用记忆类型权重调整得分
 */
function applyMemoryTypeWeights(rows, config, context) {
  if (!rows || !rows.length) return rows;
  
  const weights = calculateDynamicWeights(context, config);
  
  return rows.map(row => {
    const type = row.type || 'dialogue_turn';
    const weight = weights[type] || 1.0;
    const adjustedScore = (row._score || 0) * weight;
    
    // 时间衰减：越近的记忆权重越高
    const now = Date.now();
    const memoryTime = row.created_at ? Number(row.created_at) : now;
    const timeDiffHours = (now - memoryTime) / (1000 * 60 * 60);
    const timeWeight = Math.max(0.5, Math.exp(-timeDiffHours / 24)); // 24小时衰减
    
    return { ...row, _score: adjustedScore * timeWeight };
  });
}

/**
 * 判断是否需要检索记忆：基于对话上下文智能决策
 */
function shouldRetrieveMemory(userMessage, recentConversation, config) {
  if (!config.dynamic_retrieval_enabled) return true;
  
  const message = userMessage.toLowerCase();
  
  // 明确需要检索的关键词
  const retrievalKeywords = [
    '记得', '之前', '以前', '上次', '记忆',
    '偏好', '习惯', '喜欢', '讨厌', '要求',
    '身份', '名字', '称呼', '系统', '代码',
    '配置', '问题', '改进', '方案', '讨论'
  ];
  
  // 明确不需要检索的关键词（简单问候等）
  const noRetrievalKeywords = [
    '你好', '在吗', 'hi', 'hello', '早上好', '晚上好',
    '谢谢', '拜拜', '再见', 'ok', '好的', '嗯'
  ];
  
  // 检查是否需要检索
  const hasRetrievalKeyword = retrievalKeywords.some(keyword => message.includes(keyword));
  const hasNoRetrievalKeyword = noRetrievalKeywords.some(keyword => message.includes(keyword));
  
  // 如果是复杂问题或长消息，倾向于检索
  const isComplexMessage = message.length > 30 || message.includes('?') || message.includes('？');
  
  // 如果最近对话中提到过相关话题，倾向于检索
  const recentContext = recentConversation.slice(-3).join(' ').toLowerCase();
  const hasRecentContext = retrievalKeywords.some(keyword => recentContext.includes(keyword));
  
  // 决策逻辑
  if (hasRetrievalKeyword) return true;
  if (hasNoRetrievalKeyword) return false;
  if (isComplexMessage) return true;
  if (hasRecentContext) return true;
  
  // 无明确信号时不随机检索（避免行为抖动）
  return false;
}

async function runMemoryTool(name, args) {
  const a = args || {};
  try {
    if (name === 'search_memories') {
      if (!store.vector) {
        console.info('[Aris v2] 召回: 向量库未就绪');
        return { ok: true, memories: [], text: '（向量库未就绪）' };
      }
      const config = readRetrievalConfig();
      const limit = Math.min(Math.max(Number(a.limit) || 5, 1), 15);
      const maxExp = Math.min(Math.max(Number(config.max_experience_results) || 10, 1), 20);
      const useLimit = config.filter_experience_by_association ? maxExp : limit;
      const filterByEntities = config.filter_experience_by_association ? getCurrentRelatedEntityIds() : undefined;
      const searchOptions = filterByEntities && filterByEntities.length > 0 ? { filterByEntities } : undefined;
      
      // 智能生成检索query
      const smartQuery = generateSmartQuery(a.query || '');
      console.info('[Aris v2] 原始query:', (a.query || '').slice(0, 40), '智能query:', smartQuery.slice(0, 40));
      
      const rows = await store.vector.search(smartQuery, useLimit * 2, searchOptions); // 获取更多结果用于权重调整
      
      // 构建上下文用于动态权重计算
      const context = {
        userMessage: a.query || '',
        recentTopics: []
      };
      
      // 应用动态记忆类型权重 + 字面重叠微调
      let weightedRows = applyMemoryTypeWeights(rows, config, context);
      weightedRows = weightedRows.map((row) => {
        const boost = keywordOverlapBoost(smartQuery, row.text);
        return { ...row, _score: (row._score || 0) * (1 + boost) };
      });

      // 重新排序
      weightedRows.sort((a, b) => (b._score || 0) - (a._score || 0));
      
      // 取前limit个结果
      const finalRows = weightedRows.slice(0, limit);
      
      const texts = finalRows.map((r) => r.text).filter(Boolean);
      const summaryLine = texts.length
        ? '根据检索，与当前话题相关的有：' + texts.slice(0, 2).map((t) => (t || '').trim().slice(0, 40)).filter(Boolean).join('；') + (texts.length > 2 ? '…' : '')
        : '';
      console.info('[Aris v2] 召回:', texts.length, '条, smart_query=', smartQuery.slice(0, 40), filterByEntities ? ', filterByEntity' : '');
      return {
        ok: true,
        memories: texts,
        text: texts.length ? texts.join('\n---\n') : '（无相关记忆）',
        summary_line: summaryLine,
      };
    }
    if (name === 'search_memories_with_time') {
      if (!store.vector) {
        return { ok: true, memories: [], text: '（向量库未就绪）' };
      }
      const limit = Math.min(Math.max(Number(a.limit) || 5, 1), 15);
      const parseMs = (v) => {
        if (v == null) return NaN;
        if (typeof v === 'number' && !Number.isNaN(v)) return v < 1e13 ? v * 1000 : v;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? NaN : d.getTime();
      };
      const startMs = parseMs(a.start_time);
      const endMs = parseMs(a.end_time);
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
        return { ok: false, error: 'start_time 或 end_time 无法解析，请用 ISO 或毫秒时间戳' };
      }
      
      // 1. 时间窗口验证：结束时间必须晚于开始时间
      if (endMs < startMs) {
        return { 
          ok: false, 
          error: 'end_time 必须晚于 start_time',
          suggestion: `开始时间: ${new Date(startMs).toLocaleString()}, 结束时间: ${new Date(endMs).toLocaleString()}` 
        };
      }
      
      // 2. 时间窗口大小检查
      const timeWindowMs = endMs - startMs;
      const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30天
      const LARGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7天
      
      if (timeWindowMs > MAX_WINDOW_MS) {
        console.warn(`[Aris v2] 时间窗口过大（${Math.round(timeWindowMs/(24*60*60*1000))}天），可能影响性能`);
        // 可以添加建议：建议缩小时间范围
      } else if (timeWindowMs > LARGE_WINDOW_MS) {
        console.info(`[Aris v2] 时间窗口较大（${Math.round(timeWindowMs/(24*60*60*1000))}天），建议缩小范围以提高准确性`);
      }
      
      // 3. 优化fetchLimit计算
      // 基于时间窗口大小动态调整fetchLimit
      // 假设密度与时间窗口成反比：时间窗口越大，密度越低
      const baseDensity = 0.3; // 基础密度假设
      const windowFactor = Math.max(0.1, Math.min(1.0, 7 / (timeWindowMs / (24*60*60*1000)))); // 7天窗口密度为1，越大密度越低
      const expectedDensity = baseDensity * windowFactor;
      
      const fetchLimit = Math.max(
        limit * 3, 
        Math.ceil(limit / Math.max(0.1, expectedDensity))
      );
      
      console.info(`[Aris v2] 时间窗口检索: 窗口=${Math.round(timeWindowMs/(24*60*60*1000))}天, 期望密度=${expectedDensity.toFixed(2)}, fetchLimit=${fetchLimit}`);
      
      const rows = await store.vector.search(a.query || '', fetchLimit);
      const timeFiltered = rows.filter((r) => {
        const t = r.created_at != null ? Number(r.created_at) : 0;
        return t >= startMs && t <= endMs;
      });
      
      // 提前定义时间字符串，确保在所有路径中都可用
      const startStr = new Date(startMs).toLocaleString();
      const endStr = new Date(endMs).toLocaleString();
      
      // 4. 明确的结果处理逻辑
      if (timeFiltered.length === 0) {
        // 明确告知用户时间范围内没有结果
        return { 
          ok: true, 
          memories: [], 
          text: `在指定时间范围内（${startStr} 到 ${endStr}）没有找到相关记忆`,
          suggestion: '尝试扩大时间范围或调整查询关键词'
        };
      }
      
      const result = timeFiltered.slice(0, limit);
      const texts = result.map((r) => r.text).filter(Boolean);
      console.info('[Aris v2] 召回(带时间):', texts.length, '条, query=', (a.query || '').slice(0, 40));
      return { 
        ok: true, 
        memories: texts, 
        text: texts.length ? texts.join('\n---\n') : '（无该时间范围内的相关记忆）',
        time_window_info: {
          start: startStr,
          end: endStr,
          window_days: Math.round(timeWindowMs/(24*60*60*1000)),
          results_count: texts.length
        }
      };
    }
    if (name === 'get_user_profile_summary') {
      const p = getUserProfileSummaryPath();
      if (fs.existsSync(p)) {
        try {
          const content = fs.readFileSync(p, 'utf8').trim();
          return { ok: true, content, text: content };
        } catch (e) {
          return { ok: false, error: e?.message };
        }
      }
      return { ok: true, content: '（暂无用户画像摘要，可手动在数据目录 memory/ 下创建 user_profile_summary.md）', text: '（暂无）' };
    }
    if (name === 'get_conversation_near_time') {
      const timeStr = (a.time_str || '').trim();
      const windowSec = Math.min(3600, Math.max(60, Number(a.window_seconds) || 300));
      if (!timeStr) return { ok: false, error: '缺少 time_str' };
      let aroundIso;
      if (/^\d{4}-\d{2}-\d{2}T/.test(timeStr) || /^\d{4}-\d{2}-\d{2}\s/.test(timeStr)) {
        try {
          aroundIso = new Date(timeStr).toISOString();
          if (Number.isNaN(new Date(timeStr).getTime())) aroundIso = null;
        } catch (_) {
          aroundIso = null;
        }
      } else {
        const match = timeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (match) {
          const d = new Date();
          d.setHours(parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10) || 0, 0);
          aroundIso = d.toISOString();
        } else {
          aroundIso = null;
        }
      }
      if (!aroundIso) return { ok: false, error: '无法解析时间，请用 16:27 或 ISO 格式' };
      const sessionId = await store.conversations.getCurrentSessionId();
      const messages = await store.conversations.getConversationAroundTime(sessionId, aroundIso, windowSec);
      const text = messages.length
        ? messages.map((m) => `${m.role === 'user' ? '用户' : 'Aris'}: ${(m.content || '').slice(0, 800)}`).join('\n')
        : '（该时刻附近无对话记录，或不在当前会话）';
      return { ok: true, messages, text };
    }
  } catch (e) {
    return { ok: false, error: e?.message };
  }
  return { ok: false, error: 'Unknown tool' };
}

module.exports = { MEMORY_TOOLS, runMemoryTool, shouldRetrieveMemory, generateSmartQuery };