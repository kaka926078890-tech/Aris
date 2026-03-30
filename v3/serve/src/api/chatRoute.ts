import type { FastifyInstance } from 'fastify';
import type { ChatService } from '../app/chatService.js';
import { logger } from '../logger.js';

export function registerChatRoutes(
  app: FastifyInstance,
  chatService: ChatService,
) {
  app.post<{
    Body: {
      conversation_id?: string;
      message: string;
    };
  }>(
    '/chat/preview',
    {
      schema: {
        body: {
          type: 'object',
          required: ['message'],
          properties: {
            conversation_id: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
    async (request) => {
      logger.info(
        {
          endpoint: '/chat/preview',
          request_body: sanitizePayload(request.body),
        },
        'API request',
      );
      const result = await chatService.preview(request.body);
      logger.info(
        {
          endpoint: '/chat/preview',
          response_body: sanitizePayload(result),
        },
        'API response',
      );
      return result;
    },
  );

  app.post<{
    Body: {
      conversation_id?: string;
      message: string;
      model?: string;
      include_trace?: boolean;
    };
  }>(
    '/chat',
    {
      schema: {
        body: {
          type: 'object',
          required: ['message'],
          properties: {
            conversation_id: { type: 'string' },
            message: { type: 'string', minLength: 1 },
            model: { type: 'string' },
            include_trace: { type: 'boolean', default: false },
          },
        },
      },
    },
    async (request) => {
      logger.info(
        {
          endpoint: '/chat',
          request_body: sanitizePayload(request.body),
        },
        'API request',
      );
      const result = await chatService.chat(request.body);
      logger.info(
        {
          endpoint: '/chat',
          response_body: sanitizePayload(result),
        },
        'API response',
      );
      return result;
    },
  );
}

function sanitizePayload(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > 800 ? `${value.slice(0, 800)}...` : value;
  }
  if (Array.isArray(value)) return value.map((v) => sanitizePayload(v));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizePayload(v);
    }
    return out;
  }
  return value;
}
