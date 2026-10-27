// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/** A mocked `src/lib/api` for jest.mock factories: named helpers are jest.fn(). */
function apiMockFactory(names) {
  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  const target = { ApiError, ApiOfflineError: class ApiOfflineError extends Error {} };
  names.forEach((name) => { target[name] = jest.fn(); });
  return new Proxy(target, {
    get: (object, prop) => (prop in object ? object[prop] : jest.fn().mockResolvedValue({ data: [] }))
  });
}

module.exports = { apiMockFactory };
