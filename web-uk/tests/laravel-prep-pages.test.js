// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

describe('laravel prep pages route loader', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('fs');
  });

  it('does not crash the frontend when the generated route matrix is missing', () => {
    jest.doMock('fs', () => ({
      existsSync: jest.fn(() => false),
      readFileSync: jest.fn()
    }));

    expect(() => require('../src/routes/laravel-prep-pages')).not.toThrow();

    const prepRoutes = require('../src/routes/laravel-prep-pages');
    expect(prepRoutes.prepPages).toEqual([]);
  });

  it('only registers generated preparation pages for explicit missing Laravel GET rows', () => {
    jest.doMock('fs', () => ({
      existsSync: jest.fn(() => true),
      readFileSync: jest.fn(() => JSON.stringify({
        matrix: [
          {
            method: 'GET',
            path: '/matched',
            status: 'matched',
            laravelHandler: 'matchedPage',
            laravelView: 'matched-page',
            laravelParamConstraints: []
          },
          {
            method: 'GET',
            path: '/missing/{param}',
            status: 'missing',
            laravelHandler: 'missingPage',
            laravelView: 'missing-page',
            laravelParamConstraints: ['number']
          },
          {
            method: 'POST',
            path: '/missing',
            status: 'missing',
            laravelHandler: 'missingPost',
            laravelView: '',
            laravelParamConstraints: []
          }
        ]
      }))
    }));

    const prepRoutes = require('../src/routes/laravel-prep-pages');

    expect(prepRoutes.prepPages).toEqual([
      {
        title: 'Missing Page',
        laravelPath: '/missing/{param}',
        expressPath: '/missing/:param1(\\d+)',
        handler: 'missingPage',
        bladeView: 'missing-page',
        auth: '',
        gates: ''
      }
    ]);
  });
});
