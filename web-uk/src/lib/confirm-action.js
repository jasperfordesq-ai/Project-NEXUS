// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GOV.UK "confirm a deletion" step for actions that used to happen on one click
 * (29 Oct 2026 deep audit M6: deleting a comment or notification, blocking or
 * unblocking a member, forgetting trusted devices, removing a skill, a list item or
 * an exchange participant, declining a request, offer or interview, cancelling a
 * join request or a shift, withdrawing an urgent request).
 *
 * The first POST does not reach Laravel. It renders the shared confirm-delete page,
 * which posts the same fields back to the same address with `confirmed=1` behind a
 * warning button; only that second POST performs the action. No JavaScript is
 * needed, and the fields the member chose (a note, a reason) are carried through.
 *
 * Usage, at the top of a POST handler after its sign-in check:
 *   if (confirmFirst(req, res, 'decline_offer', { cancelHref: '/marketplace/offers' })) return undefined;
 */

const NS = 'govuk_alpha.confirm_action.';

function hiddenFields(body) {
  const fields = [];
  for (const [name, value] of Object.entries(body || {})) {
    if (name === '_csrf' || name === 'confirmed') continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item === undefined || item === null || typeof item === 'object') continue;
      fields.push({ name, value: String(item) });
    }
  }
  return fields;
}

/**
 * Renders the confirmation page and returns true unless this POST is the confirmed
 * one. `question` is a key under govuk_alpha.confirm_action; `button` (a full key)
 * defaults to the wording of the button the member pressed; `warning` (a full key)
 * defaults to "You cannot undo this." when `irreversible` is set.
 */
function confirmFirst(req, res, question, { cancelHref = '/', button = '', warning = '', irreversible = false } = {}) {
  if (req.body && String(req.body.confirmed) === '1') return false;
  // Signed out: let the handler send them to sign in, not to a question they cannot act on.
  if (!(req.token || (req.signedCookies && req.signedCookies.token))) return false;
  const t = typeof res.locals.t === 'function' ? res.locals.t : (key) => key;
  const heading = t(`${NS}${question}`);
  const warningKey = warning || (irreversible ? `${NS}cannot_undo` : '');
  res.render('confirm-delete', {
    title: heading,
    confirmHeading: heading,
    confirmWarning: warningKey ? t(warningKey) : '',
    confirmButton: button ? t(button) : heading,
    confirmAction: `${req.baseUrl || ''}${req.path}`,
    confirmFields: hiddenFields(req.body),
    confirmedFlag: true,
    cancelHref
  });
  return true;
}

module.exports = { confirmFirst, hiddenFields };
