// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

describe('server template configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      COOKIE_SECRET: 'test-secret-minimum-32-characters-long',
      SESSION_SECRET: 'test-session-secret-32-chars!!!'
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('does not start Nunjucks file watching in tests', () => {
    const configure = jest.fn(() => ({ addFilter: jest.fn() }));

    jest.doMock('nunjucks', () => ({ configure }));

    require('../src/server');

    expect(configure).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        watch: false
      })
    );
  });
});
