import OpenAI from 'openai';
import type { ILLMClient, PromptMessage } from '../types.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { LLMError } from '../errors.js';
import { estimateTokens } from '../app/promptPolicy.js';
import { logLlmUsage } from './usageLog.js';

function summarizePromptPayload(messages: PromptMessage[]) {
  const role_counts: Record<string, number> = {};
  let content_chars = 0;
  let est_tokens = 0;
  for (const m of messages) {
    role_counts[m.role] = (role_counts[m.role] || 0) + 1;
    const c = typeof m.content === 'string' ? m.content : '';
    content_chars += c.length;
    est_tokens += estimateTokens(c);
  }
  return {
    message_count: messages.length,
    role_counts,
    content_chars_total: content_chars,
    estimated_input_tokens: est_tokens,
  };
}

export class OpenAILLMClient implements ILLMClient {
  private client: OpenAI;

  constructor() {
    const base = config.llm.base_url.replace(/\/+$/, '');
    this.client = new OpenAI({
      apiKey: config.llm.api_key,
      baseURL: base.endsWith('/v1') ? base : `${base}/v1`,
      timeout: config.llm.timeout,
    });
  }

  async chat(
    messages: PromptMessage[],
    model?: string,
    tools?: Array<{
      type: 'function';
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }>,
  ) {
    const effectiveModel = model || config.llm.default_model;
    const start = Date.now();

    try {
      const apiMessages = messages.map((m) => {
        if (m.role === 'tool') {
          return {
            role: 'tool' as const,
            content: m.content,
            tool_call_id: m.tool_call_id || '',
          };
        }
        if (m.role === 'assistant') {
          return {
            role: 'assistant' as const,
            content: m.content,
            tool_calls: m.tool_calls,
          };
        }
        if (m.role === 'system') {
          return {
            role: 'system' as const,
            content: m.content,
          };
        }
        return {
          role: 'user' as const,
          content: m.content,
        };
      });
      const payloadSummary = summarizePromptPayload(messages);
      if (config.log.debug_llm_request_body) {
        logger.info(
          {
            model: effectiveModel,
            tools: (tools ?? []).map((t) => t.function.name),
            ...payloadSummary,
            messages: apiMessages,
          },
          'LLM request payload（完整，调试用）',
        );
      } else {
        logger.debug(
          {
            model: effectiveModel,
            tools: (tools ?? []).map((t) => t.function.name),
            ...payloadSummary,
          },
          'LLM request（摘要）',
        );
      }
      const res = await this.client.chat.completions.create({
        model: effectiveModel,
        messages: apiMessages,
        tools,
      });

      const msg = res.choices[0]?.message;
      const content = msg?.content ?? '';
      const toolCalls = (msg?.tool_calls ?? [])
        .filter((tc): tc is { id: string; type: 'function'; function: { name: string; arguments: string } } =>
          tc.type === 'function' && 'function' in tc,
        )
        .map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }));
      const elapsed = Date.now() - start;

      if (res.usage && typeof res.usage === 'object') {
        logLlmUsage(
          logger,
          'chat',
          res.usage as unknown as Record<string, unknown>,
          { elapsed_ms: elapsed },
        );
      }

      return {
        content,
        model: res.model,
        prompt_tokens: res.usage?.prompt_tokens ?? 0,
        completion_tokens: res.usage?.completion_tokens ?? 0,
        tool_calls: toolCalls,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, model: effectiveModel }, 'LLM call failed');
      throw new LLMError(`LLM call failed: ${msg}`, {
        model: effectiveModel,
      });
    }
  }

  /**
   * Stream chat completion deltas (OpenAI-compatible SSE under the hood).
   * Only streams model output; callers decide how to persist / handle tools.
   */
  async *chat_stream(
    messages: PromptMessage[],
    model?: string,
    tools?: Array<{
      type: 'function';
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }>,
  ): AsyncGenerator<{
    delta: string;
    tool_calls: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
    model: string;
    usage?: Record<string, unknown> | null;
  }> {
    const effectiveModel = model || config.llm.default_model;
    const streamStartedAt = Date.now();
    try {
      const apiMessages = messages.map((m) => {
        if (m.role === 'tool') {
          return {
            role: 'tool' as const,
            content: m.content,
            tool_call_id: m.tool_call_id || '',
          };
        }
        if (m.role === 'assistant') {
          return {
            role: 'assistant' as const,
            content: m.content,
            tool_calls: m.tool_calls,
          };
        }
        if (m.role === 'system') {
          return {
            role: 'system' as const,
            content: m.content,
          };
        }
        return {
          role: 'user' as const,
          content: m.content,
        };
      });

      if (config.log.debug_llm_request_body) {
        logger.info(
          {
            model: effectiveModel,
            tools: (tools ?? []).map((t) => t.function.name),
            ...summarizePromptPayload(messages),
            messages: apiMessages,
          },
          'LLM stream request（完整，调试用）',
        );
      } else {
        logger.debug(
          {
            model: effectiveModel,
            tools: (tools ?? []).map((t) => t.function.name),
            ...summarizePromptPayload(messages),
          },
          'LLM stream request（摘要）',
        );
      }

      const streamParams: Parameters<
        typeof this.client.chat.completions.create
      >[0] = {
        model: effectiveModel,
        messages: apiMessages,
        tools,
        stream: true,
      };
      if (config.llm.stream_include_usage) {
        streamParams.stream_options = { include_usage: true };
      }
      const stream = await this.client.chat.completions.create(streamParams);

      for await (const chunk of stream as AsyncIterable<{
        model?: string;
        usage?: Record<string, unknown> | null;
        choices: Array<{
          delta?: {
            content?: string | null;
            tool_calls?: Array<{
              index?: number;
              id?: string;
              type?: 'function';
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      }>) {
        if (chunk.usage && typeof chunk.usage === 'object') {
          logLlmUsage(
            logger,
            'chat_stream',
            chunk.usage as unknown as Record<string, unknown>,
            { elapsed_ms: Date.now() - streamStartedAt },
          );
        }
        const d = chunk.choices?.[0]?.delta;
        const delta = (d?.content ?? '') as string;
        // In streaming mode, tool_calls.function.arguments can arrive in multiple chunks.
        // Some chunks may only carry arguments without repeating the function name.
        const tool_calls =
          (d?.tool_calls ?? [])
            .filter((tc) => tc?.type === 'function' && (tc.id || tc.function?.name || tc.function?.arguments))
            .map((tc) => ({
              index: typeof tc.index === 'number' ? tc.index : undefined,
              id: tc.id || '',
              type: 'function' as const,
              function: {
                name: tc.function?.name || '',
                arguments: tc.function?.arguments || '',
              },
            })) ?? [];
        const usage =
          chunk.usage && typeof chunk.usage === 'object'
            ? (chunk.usage as unknown as Record<string, unknown>)
            : undefined;
        if (!delta && tool_calls.length === 0 && !usage) continue;
        yield {
          delta,
          tool_calls,
          model: chunk.model || effectiveModel,
          usage: usage ?? null,
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, model: effectiveModel }, 'LLM stream call failed');
      throw new LLMError(`LLM stream call failed: ${msg}`, {
        model: effectiveModel,
      });
    }
  }
}
