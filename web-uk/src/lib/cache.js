// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Simple in-memory cache with TTL support
 * Used to reduce redundant API calls for frequently-accessed data
 */

class SimpleCache {
  constructor(maxSize = 1000) {
    this.cache = new Map();
    this.defaultTTL = 30000; // 30 seconds default
    this.maxSize = maxSize;

    // Periodically remove expired entries to prevent unbounded growth
    this._cleanupInterval = setInterval(() => this.cleanup(), 60000);
    // Allow Node.js to exit without waiting for this timer
    if (this._cleanupInterval.unref) {
      this._cleanupInterval.unref();
    }
  }

  /**
   * Get a value from the cache
   * @param {string} key - Cache key
   * @returns {*} Cached value or undefined if expired/not found
   */
  get(key) {
    const item = this.cache.get(key);
    if (!item) {
      return undefined;
    }

    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return undefined;
    }

    return item.value;
  }

  /**
   * Set a value in the cache
   * @param {string} key - Cache key
   * @param {*} value - Value to cache
   * @param {number} ttl - Time to live in milliseconds (optional)
   */
  set(key, value, ttl = this.defaultTTL) {
    this.cache.set(key, {
      value,
      expiry: Date.now() + ttl
    });

    // Evict oldest entries when the cache exceeds maxSize
    if (this.cache.size > this.maxSize) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
  }

  /**
   * Remove all expired entries from the cache
   */
  cleanup() {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiry) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Delete a specific key from the cache
   * @param {string} key - Cache key
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * Delete all keys matching a pattern
   * @param {string} pattern - Pattern to match (uses startsWith)
   */
  deletePattern(pattern) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cached values
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  stats() {
    let valid = 0;
    let expired = 0;
    const now = Date.now();

    for (const item of this.cache.values()) {
      if (now > item.expiry) {
        expired++;
      } else {
        valid++;
      }
    }

    return { valid, expired, total: this.cache.size };
  }
}

// Singleton instance
const cache = new SimpleCache();

/**
 * Create a cached version of an async function
 * @param {Function} fn - Async function to cache
 * @param {Function} keyFn - Function that generates cache key from arguments
 * @param {number} ttl - Cache TTL in milliseconds
 * @returns {Function} Cached version of the function
 */
function withCache(fn, keyFn, ttl = 30000) {
  return async function (...args) {
    const key = keyFn(...args);
    const cached = cache.get(key);

    if (cached !== undefined) {
      return cached;
    }

    const result = await fn(...args);
    cache.set(key, result, ttl);
    return result;
  };
}

/**
 * Invalidate cache for a specific user (e.g., after mutations)
 * @param {string} token - User's auth token (used as part of cache key)
 */
function invalidateUserCache(token) {
  if (!token) return;
  // Create a short hash of the token for the cache key prefix
  const prefix = token.substring(0, 40);
  cache.deletePattern(prefix);
}

module.exports = {
  cache,
  withCache,
  invalidateUserCache
};
