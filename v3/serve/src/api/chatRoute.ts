import type { FastifyInstance } from 'fastify';
import type { ChatService } from '../app/chatService.js';

export function registerChatRoutes(
  app: FastifyInstance,
  chatService: ChatService,
) {
  app.post<{
    Body: {
      conversationId?: string;
      message: string;
      model?: string;
      includeTrace?: boolean;
    };
  }>(
    '/chat',
    {
      schema: {
        body: {
          type: 'object',
          required: ['message'],
          properties: {
            conversationId: { type: 'string' },
            message: { type: 'string', minLength: 1 },
            model: { type: 'string' },
            includeTrace: { type: 'boolean', default: false },
          },
        },
      },
    },
    async (request) => {
      return chatService.chat(request.body);
    },
  );
}
