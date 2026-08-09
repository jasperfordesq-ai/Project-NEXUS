// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

const { productionConfigErrors } = require('../src/lib/production-config');
const { createSessionStore, isRedisUrl } = require('../src/lib/session-store');

describe('production session configuration', () => {
  it('allows the in-memory store only outside production', async () => {
    const config = createSessionStore({ nodeEnv: 'test', redisUrl: '' });
    expect(config.store).toBeUndefined();
    expect(config.client).toBeNull();
    expect(config.isReady()).toBe(true);
    await expect(config.ready).resolves.toBeUndefined();
    expect(() => createSessionStore({ nodeEnv: 'production', redisUrl: '' }))
      .toThrow('SESSION_REDIS_URL is required in production');
  });

  it('constructs and connects the configured Redis store', async () => {
    const client = { on: jest.fn(), connect: jest.fn().mockResolvedValue(undefined), isReady: false };
    const createClient = jest.fn(() => client);
    const RedisStore = jest.fn(function RedisStore(options) { this.options = options; });
    const config = createSessionStore({
      nodeEnv: 'production',
      redisUrl: 'rediss://sessions.example.test:6380/2',
      prefix: 'web:test:',
      createClient,
      RedisStore
    });

    expect(createClient).toHaveBeenCalledWith({ url: 'rediss://sessions.example.test:6380/2' });
    expect(RedisStore).toHaveBeenCalledWith({ client, prefix: 'web:test:' });
    expect(client.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(config.isReady()).toBe(false);
    client.isReady = true;
    expect(config.isReady()).toBe(true);
    await expect(config.ready).resolves.toBeUndefined();
  });

  it('rejects unsafe production secrets and non-Redis store URLs', () => {
    expect(isRedisUrl('redis://localhost:6379')).toBe(true);
    expect(isRedisUrl('rediss://sessions.example.test')).toBe(true);
    expect(isRedisUrl('https://sessions.example.test')).toBe(false);
    expect(() => createSessionStore({ nodeEnv: 'production', redisUrl: 'https://example.test' }))
      .toThrow('SESSION_REDIS_URL must use redis:// or rediss://');

    expect(productionConfigErrors({
      NODE_ENV: 'production',
      COOKIE_SECRET: 'change-this-to-a-secure-random-string',
      SESSION_SECRET: 'change-this-to-a-secure-random-string'
    })).toEqual(expect.arrayContaining([
      expect.stringContaining('COOKIE_SECRET'),
      expect.stringContaining('SESSION_SECRET'),
      expect.stringContaining('distinct'),
      expect.stringContaining('SESSION_REDIS_URL')
    ]));
  });

  it('accepts distinct production secrets and a persistent store', () => {
    expect(productionConfigErrors({
      NODE_ENV: 'production',
      COOKIE_SECRET: 'cookie-secret-value-that-is-long-enough-1',
      SESSION_SECRET: 'session-secret-value-that-is-long-enough-2',
      SESSION_REDIS_URL: 'rediss://sessions.example.test:6380/2'
    })).toEqual([]);
  });
});
