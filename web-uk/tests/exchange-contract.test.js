// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const path = require('path');

function source(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', ...segments), 'utf8');
}

describe('Laravel exchange workflow integration contract', () => {
  it('checks authoritative config and active exchange state from listing details', () => {
    const route = source('src', 'routes', 'listings.js');
    const template = source('src', 'views', 'listings', 'detail.njk');

    expect(route).toContain('checkExchangeForListing');
    expect(route).toContain('config.exchange_workflow_enabled === true');
    expect(route).not.toMatch(/getExchangeConfig\(token\)\.catch\([^\n]+exchange_workflow_enabled:\s*true/);
    expect(template).toContain("urlFor('/exchanges/' + (activeExchange.id | string))");
    expect(template).toContain("urlFor('/listings/' + (listing.id | string) + '/exchange-request')");
    expect(route).toContain("trimmed(req.body.prep_time) === ''");
  });

  it('keeps provider-only lifecycle actions aligned with Laravel Blade and React', () => {
    const route = source('src', 'routes', 'exchanges.js');

    expect(route).toContain("canStart: isProvider && status === 'accepted'");
    expect(route).toContain("canComplete: isProvider && status === 'in_progress'");
    expect(route).not.toContain("canStart: (isProvider || isRequester)");
    expect(route).not.toContain("canComplete: (isProvider || isRequester)");
  });

  it('requires an explicit no-JS disclosure before destructive exchange controls', () => {
    const template = source('src', 'views', 'exchanges', 'detail.njk');

    expect(template).toMatch(/<details[^>]*>[\s\S]*name="action" value="decline"[\s\S]*<\/details>/);
    expect(template).toMatch(/<details[^>]*>[\s\S]*name="action" value="cancel"[\s\S]*<\/details>/);
  });

  it('rejects malformed confirmation hours before calling the lifecycle API', () => {
    const route = source('src', 'routes', 'exchanges.js');

    expect(route).toContain("action === 'confirm' && hours === null");
    expect(route).toContain('status=exchange-hours-invalid#hours');
  });

  it('uses the current Laravel Blade catalogue for exchange list and detail states', () => {
    const route = source('src', 'routes', 'exchanges.js');
    const index = source('src', 'views', 'exchanges', 'index.njk');
    const detail = source('src', 'views', 'exchanges', 'detail.njk');

    expect(route).toContain("t(isRequester ? 'exchanges.role_requester' : 'exchanges.role_provider')");
    expect(route).toContain("res.locals.t('error_pages.503_body')");
    expect(route).not.toContain('Exchange items could not be loaded. Try again.');
    expect(index).toContain('t("exchanges.description")');
    expect(index).toContain('tc("exchanges.result_count"');
    expect(index).toContain('t("exchanges.empty")');
    expect(detail).toContain('t("exchanges.status_descriptions." + exchange.status)');
    expect(detail).toContain('t("exchanges.review_title")');
    expect(detail).toContain('t("exchanges.empty_timeline")');
    expect(detail).not.toContain('There are no timeline entries yet.');
  });
});
