// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const { runWithRequestClient } = require('../lib/request-client-context');

// req.ip honours the app's `trust proxy` setting, so behind the reverse proxy it
// is the address that proxy saw, not a value the visitor put in X-Forwarded-For.
function requestClientContext(req, _res, next) {
  return runWithRequestClient(req.ip, next);
}

module.exports = { requestClientContext };
