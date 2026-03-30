import OpenAI from 'openai';
import type { ILLMClient, PromptMessage } from '../types.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { LLMError } from '../errors.js';

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
      logger.info(
        {
          model: effectiveModel,
          tools: (tools ?? []).map((t) => t.function.name),
          messages: apiMessages.map((m) => ({
            ...m,
            content:
              typeof m.content === 'string' && m.content.length > 1200
                ? `${m.content.slice(0, 1200)}...`
                : m.content,
          })),
        },
        'LLM request payload',
      );
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

      logger.info(
        {
          model: effectiveModel,
          prompt_tokens: res.usage?.prompt_tokens,
          completion_tokens: res.usage?.completion_tokens,
          elapsed,
          response_content:
            content.length > 1200 ? `${content.slice(0, 1200)}...` : content,
          response_tool_calls: toolCalls,
        },
        '大模型响应完成',
      );

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
}
