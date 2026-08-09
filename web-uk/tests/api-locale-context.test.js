const { callVolunteeringApi } = require('../src/lib/api');
const { runWithRequestLocale } = require('../src/lib/request-locale-context');

describe('request-scoped Laravel API locale propagation', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('keeps concurrent Irish and Arabic Accept-Language headers isolated', async () => {
    const observed = [];
    global.fetch = jest.fn(async (url, options) => {
      observed.push({ url, headers: { ...options.headers } });
      await new Promise((resolve) => global.setImmediate(resolve));
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: [] }),
        text: async () => ''
      };
    });

    await Promise.all([
      runWithRequestLocale('ga', async () => {
        await Promise.resolve();
        return callVolunteeringApi('irish-token', 'GET', '/opportunities');
      }),
      runWithRequestLocale('ar', async () => {
        await Promise.resolve();
        return callVolunteeringApi('arabic-token', 'GET', '/opportunities');
      })
    ]);

    expect(observed).toHaveLength(2);
    expect(observed.map(({ headers }) => headers['Accept-Language']).sort()).toEqual(['ar', 'ga']);
    expect(observed.find(({ headers }) => headers.Authorization === 'Bearer irish-token').headers['Accept-Language'])
      .toBe('ga');
    expect(observed.find(({ headers }) => headers.Authorization === 'Bearer arabic-token').headers['Accept-Language'])
      .toBe('ar');
  });
});
