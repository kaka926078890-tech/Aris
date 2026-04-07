# Aris Runtime Prohibitions (Claude-Code Inspired)

## Why this exists

Aris is a companion-style chat agent. We keep personality expressive, but move fragile behavior control into a thin runtime policy layer.

This follows the same practical pattern seen in Claude Code public examples:
- short, enforceable rules,
- deterministic pre-checks / hooks,
- avoid relying on long prompts for correctness.

## Core design adopted

1. **Mode engine rule schema (not plain text rules)**
   - Each rule is structured as:
     - `forbid` (what is disallowed),
     - `reason` (why it is disallowed),
     - `consequences` (what must happen when matched).
   - Goal: enforceability and debuggability, not prose persuasion.

2. **Deterministic tool gating before generation**
   - Time context -> force `get_current_time`.
   - Recall/review/timeline intent -> force `get_timeline`.
   - Latest/news/external-fact intent -> force `web_search`.
   - Facts are prefetched and injected as runtime facts.

3. **Post-generation safety/quality gate**
   - Normalize output and close dangling tails to avoid unfinished endings.

4. **Observable policy execution**
   - Each turn logs rule hits, consequence hits, prefetched tools, and post-generation consequence rewrites.

## Runtime rule mode (forbid / reason / consequence)

Implemented in `runtimePolicy.ts` as a rule table:

- `forbid`: e.g. "禁止未完成句收尾"
- `reason`: e.g. "会被用户误解为系统异常或模型失忆"
- `consequences`:
  - `require_tool` (force prefetch tools),
  - `inject_rule` (short runtime hard constraints),
  - `set_flag` (enable consequence executor gates).

This is the same control shape you asked for: not "write more prompt", but "evaluate rule -> execute consequence".

## Prohibition rules currently enforced

- Reply must end as a complete sentence; no dangling tails like `我...` or `但是...`.
- Do not default to blaming transport/system instability unless evidence exists.
- Prefer verifiable facts first, then emotional expression.
- Default to direct statements; avoid counter-question style when not necessary.
- Do not add forced bridge sentences just to appear coherent.
- Timeline/order claims must be evidence-based only.
- Do not output synthetic history-time tags (for example `[历史时间 ...]`).
- Time phrases must match actual local time context (avoid daytime `晚安`).
- External/latest fact questions must run `web_search` first and cite returned source URLs.

## Rules derived from existing correction data

Derived from current `corrections` entries in `data/aris.db`:

1. **No counter-question drift**
   - User repeatedly corrected "do not use reflexive questioning style".

2. **No forced context bridging**
   - User corrected unnatural "connective add-on sentence" behavior.

3. **Strict chronology**
   - User corrected mixed-up order ("before/after bug-fix" confusion).

4. **No synthetic historical time labels**
   - User corrected model-generated `[历史时间 ...]` style tags.

5. **Time phrase consistency**
   - User corrected daytime `晚安` mismatch.

## Implementation map

- `v3/serve/src/app/runtimePolicy.ts`
  - Rule table engine, correction-to-rule derivation, consequence executor, hit stats model.
- `v3/serve/src/app/chatService.ts`
  - Policy execution, tool prefetch, post-generation consequence execution, metadata/log hit stats.
- `v3/serve/src/app/promptBuilder.ts`
  - Runtime rules/facts injection blocks.
- `v3/serve/src/app/outputSanitizer.ts`
  - Final tail-closure guard.
