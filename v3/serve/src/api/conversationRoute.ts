import type { FastifyInstance } from 'fastify';
import type { IConversationRepo, IMessageRepo } from '../types.js';
import { NotFoundError } from '../errors.js';

export function registerConversationRoutes(
  app: FastifyInstance,
  conversationRepo: IConversationRepo,
  messageRepo: IMessageRepo,
) {
  app.get<{
    Querystring: { limit?: number; offset?: number };
  }>('/conversations', async (request) => {
    const { limit = 50, offset = 0 } = request.query;
    return conversationRepo.list(limit, offset);
  });

  app.get<{
    Params: { id: string };
  }>('/conversations/:id', async (request) => {
    const conv = conversationRepo.findById(request.params.id);
    if (!conv) throw new NotFoundError('Conversation', request.params.id);
    return conv;
  });

  app.get<{
    Params: { id: string };
    Querystring: { limit?: number; offset?: number };
  }>('/conversations/:id/messages', async (request) => {
    const conv = conversationRepo.findById(request.params.id);
    if (!conv) throw new NotFoundError('Conversation', request.params.id);
    const { limit = 200, offset = 0 } = request.query;
    return messageRepo.findByConversation(request.params.id, limit, offset);
  });

  app.delete<{
    Params: { id: string };
  }>('/conversations/:id', async (request, reply) => {
    conversationRepo.delete(request.params.id);
    return reply.status(204).send();
  });
}
