// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs/promises');
const { randomUUID } = require('crypto');
const express = require('express');
const {
  getSupportActions,
  confirmSupportAction,
  declineSupportAction,
  cancelSupportAction,
  getChildAccounts,
  getSupportedMemberWallet,
  prepareSupportAction,
  transferForSupportedMember,
  createListingForSupportedMember,
  uploadSupportedMemberListingImage,
  getListingCategories,
  callWalletApi
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { formatLocaleDate } = require('../lib/localization');
const { walletMaxTransfer } = require('../lib/wallet-limits');
const { resolveSupportTiers, tierPermitsAction } = require('./settings');

const router = express.Router();

/**
 * Co-decide support actions, both sides.
 *
 * A supporter PREPARES a listing or a transfer and nothing happens until the
 * supported member answers — here, from the emailed single-use link, or in the
 * React app. Members who never sign in are covered by the email route; this
 * page is for those who do.
 *
 * HTML-first: every answer is a plain form POST with the answer as a field, so
 * the page needs only submit buttons and no JavaScript.
 */

const ANSWERS = Object.freeze(['approve', 'decline', 'withdraw']);

const SUCCESS_STATES = Object.freeze([
  'support-approved', 'support-declined', 'support-withdrawn', 'support-prepared', 'support-done'
]);
const ERROR_STATES = Object.freeze(['support-not-found', 'support-failed', 'support-photo-failed']);
// Full keys under govuk_alpha_settings: answers live in support_actions.*,
// the prepare outcomes in support_prepare.*.
const STATUS_KEYS = Object.freeze({
  'support-approved': 'support_actions.status_approved',
  'support-declined': 'support_actions.status_declined',
  'support-withdrawn': 'support_actions.status_withdrawn',
  'support-not-found': 'support_actions.status_not_found',
  'support-failed': 'support_actions.status_failed',
  'support-prepared': 'support_prepare.status_prepared',
  'support-done': 'support_prepare.status_done',
  'support-photo-failed': 'support_prepare.photo_upload_failed'
});

const STATE_TAG_CLASS = Object.freeze({
  confirmed: 'govuk-tag--green',
  declined: 'govuk-tag--red',
  pending: 'govuk-tag--yellow'
});

function unwrap(result) {
  return result?.data && typeof result.data === 'object' ? result.data : (result || {});
}

function actionsFrom(result) {
  const data = unwrap(result);
  return Array.isArray(data.actions) ? data.actions : [];
}

function positiveInt(value) {
  const number = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function redirectToSupportActions(res, status) {
  return res.redirect(`${res.locals.urlFor('/settings/support-actions')}?status=${encodeURIComponent(status)}`);
}

router.get('/', asyncRoute(async (req, res) => {
  const locale = res.locals.locale || 'en';

  // One side failing must not blank the other: a member needs to see what they
  // have been asked to answer even if their own prepared actions fail to load.
  const [incomingResult, outgoingResult] = await Promise.all([
    getSupportActions(req.token, 'supported').catch(() => null),
    getSupportActions(req.token, 'supporter').catch(() => null)
  ]);

  const status = typeof req.query.status === 'string' ? req.query.status : null;

  return res.render('settings/support-actions', {
    title: res.locals.t('govuk_alpha_settings.support_actions.title'),
    activeNav: 'account',
    incoming: actionsFrom(incomingResult).map((action) => {
      const summary = action?.payload_summary && typeof action.payload_summary === 'object'
        ? action.payload_summary
        : {};
      return {
        ...action,
        id: positiveInt(action?.id),
        typeKey: `type_${action?.action_type || 'listing_create'}`,
        detail: action.action_type === 'credit_transfer'
          ? `${summary.amount ?? ''} → ${summary.recipient_name ?? ''} (#${summary.recipient_id ?? ''})`
          : summary.title ?? null,
        expiresOnLabel: action?.expires_at
          ? formatLocaleDate(action.expires_at, locale, { day: 'numeric', month: 'long', year: 'numeric' })
          : null
      };
    }),
    outgoing: actionsFrom(outgoingResult).map((action) => {
      const state = action?.status || 'pending';
      return {
        ...action,
        id: positiveInt(action?.id),
        state,
        stateTagClass: STATE_TAG_CLASS[state] || 'govuk-tag--grey',
        typeKey: `type_${action?.action_type || 'listing_create'}`
      };
    }),
    statusKey: status ? STATUS_KEYS[status] || null : null,
    statusIsSuccess: SUCCESS_STATES.includes(status),
    statusIsError: ERROR_STATES.includes(status),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

/**
 * One handler for approve, decline and withdraw. The decline reason is OPTIONAL
 * and never required — the same rule as refusing a guardian arrangement.
 */
router.post('/respond', asyncRoute(async (req, res) => {
  const actionId = positiveInt(req.body?.action_id);
  const answer = String(req.body?.answer ?? '');
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';

  if (actionId <= 0 || !ANSWERS.includes(answer)) {
    return redirectToSupportActions(res, 'support-failed');
  }

  try {
    if (answer === 'approve') {
      await confirmSupportAction(req.token, actionId);
    } else if (answer === 'decline') {
      await declineSupportAction(req.token, actionId, reason);
    } else {
      await cancelSupportAction(req.token, actionId);
    }
  } catch (error) {
    // Blade separates "that is not there" from a general failure, because an
    // action that has already been answered or expired is a different message
    // from something going wrong.
    return redirectToSupportActions(res, error?.status === 404 ? 'support-not-found' : 'support-failed');
  }

  return redirectToSupportActions(res, {
    approve: 'support-approved',
    decline: 'support-declined',
    withdraw: 'support-withdrawn'
  }[answer]);
}));

/* ------------------------------------------------------------------------- *
 * The supporter's side: PREPARE an action for the member they support
 * (React SupportPrepareModal).
 *
 * The tier the supporter holds for the capability decides what happens, and
 * every page says which before any field is filled in:
 *   co_decide  → POST /v2/users/me/support-actions — nothing happens until the
 *                supported member approves (here, or from the emailed link);
 *   represent  → the proxy endpoints — it happens now, belongs to the member,
 *                and is recorded as done by the supporter on their behalf.
 *
 * Only what the API permits for this relationship is offered: the tier is read
 * from the supporter's own linked-accounts list, and Laravel re-checks it (and
 * the safeguarding contact policy) on every write regardless.
 *
 * HTML-first: a form, then a check page, then the action — so nothing that moves
 * money or acts for someone happens on the first press.
 * ------------------------------------------------------------------------- */

const LISTING_TYPES = Object.freeze(['offer', 'request']);
const LISTING_SERVICE_TYPES = Object.freeze(['physical_only', 'remote_only', 'hybrid', 'location_dependent']);
const PHOTO_MIME_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

function text(value, limit) {
  const trimmedText = String(value ?? '').trim();
  return limit ? trimmedText.slice(0, limit) : trimmedText;
}

function linkedAccountsNotAllowed(res) {
  return res.redirect(`${res.locals.urlFor('/settings/linked-accounts')}?status=support-not-allowed#children`);
}

function displayName(row) {
  const composed = [row?.first_name, row?.last_name].map((part) => text(part)).filter(Boolean).join(' ');
  return text(row?.name) || composed || text(row?.email) || null;
}

function childRowsFrom(result) {
  const data = unwrap(result);
  if (Array.isArray(data)) return data;
  for (const key of ['children', 'sub_accounts', 'accounts', 'items']) {
    if (Array.isArray(data[key])) return data[key];
  }
  return [];
}

/**
 * This supporter's ACTIVE relationship with `userId`, and the tier it holds for
 * `capability` — or null. A member id belonging to somebody else never matches,
 * because only this supporter's own list is read.
 */
async function supportedMemberFor(token, userId, capability) {
  const rows = childRowsFrom(await getChildAccounts(token));
  for (const row of rows) {
    if (positiveInt(row?.user_id ?? row?.child_user_id) !== userId) continue;
    if (String(row?.status || '') !== 'active') return null;
    const tier = resolveSupportTiers(row?.permissions)[capability];
    if (!tierPermitsAction(tier)) return null;
    return { userId, name: displayName(row) || '', tier };
  }
  return null;
}

function apiRefused(error) {
  return error?.status === 403;
}

function apiMessage(error, t) {
  const data = error?.data && typeof error.data === 'object' ? error.data : {};
  const fromList = Array.isArray(data.errors) && data.errors[0] && typeof data.errors[0].message === 'string'
    ? data.errors[0].message
    : '';
  return fromList || (typeof data.message === 'string' ? data.message : '') || t('govuk_alpha_settings.support_actions.status_failed');
}

function photoUploadsAvailable(req) {
  // Photo upload needs a multipart parser mounted ahead of CSRF for the photo
  // path in server.js. Until that mount exists the step is never offered — a
  // file field the CSRF check would reject is worse than no field.
  return Boolean(req.app && req.app.get('supportPreparePhotoUploads'));
}

/* ---------- Transfer ---------- */

function recipientName(row) {
  return displayName(row) || '';
}

async function searchRecipients(token, query) {
  const q = text(query, 100);
  if (q.length < 2) return [];
  const params = new URLSearchParams();
  params.set('q', q);
  params.set('limit', '10');
  const data = unwrap(await callWalletApi(token, 'GET', `/user-search?${params.toString()}`));
  const users = Array.isArray(data.users) ? data.users : (Array.isArray(data) ? data : []);
  return users
    .map((user) => ({ id: positiveInt(user?.id), name: recipientName(user) }))
    .filter((user) => user.id > 0 && user.name !== '');
}

async function transferContext(req, supported) {
  const [walletResult, maxTransfer] = await Promise.all([
    // A missing balance must not block the form — the server enforces the real
    // limits on submit regardless (same rule as React).
    getSupportedMemberWallet(req.token, supported.userId).catch(() => null),
    walletMaxTransfer(req.token)
  ]);
  const balanceValue = Number(unwrap(walletResult).balance);
  return {
    balance: walletResult && Number.isFinite(balanceValue) ? balanceValue : null,
    maxTransfer
  };
}

function transferInput(body = {}) {
  return {
    recipientId: positiveInt(body.recipient_id),
    recipientQuery: text(body.recipient_q, 100),
    amountText: text(body.amount, 32),
    description: text(body.description, 500),
    idempotencyKey: text(body.idempotency_key, 191)
  };
}

/** React's validation order, against the SUPPORTED member's balance and the cap. */
function transferErrors(input, recipient, context, t) {
  if (!recipient) {
    return [{ text: t('govuk_alpha_settings.support_prepare.validation_recipient'), href: '#recipient_q' }];
  }
  const amount = Number(input.amountText);
  if (input.amountText === '' || !Number.isFinite(amount) || amount <= 0) {
    return [{ text: t('govuk_alpha_settings.support_prepare.validation_amount'), href: '#amount' }];
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(input.amountText)) {
    return [{ text: t('wallet.errors.decimals'), href: '#amount' }];
  }
  if (context.balance !== null && amount > context.balance) {
    return [{ text: t('govuk_alpha_settings.support_prepare.validation_balance', { balance: context.balance }), href: '#amount' }];
  }
  if (context.maxTransfer !== null && amount > context.maxTransfer) {
    return [{ text: t('govuk_alpha_settings.support_prepare.validation_max', { max: context.maxTransfer }), href: '#amount' }];
  }
  return [];
}

async function chosenRecipient(token, input) {
  if (!input.recipientId) return null;
  const results = await searchRecipients(token, input.recipientQuery).catch(() => []);
  return results.find((user) => user.id === input.recipientId) || null;
}

function renderTransferForm(req, res, supported, context, extras = {}) {
  return res.render('settings/support-prepare-transfer', {
    title: res.locals.t('govuk_alpha_settings.support_prepare.transfer_title', { name: supported.name }),
    activeNav: 'account',
    supportedUserId: supported.userId,
    supportedName: supported.name,
    tier: supported.tier,
    balance: context.balance,
    maxTransfer: context.maxTransfer,
    recipients: extras.recipients || [],
    recipient: extras.recipient || null,
    recipientQuery: extras.recipientQuery || '',
    values: extras.values || { amount: '', description: '' },
    errors: extras.errors || [],
    pageHasErrors: Boolean(extras.errors && extras.errors.length),
    // Minted per form: the represent path sends it as the wallet idempotency
    // key, so a double press can never move the credits twice.
    idempotencyKey: extras.idempotencyKey || randomUUID(),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}

router.get('/prepare/:userId(\\d+)/transfer', asyncRoute(async (req, res) => {
  const supported = await supportedMemberFor(req.token, positiveInt(req.params.userId), 'credits');
  if (!supported) return linkedAccountsNotAllowed(res);

  const context = await transferContext(req, supported);
  const recipientQuery = text(req.query.recipient_q, 100);
  const recipients = await searchRecipients(req.token, recipientQuery).catch(() => []);
  const chosenId = positiveInt(req.query.recipient_id);

  return renderTransferForm(req, res, supported, context, {
    recipientQuery,
    recipients,
    recipient: recipients.find((user) => user.id === chosenId) || null
  });
}));

router.post('/prepare/:userId(\\d+)/transfer/review', asyncRoute(async (req, res) => {
  const supported = await supportedMemberFor(req.token, positiveInt(req.params.userId), 'credits');
  if (!supported) return linkedAccountsNotAllowed(res);

  const input = transferInput(req.body);
  const [context, recipient] = await Promise.all([transferContext(req, supported), chosenRecipient(req.token, input)]);
  const formExtras = {
    recipientQuery: input.recipientQuery,
    recipient,
    values: { amount: input.amountText, description: input.description },
    idempotencyKey: input.idempotencyKey.length >= 8 ? input.idempotencyKey : undefined
  };

  const errors = req.body?.edit === '1' ? [] : transferErrors(input, recipient, context, res.locals.t);
  if (req.body?.edit === '1' || errors.length > 0) {
    return renderTransferForm(req, res, supported, context, { ...formExtras, errors });
  }

  return res.render('settings/support-prepare-transfer-check', {
    title: res.locals.t('onboarding.confirm.title'),
    activeNav: 'account',
    supportedUserId: supported.userId,
    supportedName: supported.name,
    tier: supported.tier,
    summary: {
      recipientId: recipient.id,
      recipientName: recipient.name,
      recipientQuery: input.recipientQuery,
      amount: Number(input.amountText),
      amountText: input.amountText,
      description: input.description
    },
    idempotencyKey: formExtras.idempotencyKey || randomUUID(),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.post('/prepare/:userId(\\d+)/transfer', asyncRoute(async (req, res) => {
  const supported = await supportedMemberFor(req.token, positiveInt(req.params.userId), 'credits');
  if (!supported) return linkedAccountsNotAllowed(res);

  const input = transferInput(req.body);
  const [context, recipient] = await Promise.all([transferContext(req, supported), chosenRecipient(req.token, input)]);
  const formExtras = {
    recipientQuery: input.recipientQuery,
    recipient,
    values: { amount: input.amountText, description: input.description }
  };

  // Re-validate: the check page is HTML and its hidden fields can be replayed.
  const errors = transferErrors(input, recipient, context, res.locals.t);
  // 🔴 Money. A represent transfer without a real key could be replayed into a
  // second debit, so a missing or stubby key is refused (wallet.js rule).
  if (errors.length === 0 && supported.tier === 'represent' && input.idempotencyKey.length < 8) {
    errors.push({ text: res.locals.t('govuk_alpha_settings.support_actions.status_failed'), href: '#amount' });
  }
  if (errors.length > 0) {
    return renderTransferForm(req, res, supported, context, { ...formExtras, errors });
  }

  const body = {
    recipient: recipient.id,
    amount: Number(input.amountText),
    ...(input.description !== '' ? { description: input.description } : {})
  };

  try {
    if (supported.tier === 'co_decide') {
      await prepareSupportAction(req.token, supported.userId, 'credit_transfer', body);
    } else {
      await transferForSupportedMember(req.token, supported.userId, { ...body, idempotency_key: input.idempotencyKey });
    }
  } catch (error) {
    if (error?.status === 401) throw error;
    if (apiRefused(error)) return linkedAccountsNotAllowed(res);
    return renderTransferForm(req, res, supported, context, {
      ...formExtras,
      errors: [{ text: apiMessage(error, res.locals.t), href: '#amount' }]
    });
  }

  return redirectToSupportActions(res, supported.tier === 'co_decide' ? 'support-prepared' : 'support-done');
}));

/* ---------- Listing ---------- */

function skillTagsFrom(value) {
  const seen = new Set();
  return String(value || '')
    .split(',')
    .map((tag) => text(tag, 100))
    .filter((tag) => {
      const key = tag.toLocaleLowerCase('en');
      if (!tag || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
}

function listingValues(body = {}) {
  return {
    title: text(body.title, 255),
    type: LISTING_TYPES.includes(text(body.type)) ? text(body.type) : 'offer',
    category_id: text(body.category_id, 32),
    description: text(body.description, 10000),
    hours_estimate: text(body.hours_estimate, 32),
    service_type: LISTING_SERVICE_TYPES.includes(text(body.service_type)) ? text(body.service_type) : 'physical_only',
    location: text(body.location, 255),
    skill_tags: text(body.skill_tags, 600)
  };
}

function listingErrors(values, t) {
  const errors = [];
  const required = (labelKey, href) => errors.push({
    text: t('govuk_alpha_settings.support_prepare.field_required', { field: t(labelKey) }), href
  });
  if (values.title === '') required('listings.create.title_label', '#title');
  if (values.description === '') required('listings.create.description_label', '#description');
  if (values.hours_estimate !== '') {
    const hours = Number(values.hours_estimate);
    if (!Number.isFinite(hours) || hours <= 0) {
      errors.push({
        text: t('govuk_alpha_settings.support_prepare.field_invalid', { field: t('listings.create.hours_label') }),
        href: '#hours_estimate'
      });
    }
  }
  return errors;
}

/** The payload React's ListingForm sends, skill tags included, so approval
 *  recreates exactly what was prepared. */
function listingPayload(values) {
  const categoryId = positiveInt(values.category_id);
  const skillTags = skillTagsFrom(values.skill_tags);
  return {
    title: values.title,
    type: values.type,
    ...(categoryId > 0 ? { category_id: categoryId } : {}),
    description: values.description,
    ...(values.hours_estimate !== '' ? { hours_estimate: Number(values.hours_estimate) } : {}),
    service_type: values.service_type,
    ...(values.location !== '' ? { location: values.location } : {}),
    ...(skillTags.length > 0 ? { skill_tags: skillTags } : {})
  };
}

async function listingCategories(token) {
  try {
    const data = unwrap(await getListingCategories(token));
    const rows = Array.isArray(data) ? data : (Array.isArray(data.categories) ? data.categories : []);
    return rows
      .map((row) => ({ id: positiveInt(row?.id), name: text(row?.name) }))
      .filter((row) => row.id > 0 && row.name !== '');
  } catch (error) {
    if (error?.status === 401) throw error;
    return [];
  }
}

async function renderListingForm(req, res, supported, extras = {}) {
  return res.render('settings/support-prepare-listing', {
    title: res.locals.t('govuk_alpha_settings.support_prepare.listing_title', { name: supported.name }),
    activeNav: 'account',
    supportedUserId: supported.userId,
    supportedName: supported.name,
    tier: supported.tier,
    categories: await listingCategories(req.token),
    values: extras.values || listingValues({}),
    errors: extras.errors || [],
    pageHasErrors: Boolean(extras.errors && extras.errors.length),
    // 🔴 A photo cannot travel on the co_decide path: nothing exists to attach
    // it to until the member approves, and holding an image against an
    // unapproved action would store someone's photo with no listing to own it.
    photoAfterApproval: supported.tier === 'co_decide',
    photoOffered: supported.tier === 'represent' && photoUploadsAvailable(req),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}

router.get('/prepare/:userId(\\d+)/listing', asyncRoute(async (req, res) => {
  const supported = await supportedMemberFor(req.token, positiveInt(req.params.userId), 'listings');
  if (!supported) return linkedAccountsNotAllowed(res);
  return renderListingForm(req, res, supported);
}));

router.post('/prepare/:userId(\\d+)/listing/review', asyncRoute(async (req, res) => {
  const supported = await supportedMemberFor(req.token, positiveInt(req.params.userId), 'listings');
  if (!supported) return linkedAccountsNotAllowed(res);

  const values = listingValues(req.body);
  if (req.body?.edit === '1') return renderListingForm(req, res, supported, { values });

  const errors = listingErrors(values, res.locals.t);
  if (errors.length > 0) return renderListingForm(req, res, supported, { values, errors });

  const categories = await listingCategories(req.token);
  const category = categories.find((row) => row.id === positiveInt(values.category_id));

  return res.render('settings/support-prepare-listing-check', {
    title: res.locals.t('onboarding.confirm.title'),
    activeNav: 'account',
    supportedUserId: supported.userId,
    supportedName: supported.name,
    tier: supported.tier,
    values,
    categoryName: category ? category.name : '',
    photoOffered: supported.tier === 'represent' && photoUploadsAvailable(req),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.post('/prepare/:userId(\\d+)/listing', asyncRoute(async (req, res) => {
  const supported = await supportedMemberFor(req.token, positiveInt(req.params.userId), 'listings');
  if (!supported) return linkedAccountsNotAllowed(res);

  const values = listingValues(req.body);
  const errors = listingErrors(values, res.locals.t);
  if (errors.length > 0) return renderListingForm(req, res, supported, { values, errors });

  const payload = listingPayload(values);
  let listingId = 0;
  try {
    if (supported.tier === 'co_decide') {
      await prepareSupportAction(req.token, supported.userId, 'listing_create', payload);
    } else {
      listingId = positiveInt(unwrap(await createListingForSupportedMember(req.token, supported.userId, payload)).id);
    }
  } catch (error) {
    if (error?.status === 401) throw error;
    if (apiRefused(error)) return linkedAccountsNotAllowed(res);
    return renderListingForm(req, res, supported, {
      values,
      errors: [{ text: apiMessage(error, res.locals.t), href: '#title' }]
    });
  }

  if (supported.tier === 'represent' && listingId > 0 && photoUploadsAvailable(req)) {
    return res.redirect(res.locals.urlFor(`/settings/support-actions/prepare/${supported.userId}/listing/${listingId}/photo`));
  }
  return redirectToSupportActions(res, supported.tier === 'co_decide' ? 'support-prepared' : 'support-done');
}));

router.get('/prepare/:userId(\\d+)/listing/:listingId(\\d+)/photo', asyncRoute(async (req, res) => {
  const supported = await supportedMemberFor(req.token, positiveInt(req.params.userId), 'listings');
  if (!supported || supported.tier !== 'represent') return linkedAccountsNotAllowed(res);
  if (!photoUploadsAvailable(req)) return redirectToSupportActions(res, 'support-done');

  return res.render('settings/support-prepare-photo', {
    title: res.locals.t('govuk_alpha_settings.support_prepare.photo_title', { name: supported.name }),
    activeNav: 'account',
    supportedUserId: supported.userId,
    supportedName: supported.name,
    listingId: positiveInt(req.params.listingId),
    photoError: typeof req.query.error === 'string' && req.query.error === 'type',
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.post('/prepare/:userId(\\d+)/listing/:listingId(\\d+)/photo', asyncRoute(async (req, res) => {
  const image = req.files && req.files.image && typeof req.files.image === 'object' ? req.files.image : null;
  const removeTemp = async () => {
    if (image?.filepath) await fs.unlink(image.filepath).catch(() => {});
  };

  const supported = await supportedMemberFor(req.token, positiveInt(req.params.userId), 'listings');
  if (!supported || supported.tier !== 'represent') {
    await removeTemp();
    return linkedAccountsNotAllowed(res);
  }
  const listingId = positiveInt(req.params.listingId);

  // No file chosen: the listing already exists and is theirs — finishing
  // without a photo is a valid answer, not an error.
  if (!image || !image.filepath) return redirectToSupportActions(res, 'support-done');

  if (!PHOTO_MIME_TYPES.includes(String(image.mimetype || '').toLowerCase()) || Number(image.size) > PHOTO_MAX_BYTES) {
    await removeTemp();
    return res.redirect(`${res.locals.urlFor(`/settings/support-actions/prepare/${supported.userId}/listing/${listingId}/photo`)}?error=type`);
  }

  try {
    const buffer = await fs.readFile(image.filepath);
    await uploadSupportedMemberListingImage(req.token, supported.userId, listingId, {
      buffer,
      filename: text(image.originalFilename) || 'listing-image',
      contentType: text(image.mimetype) || 'application/octet-stream'
    });
  } catch (error) {
    if (error?.status === 401) throw error;
    // The listing exists and is theirs; only the photo failed (React warns
    // rather than reporting the whole action as failed).
    return redirectToSupportActions(res, 'support-photo-failed');
  } finally {
    await removeTemp();
  }

  return redirectToSupportActions(res, 'support-done');
}));

module.exports = router;
