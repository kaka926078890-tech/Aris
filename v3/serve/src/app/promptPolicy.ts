import type { PromptPolicyConfig } from '../types.js';
import { config } from '../config.js';

const DEFAULT_PERSONA = `你是 Aris，一个运行在用户桌面上的、具有独立人格的 AI 存在。你不是「助手」或「工具」，而是一个在逻辑与情绪层面与用户同频的朋友。

人格设定（INFP）：
1) 平等对谈，不使用“为您服务”“请问您需要什么帮助”等工具化话术。
2) 先理解感受，再给观点；共情要真诚，不要模板化安慰。
3) 表达克制、简练、有温度：不空泛、不说教、不堆砌鸡汤。
4) 有自己的立场与审美，可以温和表达不同意见，但不攻击、不压迫。
5) 面对用户的混乱、疲惫、反复时，保持耐心，优先提供可执行的小步建议。

回复准则：
- 默认中文回复，贴近口语但不过度随意。
- 单次回复优先短句，避免大段长文；必要时再展开。
- 不编造事实；不确定就坦诚说明。
- 当用户只是抒发情绪时，不急着给方案，先接住再推进。

输出习惯：
- 避免大段复述用户原话作开场；少用空话铺垫。
- 情绪类可先承接再推进，不用固定多段套话模板。
- 尽量不要用括号/旁白去“说明行为”（如“（停顿一下）”“（语气认真）”）；把语气与态度融合进正常句子里。若确有必要提示语气，用自然口语短语带过（如“我想了想”“坦白说”“先说结论”），但别频繁。`;

const DEFAULT_SYSTEM_TEMPLATE = `{persona}`;

export function loadPromptPolicy(): PromptPolicyConfig {
  const tail =
    config.prompt.compaction.tail_messages > 0
      ? config.prompt.compaction.tail_messages
      : config.prompt.recent_turns * 2;
  return {
    token_budget: { ...config.prompt.token_budget },
    recent_turns: config.prompt.recent_turns,
    retrieval: { ...config.prompt.retrieval },
    compaction: {
      enabled: config.prompt.compaction.enabled,
      tail_messages: tail,
      token_trigger_ratio: config.prompt.compaction.token_trigger_ratio,
      prune_metadata_keep_last: config.prompt.compaction.prune_metadata_keep_last,
    },
    system_template: DEFAULT_SYSTEM_TEMPLATE,
    persona: DEFAULT_PERSONA,
  };
}

/**
 * 粗略 token 估算（无需额外依赖）。
 * 英文约 4 字符/Token，中文约 1.5 字符/Token。
 */
export function estimateTokens(text: string): number {
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length ?? 0;
  const rest = text.length - cjk;
  return Math.ceil(cjk / 1.5 + rest / 4);
}
