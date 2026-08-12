// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const requestProfilePromises = Symbol('requestProfilePromises');

function getRequestProfile(req, token = req?.token) {
  if (!req || (typeof req !== 'object' && typeof req !== 'function')) {
    return Promise.reject(new TypeError('A request object is required to load a profile.'));
  }

  let profilePromises = req[requestProfilePromises];
  if (!profilePromises) {
    profilePromises = new Map();
    Object.defineProperty(req, requestProfilePromises, {
      configurable: false,
      enumerable: false,
      value: profilePromises,
      writable: false
    });
  }

  if (!profilePromises.has(token)) {
    const profilePromise = Promise.resolve().then(() => {
      const { getProfile } = require('./api');
      return getProfile(token);
    });
    profilePromises.set(token, profilePromise);
  }

  return profilePromises.get(token);
}

module.exports = { getRequestProfile };
