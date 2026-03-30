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
    const currentId = conversationRepo.get_current_id();
    return conversationRepo.list(limit, offset).map((c) => ({
      id: c.id,
      title: c.title,
      created_at: c.created_at,
      updated_at: c.updated_at,
      message_count: c.message_count,
      last_message_preview: c.last_message_preview,
      is_current: c.id === currentId,
    }));
  });

  app.get('/conversations/current', async () => ({
    conversation_id: conversationRepo.get_current_id(),
  }));

  app.put<{
    Body: { conversation_id: string | null };
  }>(
    '/conversations/current',
    {
      schema: {
        body: {
          type: 'object',
          required: ['conversation_id'],
          properties: {
            conversation_id: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          },
        },
      },
    },
    async (request) => {
      const id = request.body.conversation_id;
      if (id !== null) {
        const conv = conversationRepo.find_by_id(id);
        if (!conv) throw new NotFoundError('Conversation', id);
      }
      conversationRepo.set_current_id(id);
      return { conversation_id: id };
    },
  );

  app.get<{
    Params: { id: string };
  }>('/conversations/:id', async (request) => {
    const conv = conversationRepo.find_by_id(request.params.id);
    if (!conv) throw new NotFoundError('Conversation', request.params.id);
    return {
      id: conv.id,
      title: conv.title,
      created_at: conv.created_at,
      updated_at: conv.updated_at,
    };
  });

  app.get<{
    Params: { id: string };
    Querystring: { limit?: number; offset?: number; newest_first?: boolean };
  }>('/conversations/:id/messages', async (request) => {
    const conv = conversationRepo.find_by_id(request.params.id);
    if (!conv) throw new NotFoundError('Conversation', request.params.id);
    const { limit = 200, offset = 0, newest_first = false } = request.query;
    const order = newest_first ? 'desc' : 'asc';
    return messageRepo
      .find_by_conversation(request.params.id, limit, offset, order)
      .map((m) => ({
        id: m.id,
        conversation_id: m.conversation_id,
        role: m.role,
        content: m.content,
        created_at: m.created_at,
        token_count: m.token_count,
        metadata: m.metadata,
      }));
  });

  app.delete<{
    Params: { id: string };
  }>('/conversations/:id', async (request, reply) => {
    conversationRepo.delete(request.params.id);
    return reply.status(204).send();
  });

  app.delete('/conversations', async (_request, reply) => {
    conversationRepo.delete_all();
    return reply.status(204).send();
  });
}
