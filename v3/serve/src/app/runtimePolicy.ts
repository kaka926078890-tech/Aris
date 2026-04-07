export interface RuntimePolicyToolRequirement {
  name: 'get_current_time' | 'get_timeline';
  args: Record<string, unknown>;
  reason: string;
}

interface CorrectionEntry {
  previous: string;
  correction: string;
  why_context?: string | null;
}

type ConsequenceType = 'require_tool' | 'inject_rule' | 'set_flag';

type RuntimeConsequence =
  | {
      type: 'require_tool';
      name: 'get_current_time' | 'get_timeline';
      args: Record<string, unknown>;
      reason: string;
    }
  | { type: 'inject_rule'; text: string }
  | { type: 'set_flag'; flag: keyof RuntimePolicyFlags; value: boolean };

interface RuntimeRule {
  id: string;
  forbid: string;
  reason: string;
  test: (userText: string) => boolean;
  consequences: RuntimeConsequence[];
}

export interface RuntimePolicyFlags {
  block_unverified_system_blame: boolean;
  disallow_history_time_tag: boolean;
  enforce_complete_tail: boolean;
}

export interface RuntimePolicyMatch {
  id: string;
  forbid: string;
  reason: string;
}

export interface RuntimePolicyHitStats {
  rules_hit: string[];
  consequence_hits: Array<{ rule_id: string; type: ConsequenceType; detail: string }>;
  rules_total: number;
  rules_hit_count: number;
  consequence_applied_count: number;
}

export interface RuntimePolicyExecution {
  required_tools: RuntimePolicyToolRequirement[];
  injected_rules: string[];
  flags: RuntimePolicyFlags;
  matches: RuntimePolicyMatch[];
  stats: RuntimePolicyHitStats;
}

const TIME_CONTEXT_RE =
  /(现在|今天|今晚|明天|后天|几点|时间|日期|周几|早上|中午|下午|晚上|饭点|截止|deadline|ddl|多久)/i;

const TIMELINE_CONTEXT_RE =
  /(回忆|复盘|总结|先后|时间线|当时|之前|后来|发生了什么|记得.*吗|我说过|你说过|证据|原话)/i;

const BASE_RULES: RuntimeRule[] = [
  {
    id: 'base.complete_tail',
    forbid: '禁止未完成句收尾（如“我...”“但是...”）',
    reason: '未收束回复会被用户误解为系统异常或模型失忆。',
    test: () => true,
    consequences: [
      { type: 'inject_rule', text: '回复必须完整收束，不得以未完成句结尾（如“我...”“但是...”）。' },
      { type: 'set_flag', flag: 'enforce_complete_tail', value: true },
    ],
  },
  {
    id: 'base.no_unverified_blame',
    forbid: '无证据时禁止归因“系统卡住/网络异常/后端截断”',
    reason: '错误归因会污染记忆并降低对话可信度。',
    test: () => true,
    consequences: [
      {
        type: 'inject_rule',
        text: '除非有明确证据，不要把问题归因于“系统卡住/网络异常/后端截断”。',
      },
      { type: 'set_flag', flag: 'block_unverified_system_blame', value: true },
    ],
  },
  {
    id: 'ctx.time_require_tool',
    forbid: '涉及时间语境时禁止跳过实时时间核对',
    reason: '时间错位会触发明显语境错误（例如白天说晚安）。',
    test: (userText) => TIME_CONTEXT_RE.test(userText),
    consequences: [
      {
        type: 'require_tool',
        name: 'get_current_time',
        args: {},
        reason: '检测到时间语境关键词，先取当前时间再回答。',
      },
    ],
  },
  {
    id: 'ctx.timeline_require_tool',
    forbid: '涉及复盘/先后顺序时禁止无证据叙述',
    reason: '会把旧内容与当前问题错位混合，导致“窜数据”观感。',
    test: (userText) => TIMELINE_CONTEXT_RE.test(userText),
    consequences: [
      {
        type: 'require_tool',
        name: 'get_timeline',
        args: { limit: 30, include_global_records: true },
        reason: '检测到回忆/复盘/先后顺序语境，先取可验证时间线证据。',
      },
      {
        type: 'inject_rule',
        text: '涉及先后顺序时只能基于证据叙述，不得臆测。',
      },
    ],
  },
];

const FINAL_RULE_BASE = '优先给出可验证事实，再给情绪化表述。';

