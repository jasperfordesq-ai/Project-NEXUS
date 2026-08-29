// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const {
  getMyCaregiverLinks,
  getIncomingCaregiverLinks,
  createCaregiverLink,
  confirmIncomingCaregiverLink,
  rejectIncomingCaregiverLink,
  getCaregiverLinksForReview,
  approveCaregiverLink,
  rejectCaregiverLink,
  createCaregiverRequestOnBehalf,
  searchUsers
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { formatLocaleDate } = require('../lib/localization');
const { readDate } = require('../lib/date-input');

const router = express.Router();

/**
 * Caring Community — caregiver links, accessible frontend.
 *
 * 🔴 THIS FRONTEND OWNS NO PART OF THE WORKFLOW. It consumes the same Laravel
 * records and endpoints the React frontend uses, so a relationship created here
 * is the same record, at the same stage, as one created there. Nothing below
 * re-implements a rule; where a rule exists it lives in Laravel and this code
 * relies on Laravel refusing.
 *
 * The three gates, all enforced server-side:
 *   1. creation is always `pending` — this page cannot ask for anything else;
 *   2. the CARE RECIPIENT must agree before staff may approve;
 *   3. staff approval additionally needs recorded consent evidence and an
 *      explicit attestation.
 * Only an `active` link unlocks schedules, cover care and on-behalf requests.
 *
 * HTML-first: every action is a plain form POST with a submit button, and the
 * member search is a form submit rather than a live dropdown. Nothing here
 * requires JavaScript — which matters more for this journey than most, because
 * the people these relationships are about are exactly the people most likely
 * to be using assistive technology or an old browser.
 *
 * 🔴 Client-side validation here is a courtesy, never a control. Each check
 * below exists so the member gets a usable error summary instead of a bare
 * redirect; the authoritative refusal is always Laravel's.
 */

const RELATIONSHIP_TYPES = Object.freeze(['family', 'friend', 'neighbour', 'professional']);
const CONTACT_PREFERENCES = Object.freeze(['phone', 'message', 'either']);

// Mirrors the caring_caregiver_links status enum, so the page can never render
// a stage the backend does not have.
const STATUS_TAG_CLASS = Object.freeze({
  active: 'govuk-tag--green',
  rejected: 'govuk-tag--red',
  inactive: 'govuk-tag--grey',
  pending: 'govuk-tag--yellow'
});

const SUCCESS_STATES = Object.freeze([
  'link-requested', 'incoming-confirmed', 'incoming-rejected',
  'review-approved', 'review-rejected', 'on-behalf-sent'
]);
const ERROR_STATES = Object.freeze([
  'link-failed', 'link-duplicate', 'incoming-failed',
  'review-failed', 'review-not-found', 'review-not-agreed', 'on-behalf-failed'
]);
const STATUS_KEYS = Object.freeze({
  'link-requested': 'link_requested',
  'link-failed': 'link_failed',
  'link-duplicate': 'link_duplicate',
  'incoming-confirmed': 'incoming_confirmed',
  'incoming-rejected': 'incoming_rejected',
  'incoming-failed': 'incoming_failed',
  'review-approved': 'review_approved',
  'review-rejected': 'review_rejected',
  'review-not-agreed': 'review_not_agreed',
  'review-failed': 'review_failed',
  'review-not-found': 'review_not_found',
  'on-behalf-sent': 'on_behalf_sent',
  'on-behalf-failed': 'on_behalf_failed'
});

function unwrap(result) {
  return result?.data && typeof result.data === 'object' ? result.data : (result || {});
}

/**
 * 🔴 List endpoints answer `{ items: [...] }`, not a bare array — and the React
 * member search rendered a permanent "no results" for exactly this reason,
 * because `.length` on that object is `undefined`. Both shapes are accepted so
 * a paginated response cannot silently become an empty page here too.
 */
