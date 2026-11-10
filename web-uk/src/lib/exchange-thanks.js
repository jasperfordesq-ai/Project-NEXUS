// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
'use strict';

/**
 * The thank-you after the confirmation that completes an exchange (AWID
 * feedback, Nov 2026: "warmth, and community"), as the React site shows it
 * (react-frontend ExchangeThanks).
 *
 * When that confirmation completes the exchange, the API answers with the
 * member's own figures for this calendar year (`thanks`:
 * neighbours_this_year, hours_this_year — ExchangesController::confirm). The
 * confirm is a POST that redirects, so the figures ride in the session to the
 * exchange page once, and only for that exchange; the page then shows a GOV.UK
 * confirmation panel instead of the generic "updated" banner. A later visit
 * shows the ordinary page.
 */

const SESSION_KEY = 'exchangeThanks';

function nonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

/** True (and the figures remembered) when the API says the exchange is now complete. */
function rememberExchangeThanks(req, id, result) {
  const data = result && typeof result === 'object' && result.data && typeof result.data === 'object'
    ? result.data
    : result;
  if (!data || typeof data !== 'object' || data.status !== 'completed') return false;
  const thanks = data.thanks && typeof data.thanks === 'object' ? data.thanks : {};
  if (req.session) {
    req.session[SESSION_KEY] = {
      id: Number(id),
      neighbours: Math.round(nonNegative(thanks.neighbours_this_year)),
      hours: nonNegative(thanks.hours_this_year)
    };
  }
  return true;
}

/**
 * The thank-you to show on this exchange's page, or null. Read once: the
 * remembered figures are removed whether or not they are shown.
 */
function takeExchangeThanks(req, id, exchangeStatus, queryStatus) {
  const saved = req.session && req.session[SESSION_KEY];
  const mine = Boolean(saved && saved.id === Number(id));
  if (mine) delete req.session[SESSION_KEY];
  if (queryStatus !== 'exchange-completed' || exchangeStatus !== 'completed') return null;
  const figures = mine && (saved.neighbours > 0 || saved.hours > 0)
    ? { neighbours: saved.neighbours, hours: saved.hours }
    : null;
  return { figures };
}

module.exports = { SESSION_KEY, rememberExchangeThanks, takeExchangeThanks };
