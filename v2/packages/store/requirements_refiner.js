/**
 * 用户要求智能提炼器
 * 优先使用 LLM 做语义合并、去重和总结；失败或未配置时回退到规则提炼
 */

let chatForRefinement = null;
try {
  const client = require('../server/llm/client.js');
  chatForRefinement = client.chat;
} catch (_) {
  // 非 server 上下文或路径不可用时仅用规则
}

class RequirementsRefiner {
  constructor() {
    this.cache = new Map();
  }

  /**
   * 智能提炼用户要求：优先 LLM，失败则规则回退
   * @param {Array} requirements 原始要求列表
   * @param {string} newRequirement 新要求
   * @returns {Promise<Array>} 提炼后的要求列表
   */
  async refine(requirements, newRequirement) {
    try {
      const allRequirements = [...requirements, newRequirement];

      if (allRequirements.length <= 3) {
        return allRequirements;
      }

      const prompt = this._createRefinementPrompt(allRequirements);

      // 1. 优先使用 LLM 提炼
      const llmRefined = await this._callLLMRefinement(prompt, allRequirements.length);
      if (Array.isArray(llmRefined) && llmRefined.length > 0) {
        console.log(`[RequirementsRefiner] LLM 提炼完成: ${allRequirements.length} -> ${llmRefined.length} 项`);
        return llmRefined;
      }

      // 2. 回退：规则提炼
      const refined = await this._ruleBasedRefinement(allRequirements);
      console.log(`[RequirementsRefiner] 规则提炼完成: ${allRequirements.length} -> ${refined.length} 项`);
      return refined;
    } catch (error) {
      console.error('[RequirementsRefiner] 提炼失败:', error);
      return [...requirements, newRequirement];
    }
  }

  /**
   * 调用 LLM 进行提炼，解析失败或未配置时返回 null
   */
  async _callLLMRefinement(prompt, originalCount) {
    if (typeof chatForRefinement !== 'function') return null;
    if (!process.env.DEEPSEEK_API_KEY) return null;

    try {
      const { content, error } = await chatForRefinement([
        { role: 'user', content: prompt },
      ]);
      if (error || !content || typeof content !== 'string') return null;

      const list = this._parseLLMRefinementOutput(content);
      if (!list.length) return null;
      if (list.length > Math.max(originalCount * 2, 50)) return null;

      return list;
    } catch (e) {
      console.warn('[RequirementsRefiner] LLM 调用失败，使用规则回退:', e?.message);
      return null;
    }
  }

