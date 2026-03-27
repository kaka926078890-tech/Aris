import OpenAI from 'openai';
import type { ILLMClient, PromptMessage } from '../types.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { LLMError } from '../errors.js';

export class OpenAILLMClient implements ILLMClient {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: config.llm.apiKey,
      baseURL: config.llm.baseUrl,
      timeout: config.llm.timeout,
    });
  }

  async chat(messages: PromptMessage[], model?: string) {
    const effectiveModel = model || config.llm.defaultModel;
    const start = Date.now();

    try {
      const res = await this.client.chat.completions.create({
        model: effectiveModel,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });

      const content = res.choices[0]?.message?.content ?? '';
      const elapsed = Date.now() - start;

      logger.info(
        {
          model: effectiveModel,
          promptTokens: res.usage?.prompt_tokens,
          completionTokens: res.usage?.completion_tokens,
          elapsed,
        },
        'LLM response received',
      );

      return {
        content,
        model: res.model,
        promptTokens: res.usage?.prompt_tokens ?? 0,
        completionTokens: res.usage?.completion_tokens ?? 0,
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