export function executeRuntimePolicy(
  userText: string,
  corrections: CorrectionEntry[],
): RuntimePolicyExecution {
  const correctionRules = deriveCorrectionRules(corrections);
  const allRules = [...BASE_RULES, ...correctionRules];

  const required_tools: RuntimePolicyToolRequirement[] = [];
  const injectedRuleSet = new Set<string>([FINAL_RULE_BASE]);
  const flags: RuntimePolicyFlags = {
    block_unverified_system_blame: false,
    disallow_history_time_tag: false,
    enforce_complete_tail: false,
  };
  const matches: RuntimePolicyMatch[] = [];
  const consequence_hits: Array<{ rule_id: string; type: ConsequenceType; detail: string }> = [];

  for (const rule of allRules) {
    if (!rule.test(userText)) continue;
    matches.push({ id: rule.id, forbid: rule.forbid, reason: rule.reason });
    for (const c of rule.consequences) {
      if (c.type === 'require_tool') {
        required_tools.push({ name: c.name, args: c.args, reason: c.reason });
        consequence_hits.push({
          rule_id: rule.id,
          type: c.type,
          detail: `${c.name}`,
        });
      } else if (c.type === 'inject_rule') {
        injectedRuleSet.add(c.text);
        consequence_hits.push({
          rule_id: rule.id,
          type: c.type,
          detail: c.text,
        });
      } else if (c.type === 'set_flag') {
        flags[c.flag] = c.value;
        consequence_hits.push({
          rule_id: rule.id,
          type: c.type,
          detail: `${c.flag}=${String(c.value)}`,
        });
      }
    }
  }

  const dedupedTools = required_tools.filter(
    (tool, idx, arr) => arr.findIndex((x) => x.name === tool.name) === idx,
  );

  return {
    required_tools: dedupedTools,
    injected_rules: [...injectedRuleSet],
    flags,
    matches,
    stats: {
      rules_total: allRules.length,
      rules_hit_count: matches.length,
      consequence_applied_count: consequence_hits.length,
      rules_hit: matches.map((m) => m.id),
      consequence_hits,
    },
  };
}

function deriveCorrectionRules(corrections: CorrectionEntry[]): RuntimeRule[] {
  const out: RuntimeRule[] = [];
  const agg = `${corrections
    .map((c) => `${c.previous || ''}\n${c.correction || ''}\n${c.why_context || ''}`)
    .join('\n')}`;

  if (/不喜欢被反问|不要反问|别反问/u.test(agg)) {
    out.push({
      id: 'correction.no_counter_question',
      forbid: '禁止反问句驱动对话',
      reason: '用户明确反复纠正：反问会显得冒犯或机械。',
      test: () => true,
      consequences: [{ type: 'inject_rule', text: '默认不用反问句推进对话；优先直接陈述。' }],
    });
  }

  if (/强行联系上下文|刻意|生硬|自然结束|为了联系而联系/u.test(agg)) {
    out.push({
      id: 'correction.no_forced_bridge',
      forbid: '禁止为了连贯而硬加桥接句',
      reason: '会制造“读起来很假”的陪伴体验。',
      test: () => true,
      consequences: [{ type: 'inject_rule', text: '不要为“看起来连贯”而硬加桥接句，能自然收尾就收尾。' }],
    });
  }

  if (/时间顺序|先后|之前|之后|混淆/u.test(agg)) {
    out.push({
      id: 'correction.strict_timeline',
      forbid: '禁止时间线臆测',
      reason: '会破坏用户对“你记得真实对话”的信任。',
      test: () => true,
      consequences: [{ type: 'inject_rule', text: '涉及先后顺序时只能基于证据叙述，不得臆测。' }],
    });
  }

  if (/历史时间|时间标签|\[\s*历史时间/u.test(agg)) {
    out.push({
      id: 'correction.no_history_time_tag',
      forbid: '禁止输出历史时间标签文本',
      reason: '该格式被用户明确纠正为错误表达。',
      test: () => true,
      consequences: [
        { type: 'inject_rule', text: '禁止输出类似“[历史时间 xx/xx xx:xx]”的标签文本。' },
        { type: 'set_flag', flag: 'disallow_history_time_tag', value: true },
      ],
    });
  }

  if (/晚安|下午|时间逻辑|语境节点/u.test(agg)) {
    out.push({
      id: 'correction.time_phrase_consistency',
      forbid: '禁止时间称谓错位（白天说晚安）',
      reason: '用户已明确纠错，会显著破坏陪伴真实感。',
      test: () => true,
      consequences: [{ type: 'inject_rule', text: '时间称谓必须与当前时段一致，避免在白天使用“晚安”等错位表达。' }],
    });
  }

  return out;
}

export function applyRuntimeConsequences(
  text: string,
  execution: RuntimePolicyExecution,
): { text: string; applied: string[] } {
  let out = text || '';
  const applied: string[] = [];

  if (execution.flags.disallow_history_time_tag) {
    const next = out.replace(/\[\s*历史时间[^\]]+\]/gu, '').replace(/\s{2,}/g, ' ').trim();
    if (next !== out) applied.push('strip_history_time_tag');
    out = next;
  }

  if (execution.flags.block_unverified_system_blame) {
    const blameRe =
      /(后端截断|系统卡住|网络异常|传输过程被截断|接口出问题|页面渲染漏字)/gu;
    if (blameRe.test(out)) {
      out = out.replace(
        blameRe,
        '具体原因尚未证实',
      );
      applied.push('rewrite_unverified_blame');
    }
  }

  return { text: out, applied };
}

export function buildRuntimePolicyMessage(execution: RuntimePolicyExecution): string {
  const lines = ['运行时强约束（必须遵守）：'];
  execution.injected_rules.forEach((rule, idx) => lines.push(`${idx + 1}) ${rule}`));
  return lines.join('\n');
}
