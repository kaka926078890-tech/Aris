import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.log.level,
  ...(config.log.pretty
    ? { transport: { target: 'pino-pretty' } }
    : {}),
});

export type Logger = typeof logger;
