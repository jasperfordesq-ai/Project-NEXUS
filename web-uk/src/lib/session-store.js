// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

const { URL } = require('node:url');

function isRedisUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'redis:' || parsed.protocol === 'rediss:';
  } catch {
    return false;
  }
}

function createSessionStore({
  nodeEnv = process.env.NODE_ENV || 'development',
  redisUrl = process.env.SESSION_REDIS_URL || '',
  prefix = process.env.SESSION_REDIS_PREFIX || 'nexus:web-uk:sess:',
  createClient: createClientOverride,
  RedisStore: RedisStoreOverride
} = {}) {
  const configuredUrl = String(redisUrl || '').trim();
  if (!configuredUrl) {
    if (nodeEnv === 'production') {
      throw new Error('SESSION_REDIS_URL is required in production');
    }
    return {
      store: undefined,
      ready: Promise.resolve(),
      client: null,
      isReady: () => true
    };
  }
  if (!isRedisUrl(configuredUrl)) {
    throw new Error('SESSION_REDIS_URL must use redis:// or rediss://');
  }

  const createClient = createClientOverride || require('redis').createClient;
  const RedisStore = RedisStoreOverride || require('connect-redis').RedisStore;
  const client = createClient({ url: configuredUrl });
  client.on('error', (error) => {
    console.error('Redis session store error:', error.message);
  });

  return {
    client,
    store: new RedisStore({ client, prefix }),
    ready: client.connect(),
    isReady: () => client.isReady === true
  };
}

module.exports = { createSessionStore, isRedisUrl };
