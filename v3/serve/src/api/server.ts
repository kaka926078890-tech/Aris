import Fastify from 'fastify';
import cors from '@fastify/cors';
import { logger } from '../logger.js';
import { AppError } from '../errors.js';
import { registerChatRoutes } from './chatRoute.js';
import { registerConversationRoutes } from './conversationRoute.js';
import type { ChatService } from '../app/chatService.js';
import type { IConversationRepo, IMessageRepo } from '../types.js';

export interface ServerDeps {
  chatService: ChatService;
  conversationRepo: IConversationRepo;
  messageRepo: IMessageRepo;
}

export async function createServer(deps: ServerDeps) {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });

  app.addHook('onRequest', async (request) => {
    logger.debug(
      {
        method: request.method,
        url: request.url,
        params: sanitizePayload(request.params),
        query: sanitizePayload(request.query),
        body: sanitizePayload(request.body),
      },
      'HTTP request',
    );
  });

  app.addHook('onSend', async (request, reply, payload) => {
    logger.debug(
      {
        method: request.method,
        url: request.url,
        status_code: reply.statusCode,
        response_body: sanitizePayload(parsePayload(payload)),
      },
      'HTTP response',
    );
    return payload;
  });

  app.setErrorHandler((error: Error, _request, reply) => {
    if (error instanceof AppError) {
      logger.warn({ code: error.code, message: error.message }, '应用错误');
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
        details: error.details,
      });
    }

    const fastifyErr = error as Error & { validation?: unknown };
    if (fastifyErr.validation) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: fastifyErr.message,
      });
    }

    logger.error({ err: error }, '未处理异常');
    return reply.status(500).send({
      error: 'INTERNAL_ERROR',
      message: '服务内部错误',
    });
  });

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  registerChatRoutes(app, deps.chatService);
  registerConversationRoutes(app, deps.conversationRepo, deps.messageRepo);

  return app;
}

function parsePayload(payload: unknown): unknown {
  if (typeof payload !== 'string') return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
}

function sanitizePayload(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > 1200 ? `${value.slice(0, 1200)}...` : value;
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
