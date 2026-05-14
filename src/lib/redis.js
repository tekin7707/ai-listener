const Redis = require('ioredis');
const logger = require('./logger');

const client = new Redis({
  host: process.env.REDIS_HOST,
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB) || 1,
  lazyConnect: true,
  retryStrategy: (times) => Math.min(times * 200, 5000)
});

client.on('connect', () => logger.info('Redis connected'));
client.on('error', (err) => logger.warn('Redis error', { message: err.message }));

module.exports = client;