function asList(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function positiveInt(value) {
  const number = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function redirectTo(res, pathname, status) {
  const base = res.locals.urlFor(pathname);
  return res.redirect(status ? `${base}?status=${encodeURIComponent(status)}` : base);
}

function statusLocals(req) {
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  return {
    statusKey: status ? STATUS_KEYS[status] || null : null,
    statusIsSuccess: SUCCESS_STATES.includes(status),
    statusIsError: ERROR_STATES.includes(status)
  };
}

/**
 * Which stage label a pending link should show.
 *
 * 🔴 "Pending" alone is not good enough. A member who has asked to care for
 * someone needs to know WHICH of the two gates they are waiting on, or the
 * request looks stuck. The recipient's agreement and the staff check are
 * separate waits and are named separately.
 */
function stageKey(link) {
  if (link.status !== 'pending') return `status_${link.status}`;
  return link.recipient_confirmed_at ? 'status_pending_staff' : 'status_pending_recipient';
}

function presentLink(link, locale) {
  const status = typeof link?.status === 'string' ? link.status : 'pending';
  return {
    ...link,
    id: positiveInt(link?.id),
    status,
    stageKey: stageKey({ ...link, status }),
    tagClass: STATUS_TAG_CLASS[status] || STATUS_TAG_CLASS.pending,
    // The controls an ACTIVE link unlocks are rendered from this one flag, so a
    // pending or refused relationship cannot leak them through a second branch.
    isActive: status === 'active',
    startedLabel: link?.start_date
      ? formatLocaleDate(link.start_date, locale, { day: 'numeric', month: 'long', year: 'numeric' })
      : null
  };
}

// ---------------------------------------------------------------------------
// Member — hub
// ---------------------------------------------------------------------------

router.get('/', asyncRoute(async (req, res) => {
  return res.render('caring/hub', {
    title: res.locals.t('govuk_alpha_caring.hub.title'),
    activeNav: 'caring',
    ...statusLocals(req)
  });
}));

// ---------------------------------------------------------------------------
// Member — your caring relationships, and requests about you
// ---------------------------------------------------------------------------

router.get('/caregiver', asyncRoute(async (req, res) => {
  const locale = res.locals.locale || 'en';

  // A failure on either side must not blank the page: a member needs to see
  // whichever half DID load, especially the requests awaiting their answer.
  const [linksResult, incomingResult] = await Promise.all([
    getMyCaregiverLinks(req.token).catch(() => null),
    getIncomingCaregiverLinks(req.token).catch(() => null)
  ]);

  const links = asList(unwrap(linksResult), 'links').map((link) => presentLink(link, locale));

  // Only requests still awaiting THIS member's answer belong in the decision
  // list. One already confirmed is waiting on staff, not on them.
  const incoming = asList(unwrap(incomingResult), 'links')
    .filter((link) => link?.status === 'pending' && !link?.recipient_confirmed_at)
    .map((link) => ({ ...link, id: positiveInt(link?.id) }));

  return res.render('caring/caregiver', {
    title: res.locals.t('govuk_alpha_caring.caregiver.title'),
    activeNav: 'caring',
    links,
    incoming,
    ...statusLocals(req),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

/**
 * The care recipient's own answer. One handler for both, with the decision in a
 * form field, so the page needs only two plain submit buttons.
 *
 * 🔴 Agreeing does NOT create authority. Laravel keeps the link `pending` until
 * staff have separately verified that consent, and the copy says so.
 */
router.post('/caregiver/incoming/respond', asyncRoute(async (req, res) => {
  const linkId = positiveInt(req.body?.link_id);
  const action = String(req.body?.action ?? '');

  if (linkId <= 0 || (action !== 'confirm' && action !== 'reject')) {
    return redirectTo(res, '/caring/caregiver', 'incoming-failed');
  }

  try {
    if (action === 'confirm') {
      await confirmIncomingCaregiverLink(req.token, linkId);
    } else {
      await rejectIncomingCaregiverLink(
        req.token,
        linkId,
        trimmed(req.body?.reason) || res.locals.t('govuk_alpha_caring.caregiver.reject_button')
      );
    }
  } catch {
    return redirectTo(res, '/caring/caregiver', 'incoming-failed');
  }

  return redirectTo(res, '/caring/caregiver', action === 'confirm' ? 'incoming-confirmed' : 'incoming-rejected');
}));

// ---------------------------------------------------------------------------
// Member — ask to care for someone
// ---------------------------------------------------------------------------

/**
 * The form, and the member search that feeds it.
 *
 * The search is a GET with a query parameter rather than a live dropdown, so it
 * works with JavaScript switched off and the results are a real, linkable page
 * state. Choosing a member is likewise a GET, carrying the chosen id forward in
 * hidden fields.
 */
router.get('/caregiver/link', asyncRoute(async (req, res) => {
  const query = trimmed(req.query.q);
  const chosenId = positiveInt(req.query.member);
  const errors = [];
  let results = [];
  let chosen = null;

  if (query !== '' && query.length < 2) {
    errors.push({ key: 'error_search_too_short', href: '#caring-search' });
  } else if (query !== '') {
    const found = await searchUsers(req.token, query).catch(() => null);
    results = asList(unwrap(found), 'users')
      .map((user) => ({ id: positiveInt(user?.id), name: user?.name || user?.first_name || '' }))
      .filter((user) => user.id > 0);
  }

  if (chosenId > 0) {
    chosen = results.find((user) => user.id === chosenId)
      || { id: chosenId, name: trimmed(req.query.member_name) || res.locals.t('govuk_alpha_caring.shared.unknown_member') };
  }

  return res.render('caring/link', {
    title: res.locals.t('govuk_alpha_caring.link.title'),
    activeNav: 'caring',
    query,
    results,
    chosen,
    searched: query !== '',
    relationshipTypes: RELATIONSHIP_TYPES,
    errors,
    ...statusLocals(req),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.post('/caregiver/link', asyncRoute(async (req, res) => {
  const caredForId = positiveInt(req.body?.cared_for_id);
  const caredForName = trimmed(req.body?.cared_for_name);
  const relationshipType = String(req.body?.relationship_type ?? '');
  const notes = trimmed(req.body?.notes);

  const errors = [];
  if (caredForId <= 0) errors.push({ key: 'error_no_member', href: '#caring-search' });
  if (!RELATIONSHIP_TYPES.includes(relationshipType)) {
    errors.push({ key: 'error_no_relationship', href: '#relationship_type' });
  }

  // 🔴 `readDate`, not a hand-rolled parse of the three fields.
  //
  // It is the shared helper every converted date field in this app uses: it
  // reports a partly-filled date as an error instead of silently discarding
  // what the member typed, refuses a two-digit year rather than guessing the
  // century, and also accepts a single `YYYY-MM-DD` value so a bookmarked or
  // hand-built URL keeps working. Re-implementing that here would have got the
  // partly-filled case wrong.
  const date = readDate(req.body, 'start_date', { required: true });
  let dateErrorFields = [];
  if (date.error) {
    dateErrorFields = date.errorFields || [];
    // "You have not entered a date" and "that date does not exist" are different
    // mistakes; "enter a date" is unhelpful to someone who already entered one.
    const key = date.error === 'date_invalid' ? 'error_bad_start_date' : 'error_no_start_date';
    errors.push({ key, href: '#start_date-day' });
  }
  const startDate = date.value || '';

  if (errors.length) {
    // Re-render in place rather than redirecting, so the error summary can take
    // focus and each message can link to the field it is about.
    return res.render('caring/link', {
      title: res.locals.t('govuk_alpha_caring.link.title'),
      activeNav: 'caring',
      query: '',
      results: [],
      chosen: caredForId > 0 ? { id: caredForId, name: caredForName } : null,
      searched: false,
      relationshipTypes: RELATIONSHIP_TYPES,
      submitted: { relationshipType, notes, dateParts: date.parts },
      dateErrorFields,
      dateErrorMessage: dateErrorFields.length
        ? res.locals.t('govuk_alpha_caring.link.' + (date.error === 'date_invalid' ? 'error_bad_start_date' : 'error_no_start_date'))
        : undefined,
      errors,
      statusKey: null,
      statusIsSuccess: false,
      statusIsError: false,
      csrfToken: req.csrfToken ? req.csrfToken() : ''
    });
  }

  try {
    await createCaregiverLink(req.token, { caredForId, relationshipType, startDate, notes });
  } catch (error) {
    // "You already have one of these" is a different thing to tell someone than
    // "that did not work", and Laravel distinguishes them with a 409.
    return redirectTo(res, '/caring/caregiver', error?.status === 409 ? 'link-duplicate' : 'link-failed');
  }

  return redirectTo(res, '/caring/caregiver', 'link-requested');
}));

// ---------------------------------------------------------------------------
// Member — ask for help on behalf of someone (ACTIVE links only)
// ---------------------------------------------------------------------------

router.get('/caregiver/on-behalf/:caredForId', asyncRoute(async (req, res) => {
  const caredForId = positiveInt(req.params.caredForId);
  const locale = res.locals.locale || 'en';

  const linksResult = await getMyCaregiverLinks(req.token).catch(() => null);
  const link = asList(unwrap(linksResult), 'links')
    .map((row) => presentLink(row, locale))
    .find((row) => positiveInt(row.cared_for_id) === caredForId);

  // 🔴 Refuse here as well as server-side. Offering the form for a pending or
  // refused relationship and only failing on submit would tell the member they
  // hold authority they do not have.
  if (!link || !link.isActive) {
    return redirectTo(res, '/caring/caregiver', 'on-behalf-failed');
  }

  return res.render('caring/on-behalf', {
    title: res.locals.t('govuk_alpha_caring.on_behalf.title'),
    activeNav: 'caring',
    link,
    contactPreferences: CONTACT_PREFERENCES,
    errors: [],
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.post('/caregiver/on-behalf/:caredForId', asyncRoute(async (req, res) => {
  const caredForId = positiveInt(req.params.caredForId);
  const title = trimmed(req.body?.title);
  const description = trimmed(req.body?.description);
  const whenNeeded = trimmed(req.body?.when_needed);
  const contactPreference = CONTACT_PREFERENCES.includes(String(req.body?.contact_preference))
    ? String(req.body.contact_preference)
    : 'either';

  if (caredForId <= 0) {
    return redirectTo(res, '/caring/caregiver', 'on-behalf-failed');
  }

  // 🔴 Re-check the ACTIVE link on the POST, not only on the GET.
  //
  // An earlier version checked it when rendering the form and then, if the
  // title was filled in, posted straight to Laravel. That left the authority
  // question — "may this person act for that person?" — answered only by a page
  // the caller does not have to visit: a hand-written form post naming any
  // member id went through unchecked. Laravel refuses it, so nothing could
  // actually be created, but this frontend must not be the layer that tries.
  const locale = res.locals.locale || 'en';
  const linksResult = await getMyCaregiverLinks(req.token).catch(() => null);
  const link = asList(unwrap(linksResult), 'links')
    .map((row) => presentLink(row, locale))
    .find((row) => positiveInt(row.cared_for_id) === caredForId);

  if (!link || !link.isActive) {
    return redirectTo(res, '/caring/caregiver', 'on-behalf-failed');
  }

  if (title === '') {
    return res.render('caring/on-behalf', {
      title: res.locals.t('govuk_alpha_caring.on_behalf.title'),
      activeNav: 'caring',
      link,
      contactPreferences: CONTACT_PREFERENCES,
      submitted: { title, description, whenNeeded, contactPreference },
      errors: [{ key: 'error_no_title', href: '#on_behalf_title' }],
      csrfToken: req.csrfToken ? req.csrfToken() : ''
    });
  }

  try {
    await createCaregiverRequestOnBehalf(req.token, {
      caredForId, title, description, whenNeeded, contactPreference
    });
  } catch {
    return redirectTo(res, '/caring/caregiver', 'on-behalf-failed');
  }

  return redirectTo(res, '/caring/caregiver', 'on-behalf-sent');
}));

// ---------------------------------------------------------------------------
// Staff — the review queue
// ---------------------------------------------------------------------------

/**
 * 🔴 There is no role check here, deliberately.
 *
 * Authorisation for `/v2/admin/caring-community/*` is Laravel's, enforced by
 * `EnsureIsAdmin` and scoped to the caller's own community. A second, weaker
 * copy of that rule in Express would be one more thing to drift; what this page
 * must do instead is fail SAFELY when Laravel refuses, which it does by
 * rendering an empty queue rather than someone else's records.
 */
router.get('/reviews', asyncRoute(async (req, res) => {
  const locale = res.locals.locale || 'en';
  const result = await getCaregiverLinksForReview(req.token, 'pending').catch(() => null);

  const requests = asList(unwrap(result), 'links').map((link) => {
    const recipientAgreed = Boolean(link?.recipient_confirmed_at);
    return {
      ...link,
      id: positiveInt(link?.id),
      recipientAgreed,
      // Approval is offered only once the recipient has agreed. The button is
      // not merely disabled: the whole approval form is withheld, so there is
      // nothing to re-enable from the browser.
      canApprove: recipientAgreed,
      requestedOnLabel: link?.created_at
        ? formatLocaleDate(link.created_at, locale, { day: 'numeric', month: 'long', year: 'numeric' })
        : null
    };
  });

  return res.render('caring/reviews', {
    title: res.locals.t('govuk_alpha_caring.review.title'),
    activeNav: 'caring',
    requests,
    ...statusLocals(req),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

/**
 * One decision handler for approve and refuse.
 *
 * 🔴 Both branches demand their evidence BEFORE calling Laravel — evidence and
 * an explicit attestation to approve, a reason to refuse — so the member gets a
 * proper error summary. Laravel refuses on the same grounds regardless; this is
 * the courtesy layer, not the control.
 */
router.post('/reviews/:id/decide', asyncRoute(async (req, res) => {
  const linkId = positiveInt(req.params.id);
  const action = String(req.body?.action ?? '');
  const evidence = trimmed(req.body?.consent_evidence);
  const attested = req.body?.consent_verified === 'yes' || req.body?.consent_verified === 'on';
  const reason = trimmed(req.body?.reason);

  if (linkId <= 0 || (action !== 'approve' && action !== 'reject')) {
    return redirectTo(res, '/caring/reviews', 'review-failed');
  }

  const errors = [];
  if (action === 'approve') {
    if (evidence === '') errors.push({ key: 'error_no_evidence', href: `#consent_evidence_${linkId}` });
    if (!attested) errors.push({ key: 'error_no_attestation', href: `#consent_verified_${linkId}` });
  } else if (reason === '') {
    errors.push({ key: 'error_no_reason', href: `#reason_${linkId}` });
  }

  if (errors.length) {
    const locale = res.locals.locale || 'en';
    const result = await getCaregiverLinksForReview(req.token, 'pending').catch(() => null);
    const requests = asList(unwrap(result), 'links').map((link) => {
      const recipientAgreed = Boolean(link?.recipient_confirmed_at);
      return {
        ...link,
        id: positiveInt(link?.id),
        recipientAgreed,
        canApprove: recipientAgreed,
        requestedOnLabel: link?.created_at
          ? formatLocaleDate(link.created_at, locale, { day: 'numeric', month: 'long', year: 'numeric' })
          : null
      };
    });

    return res.render('caring/reviews', {
      title: res.locals.t('govuk_alpha_caring.review.title'),
      activeNav: 'caring',
      requests,
      errors,
      errorLinkId: linkId,
      submitted: { evidence, reason, action },
      statusKey: null,
      statusIsSuccess: false,
      statusIsError: false,
      csrfToken: req.csrfToken ? req.csrfToken() : ''
    });
  }

  try {
    if (action === 'approve') {
      await approveCaregiverLink(req.token, linkId, evidence);
    } else {
      await rejectCaregiverLink(req.token, linkId, reason);
    }
  } catch (error) {
    // 422 on approve is Laravel saying the care recipient has not agreed. That
    // is a different message to "something went wrong" and must not be
    // flattened into one, or the reviewer cannot tell what to do next.
    if (error?.status === 404) return redirectTo(res, '/caring/reviews', 'review-not-found');
    if (error?.status === 422 && action === 'approve') {
      return redirectTo(res, '/caring/reviews', 'review-not-agreed');
    }
    return redirectTo(res, '/caring/reviews', 'review-failed');
  }

  return redirectTo(res, '/caring/reviews', action === 'approve' ? 'review-approved' : 'review-rejected');
}));

module.exports = router;
