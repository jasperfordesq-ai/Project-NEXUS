'use strict';

const { getRequestLocale } = require('../src/lib/request-locale-context');
const { localization } = require('../src/middleware/localization');

function responseStub() {
  return {
    locals: {},
    set: jest.fn()
  };
}

describe('localization middleware error handling', () => {
  it('forwards unexpected asynchronous locale-resolution failures to Express', async () => {
    const expectedError = new Error('locale resolution failed');
    const req = {
      get query() {
        throw expectedError;
      }
    };
    const next = jest.fn();

    await expect(localization(req, responseStub(), next)).resolves.toBeUndefined();

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(expectedError);
  });

  it('keeps the request locale available through AsyncLocalStorage on success', async () => {
    const req = {
      headers: {},
      query: { locale: 'ar' },
      session: {}
    };
    const res = responseStub();
    let localeSeenByNext = null;
    const next = jest.fn(() => {
      localeSeenByNext = getRequestLocale();
    });

    await expect(localization(req, res, next)).resolves.toBeUndefined();

    expect(next).toHaveBeenCalledTimes(1);
    expect(localeSeenByNext).toBe('ar');
    expect(req.locale).toBe('ar');
    expect(res.set).toHaveBeenCalledWith('Content-Language', 'ar');
  });
});
