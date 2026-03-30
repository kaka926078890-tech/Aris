import { config } from './config.js';
import { logger } from './logger.js';
import { getDatabase, closeDatabase } from './infra/database.js';
import { ConversationRepo } from './infra/conversationRepo.js';
import { MessageRepo } from './infra/messageRepo.js';
import { RecordRepo } from './infra/recordRepo.js';
import { OpenAILLMClient } from './infra/llmClient.js';
import { OpenAIEmbeddingClient } from './infra/embeddingClient.js';
import { LocalVectorStore } from './infra/vectorStore.js';
import { ChatService } from './app/chatService.js';
import { createServer } from './api/server.js';

async function main() {
  logger.info('Aris v3 启动中...');

  // Infrastructure
  getDatabase();

  const conversationRepo = new ConversationRepo();
  const messageRepo = new MessageRepo();
  const recordRepo = new RecordRepo();
  const llmClient = new OpenAILLMClient();
  const embeddingClient = new OpenAIEmbeddingClient();
  const vectorStore = new LocalVectorStore();

  // Application
  const chatService = new ChatService(
    llmClient,
    embeddingClient,
    vectorStore,
    conversationRepo,
    messageRepo,
    recordRepo,
  );

  // Server
  const server = await createServer({
    chatService,
    conversationRepo,
    messageRepo,
  });

  await server.listen({ port: config.port, host: config.host });
  logger.info({ port: config.port, host: config.host }, 'Aris v3 已开始监听');

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('正在关闭服务...');
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
