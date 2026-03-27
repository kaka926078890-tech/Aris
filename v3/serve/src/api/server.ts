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

  app.setErrorHandler((error: Error, _request, reply) => {
    if (error instanceof AppError) {
      logger.warn({ code: error.code, message: error.message }, 'App error');
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

    logger.error({ err: error }, 'Unhandled error');
    return reply.status(500).send({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  });

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  registerChatRoutes(app, deps.chatService);
  registerConversationRoutes(app, deps.conversationRepo, deps.messageRepo);

  return app;
}
