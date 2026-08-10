'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../src/lib/api', () => ({
  getProfile: jest.fn()
}));

const api = require('../src/lib/api');
const { getRequestProfile } = require('../src/lib/request-profile');

describe('request-scoped profile loading', () => {
  beforeEach(() => {
    api.getProfile.mockReset();
  });

  it('shares one profile promise for the same request and token', async () => {
    const req = {};
    api.getProfile.mockResolvedValue({ data: { id: 42 } });

    const first = getRequestProfile(req, 'token-a');
    const second = getRequestProfile(req, 'token-a');

    expect(second).toBe(first);
    await expect(first).resolves.toEqual({ data: { id: 42 } });
    expect(api.getProfile).toHaveBeenCalledTimes(1);
    expect(api.getProfile).toHaveBeenCalledWith('token-a');
  });

  it('keeps different requests and tokens isolated', async () => {
    const firstRequest = {};
    const secondRequest = {};
    api.getProfile.mockImplementation(async token => ({ data: { token } }));

    const firstToken = getRequestProfile(firstRequest, 'token-a');
    const otherToken = getRequestProfile(firstRequest, 'token-b');
    const otherRequest = getRequestProfile(secondRequest, 'token-a');

    await expect(Promise.all([firstToken, otherToken, otherRequest])).resolves.toEqual([
      { data: { token: 'token-a' } },
      { data: { token: 'token-b' } },
      { data: { token: 'token-a' } }
    ]);
    expect(api.getProfile).toHaveBeenCalledTimes(3);
  });

  it('memoizes a rejected profile request for the request lifecycle', async () => {
    const req = {};
    api.getProfile.mockRejectedValue(new Error('profile unavailable'));

    const first = getRequestProfile(req, 'token-a');
    const second = getRequestProfile(req, 'token-a');

    expect(second).toBe(first);
    await expect(first).rejects.toThrow('profile unavailable');
    expect(api.getProfile).toHaveBeenCalledTimes(1);
  });
});

describe('profile route source contract', () => {
  it('routes profile reads through the request-scoped helper', () => {
    const routesDirectory = path.join(__dirname, '..', 'src', 'routes');
    const routeFiles = fs.readdirSync(routesDirectory).filter(file => file.endsWith('.js'));
    const directCallers = [];
    let memoizedCallCount = 0;

    for (const file of routeFiles) {
      const source = fs.readFileSync(path.join(routesDirectory, file), 'utf8');
      if (/\bgetProfile\s*\(/.test(source)) directCallers.push(file);
      memoizedCallCount += (source.match(/\bgetRequestProfile\s*\(/g) || []).length;
    }

    expect(directCallers).toEqual([]);
    expect(memoizedCallCount).toBeGreaterThan(0);
  });
});
