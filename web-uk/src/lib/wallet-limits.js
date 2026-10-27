// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const { callWalletApi } = require('./api');

// The platform ceiling WalletService enforces when a community sets nothing.
const PLATFORM_MAX_TRANSFER = 1000;

function dataFrom(result) {
  return result && typeof result === 'object' && 'data' in result ? result.data : result;
}

// The community's effective transfer limit, from the same source transfer()
// enforces (GET /v2/wallet/config -> WalletService::maxTransferAmount). Shared by
// /wallet and the member-profile transfer form so the two cannot drift. A failed
// read must not break either page, so it falls back to the platform ceiling; the
// API still refuses anything above the real limit.
async function walletMaxTransfer(token) {
  try {
    const config = dataFrom(await callWalletApi(token, 'GET', '/config')) || {};
    const max = Number(config.max_transfer);
    return Number.isFinite(max) && max > 0 ? max : PLATFORM_MAX_TRANSFER;
  } catch {
    return PLATFORM_MAX_TRANSFER;
  }
}

module.exports = { PLATFORM_MAX_TRANSFER, walletMaxTransfer };
