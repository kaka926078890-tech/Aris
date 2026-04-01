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
      model?: string;
      include_trace?: boolean;
      reply_to_message_id?: string;
    };
  }>(
    '/chat/stream',
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
            reply_to_message_id: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');

      const send = (event: string, data: unknown) => {
        reply.raw.write(`event: ${event}\n`);
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      logger.debug(
        { endpoint: '/chat/stream', request_body: sanitizePayload(request.body) },
        'API request',
      );

      await chatService.chat_stream(request.body, {
        on_open: (payload) => send('open', payload),
        on_tool_trace: (payload) => send('tool_trace', payload),
        on_delta: (payload) => send('delta', payload),
        on_final: (payload) => {
          send('final', sanitizePayload(payload));
          reply.raw.end();
          logger.debug(
            { endpoint: '/chat/stream', response_body: sanitizePayload(payload) },
            'API response',
          );
        },
        on_error: (payload) => {
          send('error', payload);
          reply.raw.end();
        },
      });

      return reply;
    },
  );

  app.post<{
    Body: {
      conversation_id?: string;
      message: string;
      reply_to_message_id?: string;
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
            reply_to_message_id: { type: 'string' },
          },
        },
      },
    },
    async (request) => {
      const t0 = Date.now();
      logger.debug(
        { endpoint: '/chat/preview', request_body: sanitizePayload(request.body) },
        'API request',
      );
      const result = await chatService.preview(request.body);
      logger.debug(
        { endpoint: '/chat/preview', response_body: sanitizePayload(result) },
        'API response',
      );
      logger.info(
        {
          path: '/chat/preview',
          ms: Date.now() - t0,
          conversation_id: result.conversation_id,
          trace_messages: result.trace?.messages?.length,
        },
        '请求完成',
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
      reply_to_message_id?: string;
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
            reply_to_message_id: { type: 'string' },
          },
        },
      },
    },
    async (request) => {
      logger.debug(
        { endpoint: '/chat', request_body: sanitizePayload(request.body) },
        'API request',
      );
      const result = await chatService.chat(request.body);
      logger.debug(
        { endpoint: '/chat', response_body: sanitizePayload(result) },
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
