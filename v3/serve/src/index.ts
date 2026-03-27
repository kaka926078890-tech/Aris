import { config } from './config.js';
import { logger } from './logger.js';
import { getDatabase, closeDatabase } from './infra/database.js';
import { ConversationRepo } from './infra/conversationRepo.js';
import { MessageRepo } from './infra/messageRepo.js';
import { OpenAILLMClient } from './infra/llmClient.js';
import { OpenAIEmbeddingClient } from './infra/embeddingClient.js';
import { LocalVectorStore } from './infra/vectorStore.js';
import { EmbeddingQueue } from './infra/embeddingQueue.js';
import { RetrievalService } from './app/retrievalService.js';
import { ChatService } from './app/chatService.js';
import { createServer } from './api/server.js';

async function main() {
  logger.info('Aris v3 starting…');

  // Infrastructure
  getDatabase();

  const conversationRepo = new ConversationRepo();
  const messageRepo = new MessageRepo();
  const llmClient = new OpenAILLMClient();
  const embeddingClient = new OpenAIEmbeddingClient();
  const vectorStore = new LocalVectorStore();
  const embeddingQueue = new EmbeddingQueue(embeddingClient, vectorStore);

  // Application
  const retrievalService = new RetrievalService(
    embeddingClient,
    vectorStore,
    messageRepo,
  );
  const chatService = new ChatService(
    llmClient,
    conversationRepo,
    messageRepo,
    retrievalService,
    embeddingQueue,
  );

  // Server
  const server = await createServer({
    chatService,
    conversationRepo,
    messageRepo,
  });

  await server.listen({ port: config.port, host: config.host });
  logger.info({ port: config.port, host: config.host }, 'Aris v3 listening');

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down…');
    await server.close();
    closeDatabase();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