  /**
   * 解析 LLM 输出：按行拆分，去掉行首编号
   */
  _parseLLMRefinementOutput(content) {
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.replace(/^\s*\d+[.．、]\s*/, '').trim())
      .filter((s) => s.length > 0);
    return lines;
  }

  /**
   * 创建 AI 提炼提示词
   */
  _createRefinementPrompt(requirements) {
    return `你是一个专业的用户需求分析助手。请对以下用户要求进行智能提炼。

原始要求列表：
${requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}

请按照以下规则进行提炼：
1. 合并语义相同或相似的要求
2. 将相关要求分组总结
3. 保持要求的准确性和完整性
4. 使用简洁明确的表达
5. 保留重要的细节和约束条件
6. 去除重复和冗余信息

请只输出提炼后的要求列表，每项一行，行首可带编号（如 1. 2. 或 1．2．），不要其他解释。`;
  }

  /**
   * 基于规则的提炼逻辑（临时方案）
   */
  async _ruleBasedRefinement(requirements) {
    // 去重（精确匹配）
    const uniqueReqs = [...new Set(requirements)];
    
    // 语义分组
    const groups = this._groupBySemantics(uniqueReqs);
    
    // 提炼每个组
    const refined = [];
    
    for (const [category, items] of Object.entries(groups)) {
      if (items.length === 0) continue;
      
      if (items.length === 1) {
        // 单个要求，直接保留
        refined.push(items[0]);
      } else if (category === 'communication_style') {
        // 沟通风格组提炼
        const summary = this._refineCommunicationStyle(items);
        refined.push(summary);
      } else if (category === 'behavior_rules') {
        // 行为规则组提炼
        const summary = this._refineBehaviorRules(items);
        refined.push(summary);
      } else if (category === 'technical_requirements') {
        // 技术要求组提炼
        const summary = this._refineTechnicalRequirements(items);
        refined.push(summary);
      } else if (category === 'functional_requirements') {
        // 功能需求组提炼
        const summary = this._refineFunctionalRequirements(items);
        refined.push(summary);
      } else {
        // 其他要求，尝试合并
        const merged = this._mergeSimilarRequirements(items);
        refined.push(...merged);
      }
    }
    
    return refined;
  }

  /**
   * 按语义分组
   */
  _groupBySemantics(requirements) {
    const groups = {
      'communication_style': [],    // 沟通风格
      'behavior_rules': [],         // 行为规则
      'technical_requirements': [], // 技术要求
      'functional_requirements': [], // 功能需求
      'other': []                   // 其他
    };
    
    requirements.forEach(req => {
      const lower = req.toLowerCase();
      
      // 沟通风格相关
      if (lower.includes('说话') || lower.includes('语言') || lower.includes('表达') || 
          lower.includes('比喻') || lower.includes('文绉绉') || lower.includes('简洁') ||
          lower.includes('方式') || lower.includes('风格')) {
        groups.communication_style.push(req);
      }
      // 行为规则相关
      else if (lower.includes('行为') || lower.includes('规则') || lower.includes('应该') ||
               lower.includes('不要') || lower.includes('不能') || lower.includes('必须') ||
               lower.includes('歇会') || lower.includes('安静') || lower.includes('朋友') ||
               lower.includes('观察者')) {
        groups.behavior_rules.push(req);
      }
      // 技术要求相关
      else if (lower.includes('改进') || lower.includes('优化') || lower.includes('修复') ||
               lower.includes('问题') || lower.includes('机制') || lower.includes('系统') ||
               lower.includes('设计') || lower.includes('记录') || lower.includes('存储') ||
               lower.includes('token') || lower.includes('提炼') || lower.includes('总结')) {
        groups.technical_requirements.push(req);
      }
      // 功能需求相关
      else if (lower.includes('功能') || lower.includes('需求') || lower.includes('需要') ||
               lower.includes('想要') || lower.includes('希望') || lower.includes('要求') ||
               lower.includes('增加') || lower.includes('添加') || lower.includes('实现')) {
        groups.functional_requirements.push(req);
      }
      else {
        groups.other.push(req);
      }
    });
    
    return groups;
  }

  /**
   * 提炼沟通风格要求
   */
  _refineCommunicationStyle(items) {
    const hasNoMetaphor = items.some(r => r.toLowerCase().includes('比喻'));
    const hasSimpleStyle = items.some(r => r.toLowerCase().includes('文绉绉') || r.includes('简洁'));
    const hasDirectStyle = items.some(r => r.toLowerCase().includes('直接') || r.includes('简单'));
    
    let summary = '沟通风格：';
    if (hasNoMetaphor) summary += '减少比喻和文绉绉的表达，';
    if (hasSimpleStyle) summary += '使用简洁明了的语言，';
    if (hasDirectStyle) summary += '直接表达，避免绕弯子，';
    
    // 去掉最后一个逗号
    summary = summary.slice(0, -1);
    
    return summary;
  }

  /**
   * 提炼行为规则要求
   */
  _refineBehaviorRules(items) {
    const hasQuietRule = items.some(r => r.toLowerCase().includes('歇会') || r.includes('安静'));
    const hasFriendRule = items.some(r => r.toLowerCase().includes('朋友') && !r.includes('观察者'));
    const hasNotObserver = items.some(r => r.toLowerCase().includes('观察者') && r.includes('不要'));
    const hasSummaryRule = items.some(r => r.toLowerCase().includes('总结') && r.includes('做完'));
    
    let summary = '行为规则：';
    if (hasQuietRule) summary += '当用户说"歇会"时进入安静模式，';
    if (hasFriendRule) summary += '定位为朋友而非工具，';
    if (hasNotObserver) summary += '不要作为观察者，';
    if (hasSummaryRule) summary += '完成任务后提供总结，';
    
    summary = summary.slice(0, -1);
    return summary;
  }

  /**
   * 提炼技术要求
   */
  _refineTechnicalRequirements(items) {
    const hasRecordImprovement = items.some(r => r.toLowerCase().includes('记录') && r.includes('机制'));
    const hasTokenOptimization = items.some(r => r.toLowerCase().includes('token'));
    const hasRefinement = items.some(r => r.toLowerCase().includes('提炼') || r.includes('总结'));
    
    let summary = '技术要求：';
    if (hasRecordImprovement) summary += '改进记录机制（避免覆盖、支持累积），';
    if (hasTokenOptimization) summary += '优化token使用（智能提炼要求），';
    if (hasRefinement) summary += '自动提炼和总结用户要求，';
    
    summary = summary.slice(0, -1);
    return summary;
  }

  /**
   * 提炼功能需求
   */
  _refineFunctionalRequirements(items) {
    return `功能需求：共${items.length}项具体要求（已分类管理）`;
  }

  /**
   * 合并相似要求
   */
  _mergeSimilarRequirements(items) {
    if (items.length <= 1) return items;
    
    // 简单的关键词合并
    const merged = [];
    const processed = new Set();
    
    for (let i = 0; i < items.length; i++) {
      if (processed.has(i)) continue;
      
      const current = items[i];
      let mergedItem = current;
      processed.add(i);
      
      // 查找相似项
      for (let j = i + 1; j < items.length; j++) {
        if (processed.has(j)) continue;
        
        const other = items[j];
        if (this._areSimilar(current, other)) {
          mergedItem = this._mergeTwoRequirements(current, other);
          processed.add(j);
        }
      }
      
      merged.push(mergedItem);
    }
    
    return merged;
  }

  /**
   * 判断两个要求是否相似
   */
  _areSimilar(req1, req2) {
    const words1 = req1.toLowerCase().split(/[\s,，。.]+/);
    const words2 = req2.toLowerCase().split(/[\s,，。.]+/);
    
    // 计算共同词汇比例
    const set1 = new Set(words1.filter(w => w.length > 1));
    const set2 = new Set(words2.filter(w => w.length > 1));
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    const similarity = intersection.size / union.size;
    return similarity > 0.3; // 30%相似度阈值
  }

  /**
   * 合并两个要求
   */
  _mergeTwoRequirements(req1, req2) {
    // 简单的合并逻辑：取更详细的那个
    if (req1.length >= req2.length) {
      return req1;
    } else {
      return req2;
    }
  }

  /**
   * 获取要求统计信息
   */
  getStatistics(originalCount, refinedCount) {
    return {
      originalCount,
      refinedCount,
      reduction: originalCount - refinedCount,
      reductionRate: refinedCount > 0 ? ((originalCount - refinedCount) / originalCount * 100).toFixed(1) : '0.0'
    };
  }
}

module.exports = RequirementsRefiner;