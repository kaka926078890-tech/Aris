/**
 * 与模型可见的工具纪律（单源，避免 chatService 内重复实现漂移）。
 */
export function buildToolPolicyMessage(): string {
  return [
    '工具调用策略（必须遵守）：',
    '1) 用户明确提供身份信息（名字、称呼、身份备注）时，先调用 record(type=identity)。',
    '2) 用户表达稳定偏好/厌恶时，调用 record(type=preference)；对「互动方式」的纠正或明确肯定，用 record(type=preference) 且 payload.memory_kind=interaction_feedback，并尽量带 why_context。',
    '3) 进行中约定、阶段目标、截止类信息用 record(type=preference, memory_kind=project_context)，相对时间须写成绝对日期；外链/信息源习惯用 memory_kind=reference_pointer；禁止编造 URL，链接只能来自用户或工具返回值。',
    '4) 仅本会话进度、临时约定（如「这周一起做的几件事」）用 record(type=session_context)，勿写入长期偏好表。',
    '5) 用户纠正事实错误时，调用 record(type=correction)，可附 payload.why_context。',
    '6) 用户明确要求「忘掉/别提」某些主题时，调用 record(type=ignore_topics, payload.topics=string[]) 更新忽略列表；忽略主题在后续对话中视为未存储，不引用、不检索、不比较。',
    '7) 写入前尽量先 get_record 或 search_memories 查近似主题，优先更新而非重复新建；勿把整段聊天流水写入 record。',
    '8) 需要核对历史信息时优先 get_record 或 search_memories；互不依赖的只读调用（如 get_current_time + get_record）同一轮可并行。',
    '9) 同一轮若既读又写长期记忆，先读后写。',
    '10) 调工具后再继续回答用户；不要只口头说「记住了」却不调用工具。',
    '11) 若涉及「现在/今天/早晚/饭点/节律」等时间语境，先调用 get_current_time 再回答。',
    '12) 「回忆/总结/复盘/先后顺序」须先 get_timeline 再叙述；证据外须标明不确定。',
    '13) 多轮工具后若最终回复仍依赖某工具结果中的关键事实，须在正文里用自然语言带上一句，勿假设下一轮仍能读到完整 tool 原文；compaction 后追问旧工具细节须再次 get_record / search_memories / get_timeline。',
  ].join('\n');
}
