// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Laravel's reason for refusing an action reaches the member (29 Oct 2026 deep
 * audit P1, C3, C4, C5). React shows the server's translated message; this site
 * used to collapse it into "Something went wrong".
 */
const express = require('express');
const session = require('express-session');
const request = require('supertest');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  return new Proxy({
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    transferWalletCredits: jest.fn(),
    donateCredits: jest.fn(),
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] })),
  });
});
jest.mock('../src/middleware/auth', () => ({ requireAuth: (req, res, next) => next(), withTokenRefresh: (h) => h }));
jest.mock('../src/lib/auditLogger', () => ({ audit: new Proxy({}, { get: () => () => (req, res, next) => next() }) }));

const api = require('../src/lib/api');
const { rememberClientRefusal, consumeApiRefusal } = require('../src/lib/api-refusal');

const refused = (status, code, message) => new api.ApiError('refused', status, { errors: [{ code, message }] });

describe('rememberClientRefusal', () => {
  it('carries a 4xx refusal message to the page it was meant for, once', () => {
    const req = { session: {} };
    rememberClientRefusal(req, 'wallet-transfer', refused(403, 'SAFEGUARDING_RESTRICTED', 'Transfers to this member need a coordinator.'));
    expect(consumeApiRefusal(req, 'job-apply')).toBe('');
    expect(consumeApiRefusal(req, 'wallet-transfer')).toBe('Transfers to this member need a coordinator.');
    expect(consumeApiRefusal(req, 'wallet-transfer')).toBe('');
  });
  it('never carries 401, 5xx or non-API errors', () => {
    const req = { session: {} };
    rememberClientRefusal(req, 'k', refused(401, 'UNAUTHENTICATED', 'x'));
    rememberClientRefusal(req, 'k', refused(500, 'SERVER_ERROR', 'SQLSTATE[42S22]'));
    rememberClientRefusal(req, 'k', new Error('socket hang up'));
    expect(consumeApiRefusal(req, 'k')).toBe('');
  });
});

describe('wallet', () => {
  function mount() {
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.use(session({ secret: 'refusal-test', resave: false, saveUninitialized: true }));
    app.use((req, res, next) => {
      req.token = 'token:test';
      res.locals.urlFor = (v) => v;
      res.locals.t = (k) => k;
      next();
    });
    app.use('/wallet', require('../src/routes/wallet'));
    return app;
  }

  beforeEach(() => jest.clearAllMocks());

  it('accepts a donation to two decimal places, as Laravel and React do', async () => {
    api.donateCredits.mockResolvedValue({ data: {} });
    const res = await request(mount()).post('/wallet/donate').type('form')
      .send({ recipient_type: 'community_fund', amount: '2.5', idempotency_key: 'abcdefgh-1234' });
    expect(api.donateCredits).toHaveBeenCalledWith('token:test', expect.objectContaining({ amount: 2.5 }));
    expect(res.headers.location).toContain('status=donate-sent');
  });

  it('still refuses three decimal places', async () => {
    const res = await request(mount()).post('/wallet/donate').type('form')
      .send({ recipient_type: 'community_fund', amount: '2.555', idempotency_key: 'abcdefgh-1234' });
    expect(api.donateCredits).not.toHaveBeenCalled();
    expect(res.headers.location).toContain('donate_error=decimals');
  });

  it('remembers Laravel\'s reason for a refused donation', async () => {
    api.donateCredits.mockRejectedValue(refused(400, 'DONATION_FAILED', 'Saldo insuficiente.'));
    const agent = request.agent(mount());
    const res = await agent.post('/wallet/donate').type('form')
      .send({ recipient_type: 'community_fund', amount: '2', idempotency_key: 'abcdefgh-1234' });
    expect(res.headers.location).toContain('donate_error=failed');
  });
});
