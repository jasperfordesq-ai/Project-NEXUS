// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const fs = require('fs/promises');
const { randomUUID } = require('node:crypto');
const { URL } = require('node:url');
const {
  getEvents,
  getEvent,
  createEvent,
  updateEvent,
  cancelEvent,
  deleteEvent,
  getEventRsvps,
  rsvpToEvent,
  votePoll,
  getPolls,
  getPoll,
  callEventApi,
  callEventBroadcastApi,
  callAdminEventApi,
  callEventTemplateApi,
  downloadEventApi,
  downloadEventRegistrationSubmissions,
  getEventCategories,
  uploadEventImage,
  callUgcTranslateApi,
  ApiError
} = require('../lib/api');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = require('../lib/routeHelpers');
const { audit } = require('../lib/auditLogger');
const { flagEnabled, localeOptions, resolveBackendAssetUrl } = require('../lib/accessible-shell');
const { getRequestProfile } = require('../lib/request-profile');

const router = express.Router();

function tokenFrom(req) {
  return req.token || req.signedCookies?.token || '';
}

function trimmed(value, limit = null) {
  const text = String(value || '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function safeExternalHttpUrl(value) {
  const text = trimmed(value, 2048);
  if (!text) return '';
  try {
    const parsed = new URL(text);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function boundedPositiveInteger(value, fallback, max = null) {
  const number = positiveInteger(value) || fallback;
  return max === null ? number : Math.min(number, max);
}

function checked(value) {
  if (Array.isArray(value)) return value.some((item) => checked(item));
  return value === true || ['1', 'true', 'on', 'yes'].includes(String(value || '').toLowerCase());
}

function moderationPage(value) {
  if (value === undefined) return 1;
  const text = String(value || '');
  return /^[1-9][0-9]*$/.test(text) ? Math.min(Number(text), 1000000) : null;
}

function moderationEvent(value, t) {
  const row = value && typeof value === 'object' ? value : {};
  return {
    ...row,
    id: positiveInteger(row.id),
    title: trimmed(row.title),
    description: trimmed(row.description),
    startAt: trimmed(row.start_at || row.start_date),
    endAt: trimmed(row.end_at || row.end_date),
    timezone: trimmed(row.timezone) || 'UTC',
    allDay: Boolean(row.all_day),
    location: trimmed(row.location),
    isOnline: Boolean(row.is_online),
    recurring: Boolean(row.is_recurring_template || row.series?.is_recurring),
    organizerName: trimmed(row.organizer?.display_name || row.organizer_name || row.creator_name)
      || t('govuk_alpha_events.moderation.organizer_unavailable'),
    submittedAt: trimmed(row.moderation?.submitted_at)
  };
}

function moderationDate(value, timezone, allDay, formatDate) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const formatter = typeof formatDate === 'function' ? formatDate : (input) => String(input);
  return formatter(date, allDay
    ? { day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone }
    : { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: timezone });
}

function moderationPrivate(res) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Referrer-Policy', 'same-origin');
  res.vary('Authorization');
  res.vary('Cookie');
}

function uploadedFile(req, fieldName) {
  const file = req.files && req.files[fieldName];
  return file && typeof file === 'object' ? file : null;
}

async function removeUploadedFile(file) {
  if (!file || !file.filepath) return;
  try {
    await fs.unlink(file.filepath);
  } catch {
    // Temporary upload cleanup is best-effort only.
  }
}

function resultEventId(result) {
  const data = dataFrom(result);
  return positiveInteger(
    data?.event?.id
    || data?.template?.id
    || data?.id
    || result?.event?.id
    || result?.id
  );
}

async function uploadEventCoverImage(token, eventId, image) {
  if (!image || !image.filepath || !eventId) return;

  const buffer = await fs.readFile(image.filepath);
  await uploadEventImage(token, eventId, {
    file: {
      buffer,
      filename: trimmed(image.originalFilename) || 'event-image',
      contentType: trimmed(image.mimetype) || 'application/octet-stream',
      size: image.size
    }
  });
}

function loginRedirect() {
  return '/login?status=auth-required';
}

const EVENTS_PATH = '/events';
const EVENT_DETAIL_STATUSES = [
  'event-created', 'rsvp-updated', 'event-updated', 'event-cancelled',
  'event-submitted', 'event-published', 'checkin-success', 'checkin-failed',
  'waitlist-joined', 'waitlist-left', 'waitlist-offer-accepted', 'poll-voted',
  'rsvp-failed', 'rsvp-vetting-required', 'rsvp-policy-unavailable',
  'event-update-failed', 'event-cancel-failed', 'event-publication-failed',
  'waitlist-failed', 'waitlist-offer-accept-failed', 'waitlist-vetting-required',
  'waitlist-policy-unavailable', 'poll-vote-failed'
];

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function isAuthError(error) {
  return error instanceof ApiError && error.status === 401;
}

function redirectOnAuthError(error, res) {
  if (isAuthError(error)) {
    redirectTo(res, loginRedirect());
    return true;
  }
  return false;
}

async function callApi(token, method, path, data = undefined) {
  if (data === undefined) {
    return callEventApi(token, method, path);
  }

  return callEventApi(token, method, path, data);
}

function dataFrom(result) {
  return result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'data')
    ? result.data
    : result;
}

function collectionFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  if (Array.isArray(result?.items)) return result.items;
  return [];
}

function eventCategoryFrom(item) {
  const row = item && typeof item === 'object' ? item : {};
  const id = positiveInteger(row.id);
  const name = trimmed(row.name || row.title);
  if (id === null || !name) return null;
  return { id, name };
}

function eventFrom(result) {
  const data = dataFrom(result);
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return eventWithAssetUrls(data.event || data);
  }
  return {};
}

function eventWithAssetUrls(value) {
  const event = value && typeof value === 'object' ? value : {};
  const primaryImage = event.primary_image && typeof event.primary_image === 'object'
    ? event.primary_image
    : {};
  const coverImage = resolveBackendAssetUrl(event.cover_image || event.coverImage || primaryImage.url);
  return {
    ...event,
    cover_image: coverImage,
    coverImage
  };
}

function apiErrorsFrom(error) {
  if (!(error instanceof ApiError) || !error.data || typeof error.data !== 'object') {
    return [];
  }

  const { errors } = error.data;
  if (Array.isArray(errors)) {
    return errors
      .filter(item => item && typeof item === 'object')
      .map(item => ({
        code: trimmed(item.code).toUpperCase(),
        message: trimmed(item.message),
        field: trimmed(item.field)
      }));
  }

  if (errors && typeof errors === 'object') {
    return Object.entries(errors).flatMap(([field, messages]) => {
      const values = Array.isArray(messages) ? messages : [messages];
      return values
        .map(message => trimmed(message))
        .filter(Boolean)
        .map(message => ({ code: 'VALIDATION_ERROR', message, field }));
    });
  }

  return [];
}

function apiErrorCode(error) {
  return apiErrorsFrom(error)[0]?.code
    || trimmed(error?.data?.code || error?.data?.error_code).toUpperCase();
}

function isOnboardingRequired(error) {
  return error instanceof ApiError
    && error.status === 403
    && apiErrorCode(error) === 'ONBOARDING_REQUIRED';
}

function eventFormErrors(error, fallbackMessage) {
  const fieldAliases = {
    starts_at: 'start_time',
    ends_at: 'end_time'
  };
  const apiErrors = apiErrorsFrom(error);
  if (apiErrors.length === 0) {
    return [{ text: trimmed(error?.message) || fallbackMessage }];
  }

  return apiErrors.map(item => {
    const field = fieldAliases[item.field] || item.field;
    return {
      text: item.message || fallbackMessage,
      ...(field ? { href: `#${field}` } : {})
    };
  });
}

function renderForbidden(res, error) {
  return res.status(403).render('errors/403', {
    title: 'Forbidden',
    message: trimmed(error?.message) || 'You do not have permission to manage this event.'
  });
}

function idFrom(value) {
  const object = value && typeof value === 'object' ? value : {};
  const data = dataFrom(object);
  const row = data && typeof data === 'object' && !Array.isArray(data) ? data : object;
  return positiveInteger(row.id || row.user_id || row.userId);
}

function eventOwnerId(event) {
  const user = event && typeof event.user === 'object' ? event.user : {};
  const organizer = event && typeof event.organizer === 'object' ? event.organizer : {};
  const creator = event && typeof event.created_by === 'object' ? event.created_by : {};
  return positiveInteger(
    event.user_id || event.userId || event.organizer_id || event.organizerId
      || event.created_by_id || event.createdById || user.id || organizer.id || creator.id
  );
}

function fieldErrorsFrom(errors) {
  return Object.fromEntries((Array.isArray(errors) ? errors : [])
    .filter((error) => /^#[a-z][a-z0-9_-]*$/i.test(trimmed(error?.href)))
    .map((error) => [trimmed(error.href).slice(1), trimmed(error.text)]));
}

const RECURRING_FORM_FIELDS = [
  'title', 'description', 'category_id', 'location', 'start_time', 'end_time',
  'is_online', 'online_link', 'allow_remote_attendance', 'video_url',
  'accessibility_step_free', 'accessibility_toilet', 'accessibility_hearing_loop',
  'accessibility_quiet_space', 'accessibility_seating', 'accessibility_parking',
  'accessibility_parking_details', 'accessibility_transit_details',
  'accessibility_assistance_contact', 'accessibility_notes', 'max_attendees', 'scope'
];

function recurringFormValues(body = {}) {
  return Object.fromEntries(RECURRING_FORM_FIELDS
    .filter((field) => Object.prototype.hasOwnProperty.call(body, field))
    .map((field) => [field, body[field]]));
}

function consumeRecurringForm(req, eventId) {
  const stored = req.session?.eventRecurringForm;
  if (req.session?.eventRecurringForm) delete req.session.eventRecurringForm;
  return stored && stored.eventId === eventId ? stored : {};
}

function storeRecurringForm(req, eventId, body, errors) {
  if (!req.session) return;
  req.session.eventRecurringForm = {
    eventId,
    values: recurringFormValues(body),
    errors
  };
}

function coordinate(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatCoordinate(value) {
  return Number(value).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function eventMapState(event, t = (key) => key) {
  const lat = coordinate(event.latitude ?? event.lat);
  const lng = coordinate(event.longitude ?? event.lng);
  const location = trimmed(event.location);
  const isOnline = checked(event.is_online ?? event.isOnline);
  const hasCoordinates = lat !== null && lng !== null && !isOnline;
  const latText = hasCoordinates ? formatCoordinate(lat) : '';
  const lngText = hasCoordinates ? formatCoordinate(lng) : '';
  const delta = 0.01;
  const bbox = hasCoordinates
    ? `${lng - delta}%2C${lat - delta}%2C${lng + delta}%2C${lat + delta}`
    : '';

  return {
    id: event.id,
    title: trimmed(event.title) || t('govuk_alpha_events.map.caption'),
    location,
    isOnline,
    hasCoordinates,
    latText,
    lngText,
    embedUrl: hasCoordinates ? `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latText}%2C${lngText}` : '',
    viewUrl: hasCoordinates ? `https://www.openstreetmap.org/?mlat=${latText}&mlon=${lngText}#map=15/${latText}/${lngText}` : '',
    directionsUrl: hasCoordinates ? `https://www.openstreetmap.org/directions?to=${latText}%2C${lngText}` : ''
  };
}

function eventPollFrom(item, eventId) {
  const row = item && typeof item === 'object' ? item : {};
  const id = positiveInteger(row.id);
  if (id === null) return null;
  const question = trimmed(row.question || row.title) || `#${id}`;
  const attached = checked(row.attached) || positiveInteger(row.event_id ?? row.eventId) === eventId;
  return {
    id,
    question,
    attached
  };
}

function eventIsSeries(event) {
  return checked(event.is_series ?? event.isSeries)
    || checked(event.is_recurring_template ?? event.isRecurringTemplate)
    || positiveInteger(event.parent_event_id ?? event.parentEventId) !== null;
}

function dateTimeLocal(value) {
  if (!value) return '';
  const text = trimmed(value);
  const localMatch = text.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (localMatch && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
    return `${localMatch[1]}T${localMatch[2]}`;
  }
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    // Laravel formats event inputs in its configured UTC application timezone.
    return date.toISOString().slice(0, 16);
  }
  return text.length >= 16 ? text.slice(0, 16) : text;
}

const PEOPLE_FILTERS = {
  registration_state: ['none', 'invited', 'pending', 'confirmed', 'declined', 'cancelled'],
  waitlist_state: ['none', 'active', 'waiting', 'offered', 'accepted', 'expired', 'cancelled'],
  attendance_state: ['not_checked_in', 'checked_in', 'checked_out', 'attended', 'no_show'],
  engagement_state: ['none', 'interested']
};

function selectedValue(value, allowed, fallback = '') {
  const candidate = trimmed(value);
  return allowed.includes(candidate) ? candidate : fallback;
}

function eventPeopleQuery(query = {}) {
  return {
    page: boundedPositiveInteger(query.page, 1),
    per_page: 25,
    search: trimmed(query.search, 255),
    registration_state: selectedValue(query.registration_state, PEOPLE_FILTERS.registration_state),
    waitlist_state: selectedValue(query.waitlist_state, PEOPLE_FILTERS.waitlist_state),
    attendance_state: selectedValue(query.attendance_state, PEOPLE_FILTERS.attendance_state),
    engagement_state: selectedValue(query.engagement_state, PEOPLE_FILTERS.engagement_state),
    sort: selectedValue(query.sort, ['name', 'registration', 'waitlist', 'attendance'], 'name'),
    direction: selectedValue(query.direction, ['asc', 'desc'], 'asc')
  };
}

function eventPeoplePath(id, query, page = query.page) {
  const parameters = new URLSearchParams();
  Object.entries({ ...query, page }).forEach(([key, value]) => {
    if (value !== '' && key !== 'per_page') parameters.set(key, String(value));
  });
  return eventPath(id, `/people?${parameters.toString()}`);
}

function eventPerson(row = {}) {
  const member = row.member && typeof row.member === 'object' ? row.member : {};
  const registration = row.registration && typeof row.registration === 'object' ? row.registration : {};
  const waitlist = row.waitlist && typeof row.waitlist === 'object' ? row.waitlist : {};
  const attendance = row.attendance && typeof row.attendance === 'object' ? row.attendance : {};
  const management = row.management_actions && typeof row.management_actions === 'object' ? row.management_actions : {};
  return {
    id: positiveInteger(member.id || row.user_id),
    name: trimmed(member.display_name || member.name),
    registrationState: selectedValue(registration.state, PEOPLE_FILTERS.registration_state, 'none'),
    registrationVersion: Math.max(0, Number.parseInt(registration.version ?? registration.registration_version ?? 0, 10) || 0),
    waitlistState: selectedValue(waitlist.state, PEOPLE_FILTERS.waitlist_state, 'none'),
    waitlistPosition: positiveInteger(waitlist.position),
    attendanceState: selectedValue(attendance.state, PEOPLE_FILTERS.attendance_state, 'not_checked_in'),
    attendanceVersion: Math.max(0, Number.parseInt(attendance.version ?? attendance.attendance_version ?? 0, 10) || 0),
    attendanceActions: {
      check_in: checked(management.check_in),
      check_out: checked(management.check_out),
      no_show: checked(management.no_show),
      undo: checked(management.undo_attendance)
    }
  };
}

function eventPollDetailFrom(item, eventId, t = (key) => key) {
  const row = item && typeof item === 'object' ? item : {};
  const id = positiveInteger(row.id);
  const scopedEventId = positiveInteger(row.event_id ?? row.eventId);
  if (id === null || (scopedEventId !== null && scopedEventId !== eventId)) return null;

  const votedOptionId = positiveInteger(row.voted_option_id ?? row.votedOptionId);
  const totalVotes = Math.max(0, Number.parseInt(row.total_votes ?? row.totalVotes, 10) || 0);
  const rawOptions = Array.isArray(row.options) ? row.options : [];
  const maxVotes = rawOptions.reduce(
    (maximum, option) => Math.max(maximum, Math.max(0, Number.parseInt(option?.vote_count ?? option?.voteCount, 10) || 0)),
    0
  );
  const options = rawOptions.map((option) => {
    const optionId = positiveInteger(option?.id);
    if (optionId === null) return null;
    const voteCount = Math.max(0, Number.parseInt(option.vote_count ?? option.voteCount, 10) || 0);
    const numericPercentage = Number(option.percentage);
    const percentage = Number.isFinite(numericPercentage) ? numericPercentage : 0;
    return {
      id: optionId,
      label: trimmed(option.text ?? option.label),
      voteCount,
      percentage,
      percentageRounded: Math.max(0, Math.min(100, Math.round(percentage))),
      isMine: votedOptionId !== null && optionId === votedOptionId,
      isLeading: totalVotes > 0 && voteCount === maxVotes
    };
  }).filter(Boolean);

  return {
    id,
    question: trimmed(row.question ?? row.title) || t('events.polls_heading'),
    description: trimmed(row.description),
    isOpen: trimmed(row.status).toLowerCase() === 'open',
    hasVoted: checked(row.has_voted ?? row.hasVoted),
    resultsVisible: checked(row.results_visible ?? row.resultsVisible),
    totalVotes,
    options
  };
}

async function eventPollDetails(token, eventId, t) {
  if (!token) return [];
  try {
    const summaries = collectionFrom(await getPolls(token, { event_id: eventId, limit: 20 }));
    const details = await Promise.all(summaries.map(async (summary) => {
      const pollId = positiveInteger(summary?.id);
      if (pollId === null) return null;
      try {
        return eventPollDetailFrom(dataFrom(await getPoll(token, pollId)), eventId, t);
      } catch {
        return null;
      }
    }));
    return details.filter(Boolean);
  } catch {
    return [];
  }
}

function eventAttendee(row = {}, t = (key) => key) {
  const member = row.member && typeof row.member === 'object' ? row.member : {};
  const registration = row.registration && typeof row.registration === 'object' ? row.registration : {};
  const engagement = row.engagement && typeof row.engagement === 'object' ? row.engagement : {};
  const legacyUser = row.user && typeof row.user === 'object' ? row.user : {};
  const name = trimmed(
    member.display_name || member.name || row.display_name || row.name || legacyUser.name
      || [row.first_name || legacyUser.first_name, row.last_name || legacyUser.last_name].filter(Boolean).join(' ')
  ) || t('govuk_alpha.members.unknown_member');
  const legacyStatus = trimmed(row.rsvp_status || row.status).toLowerCase();
  const status = registration.state === 'confirmed' || legacyStatus === 'going'
    ? 'going'
    : (engagement.state === 'interested' || ['interested', 'maybe'].includes(legacyStatus)
      ? 'interested'
      : 'not_going');

  return {
    name,
    initial: Array.from(name)[0]?.toLocaleUpperCase() || '',
    avatarUrl: resolveBackendAssetUrl(member.avatar_url || row.avatar_url || row.avatar || legacyUser.avatar_url || legacyUser.avatar),
    status
  };
}

function collectionMeta(result) {
  const data = dataFrom(result);
  if (result?.meta && typeof result.meta === 'object') return result.meta;
  if (data?.meta && typeof data.meta === 'object') return data.meta;
  return {};
}

function eventAttendeesNextPath(id, query, cursor) {
  if (!cursor) return '';
  const parameters = new URLSearchParams();
  Object.entries(query || {}).forEach(([key, value]) => {
    const candidate = Array.isArray(value) ? value[value.length - 1] : value;
    if (candidate !== undefined && candidate !== null && candidate !== '') {
      parameters.set(key, String(candidate));
    }
  });
  parameters.set('attendees_cursor', cursor);
  return eventPath(id, `?${parameters.toString()}`);
}

function dateTimeLocalInZone(value, timezone = 'UTC', subtractDay = false) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return dateTimeLocal(value);
  if (subtractDay) date.setUTCDate(date.getUTCDate() - 1);
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat(undefined, {
      timeZone: trimmed(timezone) || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  } catch {
    return dateTimeLocal(value);
  }
}

function triState(value) {
  if (value === true || value === 1) return 'yes';
  if (value === false || value === 0) return 'no';
  return 'unknown';
}

async function callEventMutation(token, method, path, data, idempotencyKey) {
  return callEventApi(token, method, path, data, {
    headers: { 'Idempotency-Key': idempotencyKey }
  });
}

function offlineCredentialFrom(result) {
  const data = dataFrom(result);
  const value = data?.credential;
  if (!value || typeof value !== 'object') return null;
  const id = positiveInteger(value.id);
  const version = positiveInteger(value.version ?? value.credential_version);
  return {
    id,
    version,
    status: selectedValue(value.status, ['active', 'rotated', 'revoked', 'expired'], 'expired'),
    expiresAt: trimmed(value.expires_at ?? value.expiresAt),
    revokedAt: trimmed(value.revoked_at ?? value.revokedAt),
    token: trimmed(value.token, 4096),
    tokenOneShot: value.token_one_shot === true
  };
}

function currentEventDetail(event) {
  const schedule = event.schedule && typeof event.schedule === 'object' ? event.schedule : {};
  const location = event.location && typeof event.location === 'object' ? event.location : {};
  const organizer = event.organizer && typeof event.organizer === 'object' ? event.organizer : {};
  const metrics = event.metrics && typeof event.metrics === 'object' ? event.metrics : {};
  const accessibility = location.accessibility && typeof location.accessibility === 'object'
    ? location.accessibility
    : (event.venue_accessibility && typeof event.venue_accessibility === 'object' ? event.venue_accessibility : {});
  const onlineAccess = event.online_access && typeof event.online_access === 'object' ? event.online_access : null;
  const publicationState = trimmed(schedule.publication_state || event.publication_status || event.publicationState || event.status).toLowerCase();
  const operationalState = trimmed(schedule.operational_state || schedule.state || event.operational_status || event.operationalStatus || event.status).toLowerCase();
  const legacyLocation = typeof event.location === 'string' ? event.location : '';

  return {
    ...event,
    start_time: schedule.start_at ?? event.start_time ?? event.startTime,
    end_time: schedule.end_at ?? event.end_time ?? event.endTime,
    timezone: trimmed(schedule.timezone || event.timezone) || 'UTC',
    all_day: schedule.all_day === true || event.all_day === true || event.allDay === true,
    location_label: trimmed(location.label ?? event.location_label ?? legacyLocation),
    location_mode: trimmed(location.mode || event.location_mode) || 'in_person',
    location_latitude: location.latitude ?? event.latitude ?? event.coordinates?.lat ?? null,
    location_longitude: location.longitude ?? event.longitude ?? event.coordinates?.lng ?? null,
    venue_accessibility: accessibility,
    organizer_name: trimmed(organizer.display_name || organizer.displayName || organizer.name),
    attendee_count: Number(metrics.confirmed_count ?? event.attendee_count ?? event.attendeeCount ?? 0) || 0,
    interested_count: Number(metrics.interested_count ?? event.interested_count ?? event.interestedCount ?? 0) || 0,
    cancellation_reason: trimmed(schedule.cancellation_reason ?? event.cancellation_reason ?? event.cancellationReason),
    is_cancelled: event.is_cancelled === true || event.isCancelled === true || operationalState === 'cancelled',
    is_archived: event.is_archived === true || event.isArchived === true || publicationState === 'archived',
    online_link: safeExternalHttpUrl(
      onlineAccess
        ? (trimmed(onlineAccess.reveal_state).toLowerCase() === 'available' ? onlineAccess.join_url : '')
        : (event.online_link ?? event.onlineLink)
    ),
    video_url: safeExternalHttpUrl(
      onlineAccess
        ? (trimmed(onlineAccess.reveal_state).toLowerCase() === 'available' ? onlineAccess.video_url : '')
        : (event.video_url ?? event.videoUrl)
    )
  };
}

function eventScheduleLabels(event, formatDate) {
  const formatter = typeof formatDate === 'function' ? formatDate : (value) => trimmed(value);
  const start = event.start_time ? new Date(event.start_time) : null;
  const end = event.end_time ? new Date(event.end_time) : null;
  const validStart = start && !Number.isNaN(start.getTime()) ? start : null;
  const validEnd = end && !Number.isNaN(end.getTime()) ? end : null;
  const common = { day: 'numeric', month: 'long', year: 'numeric', timeZone: event.timezone || 'UTC' };

  if (event.all_day) {
    const startLabel = validStart ? formatter(validStart, common) : trimmed(event.start_time);
    const inclusiveEnd = validEnd && validStart && validEnd > validStart
      ? new Date(validEnd.getTime() - 86400000)
      : null;
    const endLabel = inclusiveEnd ? formatter(inclusiveEnd, common) : '';
    return { startLabel, endLabel: endLabel && endLabel !== startLabel ? endLabel : '' };
  }

  const options = { ...common, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' };
  return {
    startLabel: validStart ? formatter(validStart, options) : trimmed(event.start_time),
    endLabel: validEnd ? formatter(validEnd, options) : trimmed(event.end_time)
  };
}

function arrayValues(value) {
  return Array.isArray(value) ? value : (value === undefined ? [] : [value]);
}

function agendaSessionPayload(body) {
  const speakerMemberIds = arrayValues(body.speaker_member_id);
  const speakerNames = arrayValues(body.speaker_name);
  const speakerRoles = arrayValues(body.speaker_role);
  const speakerCount = Math.max(speakerMemberIds.length, speakerNames.length, speakerRoles.length);
  const speakers = Array.from({ length: speakerCount }, (_, index) => {
    const userId = positiveInteger(speakerMemberIds[index]);
    const displayName = trimmed(speakerNames[index], 160);
    const roleLabel = trimmed(speakerRoles[index], 120) || null;
    if (userId !== null) return { user_id: userId, role_label: roleLabel };
    return displayName ? { display_name: displayName, role_label: roleLabel } : null;
  }).filter(Boolean);
  const resourceTypes = arrayValues(body.resource_type);
  const resourceTitles = arrayValues(body.resource_title);
  const resourceUrls = arrayValues(body.resource_url);
  const resourceVisibilities = arrayValues(body.resource_visibility);
  const resources = resourceTitles.map((title, index) => ({
    type: selectedValue(resourceTypes[index], ['link', 'document', 'slides', 'download', 'stream', 'recording'], 'link'),
    title: trimmed(title, 191),
    url: trimmed(resourceUrls[index], 2048),
    visibility: selectedValue(resourceVisibilities[index], ['public', 'registered', 'staff'], 'public')
  })).filter((resource) => resource.title || resource.url);
  return {
    title: trimmed(body.title, 255),
    description: trimmed(body.description, 4000) || null,
    session_type: selectedValue(body.session_type, ['session', 'keynote', 'workshop', 'panel', 'break', 'networking', 'other'], 'session'),
    visibility: selectedValue(body.visibility, ['public', 'registered', 'staff'], 'public'),
    start_at: trimmed(body.start_at),
    end_at: trimmed(body.end_at),
    timezone: trimmed(body.timezone, 64) || 'UTC',
    track_name: trimmed(body.track_name, 160) || null,
    room_name: trimmed(body.room_name, 160) || null,
    capacity: body.capacity === '' ? null : positiveInteger(body.capacity),
    speakers,
    resources
  };
}

function safeTimeZone(value) {
  const timezone = trimmed(value, 64) || 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date(0));
    return timezone;
  } catch {
    return 'UTC';
  }
}

function agendaDateLabel(value, timezone, formatDate) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  return formatDate(date, {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    timeZone: safeTimeZone(timezone)
  });
}

async function renderOfflineCredential(req, res, id, options = {}) {
  const token = tokenFrom(req);
  const [eventResult, credentialResult] = await Promise.all([
    callApi(token, 'GET', `/${id}`),
    options.credentialResult === undefined
      ? callApi(token, 'GET', `/${id}/offline-checkin/credentials/me`)
      : Promise.resolve(options.credentialResult)
  ]);
  const event = eventFrom(eventResult);
  const credential = offlineCredentialFrom(credentialResult);
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  return res.render('events/check-in-credential', {
    title: res.locals.t('event_offline_checkin.attendee.title'),
    activeNav: 'events',
    event: { id, title: trimmed(event.title) },
    credential,
    oneShotToken: credential?.tokenOneShot && credential.token.startsWith('nqx2_') ? credential.token : '',
    status: options.status || trimmed(req.query.status),
    idempotencyKey: randomUUID(),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}

function eventRelationship(result, event = {}) {
  const current = event.relationship && typeof event.relationship === 'object' ? event.relationship : {};
  const row = dataFrom(result);
  const projection = row && typeof row === 'object' ? row : {};
  if (Object.keys(projection).length === 0 && Object.keys(current).length === 0) return null;
  const currentRegistration = current.registration && typeof current.registration === 'object' ? current.registration : {};
  const currentEngagement = current.engagement && typeof current.engagement === 'object' ? current.engagement : {};
  const registration = projection.registration && typeof projection.registration === 'object' ? projection.registration : currentRegistration;
  const waitlist = projection.waitlist && typeof projection.waitlist === 'object' ? projection.waitlist : {};
  const actions = projection.actions && typeof projection.actions === 'object' ? projection.actions : {};
  return {
    registrationState: trimmed(registration.state),
    engagementState: trimmed(currentEngagement.state),
    waitlistState: selectedValue(waitlist.state, PEOPLE_FILTERS.waitlist_state, 'none'),
    waitlistPosition: positiveInteger(waitlist.position),
    offerActive: checked(waitlist.offer_active),
    canConfirm: checked(actions.confirm) || checked(currentRegistration.can_register),
    canWithdraw: checked(actions.withdraw) || checked(currentRegistration.can_withdraw),
    canChangeEngagement: checked(currentEngagement.can_change),
    canJoinWaitlist: checked(actions.join_waitlist),
    canLeaveWaitlist: checked(actions.leave_waitlist),
    canAcceptOffer: checked(actions.accept_offer)
  };
}

function occurrenceFrom(item, currentEventId) {
  const row = item && typeof item === 'object' ? item : {};
  const id = positiveInteger(row.id);
  if (id === null) return null;
  const startTime = row.start_time ?? row.startTime ?? row.starts_at ?? row.startsAt;
  return {
    id,
    when: dateTimeLocal(startTime).replace('T', ' '),
    current: id === currentEventId
  };
}

async function runEventAction(req, res, method, path, data, successRedirect, failureRedirect) {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  try {
    await callApi(token, method, path, data);
    return redirectTo(res, successRedirect);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, failureRedirect);
  }
}

function eventPath(id, suffix = '') {
  return `${EVENTS_PATH}/${id}${suffix}`;
}

function eventRedirect(id, status, fragment = '') {
  return `${eventPath(id)}?status=${encodeURIComponent(status)}${fragment}`;
}

router.get('/moderation', requireAuth, asyncRoute(async (req, res) => {
  moderationPrivate(res);
  const page = moderationPage(req.query.page);
  if (page === null) return redirectTo(res, '/events/moderation');

  try {
    const result = await callAdminEventApi(req.token, 'GET', `?publication_state=pending_review&page=${page}&per_page=20`);
    const meta = result?.meta || {};
    const total = Math.max(0, Number(meta.total) || 0);
    const lastPage = Math.max(1, positiveInteger(meta.last_page || meta.total_pages) || Math.ceil(total / 20) || 1);
    if (page > lastPage) {
      return redirectTo(res, lastPage > 1 ? `/events/moderation?page=${lastPage}` : '/events/moderation');
    }
    const formatDate = res.locals.formatLocaleDate;
    const items = collectionFrom(result).map((row) => {
      const event = moderationEvent(row, res.locals.t);
      return {
        ...event,
        startLabel: moderationDate(event.startAt, event.timezone, event.allDay, formatDate),
        endLabel: moderationDate(event.endAt, event.timezone, event.allDay, formatDate),
        submittedLabel: moderationDate(event.submittedAt, event.timezone, false, formatDate)
      };
    });
    return res.render('events/moderation-queue', {
      title: res.locals.t('govuk_alpha_events.moderation.title'),
      items,
      status: ['approved', 'rejected', 'action-failed'].includes(req.query.status) ? req.query.status : '',
      pagination: { page, total, hasPrevious: page > 1, hasNext: page < lastPage }
    });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && error.status === 403) return renderForbidden(res, error);
    throw error;
  }
}));

async function renderModerationDecision(req, res, decision, error = '', reason = '', status = 200) {
  moderationPrivate(res);
  try {
    const result = await callAdminEventApi(req.token, 'GET', `/${req.params.id}`);
    const event = moderationEvent(dataFrom(result), res.locals.t);
    if (!event.id || trimmed(event.publication_state) !== 'pending_review') {
      return res.status(404).render('errors/404', { title: 'Event not found' });
    }
    event.startLabel = moderationDate(event.startAt, event.timezone, event.allDay, res.locals.formatLocaleDate);
    return res.status(status).render('events/moderation-decision', {
      title: res.locals.t(`govuk_alpha_events.moderation.${decision}_title`),
      event,
      decision,
      error,
      reason,
      csrfToken: req.csrfToken ? req.csrfToken() : ''
    });
  } catch (apiError) {
    if (redirectOnAuthError(apiError, res)) return undefined;
    if (apiError instanceof ApiError && apiError.status === 403) return renderForbidden(res, apiError);
    if (apiError instanceof ApiError && apiError.status === 404) {
      return res.status(404).render('errors/404', { title: 'Event not found' });
    }
    throw apiError;
  }
}

router.get('/moderation/:id(\\d+)/approve', requireAuth, asyncRoute(async (req, res) => renderModerationDecision(req, res, 'approve')));
router.get('/moderation/:id(\\d+)/reject', requireAuth, asyncRoute(async (req, res) => renderModerationDecision(req, res, 'reject')));

router.post('/moderation/:id(\\d+)/approve', requireAuth, asyncRoute(async (req, res) => {
  if (req.body.confirmation !== 'approve') return renderModerationDecision(req, res, 'approve', 'confirmation_required', '', 422);
  try {
    await callAdminEventApi(req.token, 'POST', `/${req.params.id}/approve`);
    return redirectTo(res, '/events/moderation?status=approved');
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && error.status === 403) return renderForbidden(res, error);
    if (error instanceof ApiError && error.status === 404) return res.status(404).render('errors/404', { title: 'Event not found' });
    return redirectTo(res, '/events/moderation?status=action-failed');
  }
}));

router.post('/moderation/:id(\\d+)/reject', requireAuth, asyncRoute(async (req, res) => {
  const reason = trimmed(req.body.reason, 2001);
  const error = reason === '' ? 'reason_required'
    : (reason.length > 2000 ? 'reason_too_long' : (req.body.confirmation !== 'reject' ? 'confirmation_required' : ''));
  if (error) return renderModerationDecision(req, res, 'reject', error, reason.slice(0, 2000), 422);
  try {
    await callAdminEventApi(req.token, 'POST', `/${req.params.id}/reject`, { reason });
    return redirectTo(res, '/events/moderation?status=rejected');
  } catch (apiError) {
    if (redirectOnAuthError(apiError, res)) return undefined;
    if (apiError instanceof ApiError && apiError.status === 403) return renderForbidden(res, apiError);
    if (apiError instanceof ApiError && apiError.status === 404) return res.status(404).render('errors/404', { title: 'Event not found' });
    return redirectTo(res, '/events/moderation?status=action-failed');
  }
}));

router.get('/browse', asyncRoute(async (req, res) => {
  const categoriesResult = await getEventCategories(tokenFrom(req));
  const categories = collectionFrom(categoriesResult)
    .map(eventCategoryFrom)
    .filter(Boolean);
  const selectedCategoryId = positiveInteger(req.query.category_id);

  return res.render('events/browse', {
    title: res.locals.t('govuk_alpha_events.browse.title'),
    activeNav: 'events',
    categories,
    selectedCategoryId
  });
}));

router.get('/:id(\\d+)/map', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const result = await callApi(tokenFrom(req), 'GET', `/${id}`);
  const map = eventMapState(eventFrom(result), res.locals.t);

  res.render('events/map', {
    title: res.locals.t('govuk_alpha_events.map.title'),
    activeNav: 'events',
    map
  });
}, { notFoundTitle: 'Event not found' }));

router.get('/:id(\\d+)/people', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const token = tokenFrom(req);
  const query = eventPeopleQuery(req.query);
  const parameters = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  const [eventResult, peopleResult] = await Promise.all([
    callApi(token, 'GET', `/${id}`),
    callApi(token, 'GET', `/${id}/people?${parameters.toString()}`)
  ]);
  const event = eventFrom(eventResult);
  const meta = peopleResult?.meta && typeof peopleResult.meta === 'object' ? peopleResult.meta : {};
  const people = (Array.isArray(peopleResult?.data) ? peopleResult.data : [])
    .map(eventPerson)
    .filter((person) => person.id !== null);
  const totalPages = Math.max(0, Number.parseInt(meta.total_pages, 10) || 0);

  res.render('events/people', {
    title: res.locals.t('govuk_alpha.events.people_title'),
    activeNav: 'events',
    event: { id, title: trimmed(event.title) },
    people,
    metrics: meta.metrics && typeof meta.metrics === 'object' ? meta.metrics : {},
    canManageRegistration: meta.capabilities?.manage_registration === true,
    canManageAttendance: meta.capabilities?.manage_attendance === true,
    total: Math.max(0, Number.parseInt(meta.total, 10) || 0),
    query,
    filters: PEOPLE_FILTERS,
    status: trimmed(req.query.status),
    updated: Math.max(0, Number.parseInt(req.query.updated, 10) || 0),
    failed: Math.max(0, Number.parseInt(req.query.failed, 10) || 0),
    idempotencyKey: randomUUID(),
    csrfToken: req.csrfToken ? req.csrfToken() : '',
    previousHref: query.page > 1 ? eventPeoplePath(id, query, query.page - 1) : '',
    nextHref: query.page < totalPages ? eventPeoplePath(id, query, query.page + 1) : ''
  });
}, { notFoundTitle: 'Event not found' }));

router.get('/:id(\\d+)/check-in', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const token = tokenFrom(req);
  const query = {
    page: boundedPositiveInteger(req.query.page, 1),
    per_page: 25,
    search: trimmed(req.query.search, 255),
    attendance_state: selectedValue(req.query.attendance_state, PEOPLE_FILTERS.attendance_state),
    sort: selectedValue(req.query.sort, ['name', 'attendance'], 'name'),
    direction: selectedValue(req.query.direction, ['asc', 'desc'], 'asc')
  };
  const parameters = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  const [eventResult, peopleResult] = await Promise.all([
    callApi(token, 'GET', `/${id}`),
    callApi(token, 'GET', `/${id}/people?${parameters.toString()}`)
  ]);
  const event = eventFrom(eventResult);
  const meta = peopleResult?.meta && typeof peopleResult.meta === 'object' ? peopleResult.meta : {};
  const people = (Array.isArray(peopleResult?.data) ? peopleResult.data : [])
    .map(eventPerson)
    .filter((person) => person.id !== null);
  const totalPages = Math.max(0, Number.parseInt(meta.total_pages, 10) || 0);
  const pathForPage = (page) => {
    const pageQuery = new URLSearchParams();
    Object.entries({ ...query, page }).forEach(([key, value]) => {
      if (value !== '' && key !== 'per_page') pageQuery.set(key, String(value));
    });
    return eventPath(id, `/check-in?${pageQuery.toString()}`);
  };

  res.render('events/check-in', {
    title: res.locals.t('govuk_alpha.events.check_in_title'),
    activeNav: 'events',
    event: { id, title: trimmed(event.title) },
    people,
    metrics: meta.metrics && typeof meta.metrics === 'object' ? meta.metrics : {},
    total: Math.max(0, Number.parseInt(meta.total, 10) || 0),
    query,
    attendanceStates: PEOPLE_FILTERS.attendance_state,
    status: trimmed(req.query.status),
    csrfToken: req.csrfToken ? req.csrfToken() : '',
    previousHref: query.page > 1 ? pathForPage(query.page - 1) : '',
    nextHref: query.page < totalPages ? pathForPage(query.page + 1) : ''
  });
}, { notFoundTitle: 'Event not found' }));

router.get('/:id(\\d+)/recurring-edit', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  const [eventResult, currentUser] = await Promise.all([
    callApi(token, 'GET', `/${id}`),
    getRequestProfile(req, token)
  ]);
  const event = eventFrom(eventResult);
  const ownerId = eventOwnerId(event);
  const currentUserId = idFrom(currentUser);
  const canEdit = event.can_edit === true || event.canEdit === true;
  if (!canEdit && (ownerId === null || currentUserId === null || ownerId !== currentUserId)) {
    return res.status(403).render('errors/403', { title: 'Forbidden' });
  }
  if (!eventIsSeries(event)) {
    return redirectTo(res, eventPath(id, '/edit'));
  }

  const [categoriesResult, capabilitiesResult] = await Promise.all([
    getEventCategories(token),
    callApi(token, 'GET', '/recurrence-capabilities')
  ]);
  const categories = collectionFrom(categoriesResult).map(eventCategoryFrom).filter(Boolean);
  const timezone = trimmed(event.timezone) || 'UTC';
  const allDay = checked(event.all_day ?? event.allDay);
  const stored = consumeRecurringForm(req, id);
  const values = stored.values && typeof stored.values === 'object' ? stored.values : {};
  const hasValue = (field) => Object.prototype.hasOwnProperty.call(values, field);
  const valueOr = (field, fallback) => hasValue(field) ? values[field] : fallback;
  const statusKey = {
    invalid: 'validation_failed',
    'no-changes': 'no_changes',
    unavailable: 'unavailable',
    'concrete-required': 'concrete_required',
    'preview-failed': 'preview_failed',
    'preview-invalid': 'preview_invalid',
    'commit-failed': 'commit_failed'
  }[trimmed(req.query.status)];
  const errors = Array.isArray(stored.errors) && stored.errors.length
    ? stored.errors
    : (statusKey ? [{ text: res.locals.t(`govuk_alpha_events.recurring_edit.${statusKey}`), href: '#scope-single' }] : []);

  const occurrences = collectionFrom(event.series_occurrences ?? event.seriesOccurrences)
    .map((occurrence) => occurrenceFrom(occurrence, id))
    .filter(Boolean);

  return res.render('events/recurring-edit', {
    title: res.locals.t('govuk_alpha_events.recurring_edit.title'),
    activeNav: 'events',
    event: {
      id,
      caption: trimmed(event.title) || res.locals.t('govuk_alpha_events.recurring_edit.caption'),
      title: valueOr('title', trimmed(event.title) || res.locals.t('govuk_alpha_events.recurring_edit.caption')),
      description: valueOr('description', trimmed(event.description, 8000)),
      location: valueOr('location', trimmed(event.location)),
      categoryId: positiveInteger(valueOr('category_id', event.category_id ?? event.categoryId)),
      startTime: valueOr('start_time', dateTimeLocalInZone(event.start_time ?? event.startTime ?? event.starts_at ?? event.startsAt, timezone)),
      endTime: valueOr('end_time', dateTimeLocalInZone(event.end_time ?? event.endTime ?? event.ends_at ?? event.endsAt, timezone, allDay)),
      timezone,
      allDay,
      isOnline: checked(valueOr('is_online', event.is_online ?? event.isOnline)),
      onlineLink: valueOr('online_link', trimmed(event.online_link ?? event.onlineLink)),
      allowRemoteAttendance: checked(valueOr('allow_remote_attendance', event.allow_remote_attendance ?? event.allowRemoteAttendance)),
      videoUrl: valueOr('video_url', trimmed(event.video_url ?? event.videoUrl)),
      maxAttendees: positiveInteger(valueOr('max_attendees', event.max_attendees ?? event.maxAttendees)),
      accessibility: {
        stepFree: valueOr('accessibility_step_free', triState(event.accessibility_step_free)),
        toilet: valueOr('accessibility_toilet', triState(event.accessibility_toilet)),
        hearingLoop: valueOr('accessibility_hearing_loop', triState(event.accessibility_hearing_loop)),
        quietSpace: valueOr('accessibility_quiet_space', triState(event.accessibility_quiet_space)),
        seating: valueOr('accessibility_seating', triState(event.accessibility_seating)),
        parking: valueOr('accessibility_parking', triState(event.accessibility_parking)),
        parkingDetails: valueOr('accessibility_parking_details', trimmed(event.accessibility_parking_details)),
        transitDetails: valueOr('accessibility_transit_details', trimmed(event.accessibility_transit_details)),
        assistanceContact: valueOr('accessibility_assistance_contact', trimmed(event.accessibility_assistance_contact)),
        notes: valueOr('accessibility_notes', trimmed(event.accessibility_notes))
      }
    },
    categories,
    supportsEffectiveRevisions: supportsEffectiveRevisions(capabilitiesResult),
    selectedScope: trimmed(values.scope) === 'all' ? 'all' : 'single',
    errors,
    fieldErrors: fieldErrorsFrom(errors),
    occurrences,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { notFoundTitle: 'Event not found' }));

router.get('/:id(\\d+)/polls', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  const [eventResult, pollsResult, currentUser] = await Promise.all([
    callApi(token, 'GET', `/${id}`),
    getPolls(token, { mine: true, limit: 100 }),
    getRequestProfile(req, token)
  ]);
  const event = eventFrom(eventResult);
  const ownerId = eventOwnerId(event);
  const currentUserId = idFrom(currentUser);
  const canEdit = event.can_edit === true || event.canEdit === true;
  if (!canEdit && (ownerId === null || currentUserId === null || ownerId !== currentUserId)) {
    return res.status(403).render('errors/403', { title: 'Forbidden' });
  }
  const polls = collectionFrom(pollsResult)
    .map((poll) => eventPollFrom(poll, id))
    .filter(Boolean);

  res.render('events/polls', {
    title: res.locals.t('govuk_alpha_events.polls.title'),
    activeNav: 'events',
    event: {
      id,
      title: trimmed(event.title) || res.locals.t('govuk_alpha_events.polls.caption')
    },
    polls,
    status: trimmed(req.query.status),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { notFoundTitle: 'Event not found' }));

router.get('/:id(\\d+)/translate', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  const event = eventFrom(await callApi(token, 'GET', `/${id}`));
  const sourceText = trimmed(event.description, 8000);
  const translation = req.session && req.session.eventTranslation && req.session.eventTranslation.eventId === id
    ? req.session.eventTranslation
    : null;
  if (translation && req.session) delete req.session.eventTranslation;
  const targetLocale = trimmed(req.query.target_locale || translation?.targetLocale || req.query.locale) || '';

  res.render('events/translate', {
    title: res.locals.t('govuk_alpha_events.translate.title'),
    activeNav: 'events',
    event: {
      id,
      title: trimmed(event.title) || res.locals.t('govuk_alpha_events.translate.caption')
    },
    sourceText,
    translated: translation?.text || null,
    languages: localeOptions.map(([code, name]) => ({ code, name, selected: code === targetLocale })),
    status: trimmed(req.query.status),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { notFoundTitle: 'Event not found' }));

function eventScopedPayload(body) {
  const categoryId = positiveInteger(body.category_id);
  const maxAttendees = positiveInteger(body.max_attendees);
  const payload = {
    title: trimmed(body.title),
    description: trimmed(body.description),
    start_time: trimmed(body.start_time) || null,
    end_time: trimmed(body.end_time) || null,
    location: trimmed(body.location) || null,
    category_id: categoryId,
    max_attendees: maxAttendees === null ? null : Math.max(1, maxAttendees),
    is_online: checked(body.is_online),
    online_link: trimmed(body.online_link) || null,
    allow_remote_attendance: checked(body.allow_remote_attendance),
    video_url: trimmed(body.video_url) || null
  };
  if (Object.prototype.hasOwnProperty.call(body, 'group_id')) {
    payload.group_id = positiveInteger(body.group_id);
  }
  for (const field of [
    'accessibility_step_free', 'accessibility_toilet', 'accessibility_hearing_loop',
    'accessibility_quiet_space', 'accessibility_seating', 'accessibility_parking'
  ]) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      payload[field] = trimmed(body[field]) === 'yes' ? true : (trimmed(body[field]) === 'no' ? false : null);
    }
  }
  for (const field of [
    'accessibility_parking_details', 'accessibility_transit_details',
    'accessibility_assistance_contact', 'accessibility_notes'
  ]) {
    if (Object.prototype.hasOwnProperty.call(body, field)) payload[field] = trimmed(body[field]) || null;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'timezone')) payload.timezone = trimmed(body.timezone) || 'UTC';
  if (Object.prototype.hasOwnProperty.call(body, 'all_day')) payload.all_day = checked(body.all_day);
  return payload;
}

const RECURRING_REVISION_FIELDS = [
  'accessibility_assistance_contact', 'accessibility_hearing_loop', 'accessibility_notes',
  'accessibility_parking', 'accessibility_parking_details', 'accessibility_quiet_space',
  'accessibility_seating', 'accessibility_step_free', 'accessibility_toilet',
  'accessibility_transit_details', 'allow_remote_attendance', 'category_id', 'description',
  'is_online', 'latitude', 'local_end_time', 'local_start_time', 'location', 'longitude',
  'max_attendees', 'online_link', 'title', 'video_url'
];

function supportsEffectiveRevisions(result) {
  return (dataFrom(result) || {}).supports_effective_revisions === true;
}

function recurringRevisionPatch(body, event) {
  const submitted = eventScopedPayload(body);
  const patch = {};
  const nullableIntegerFields = ['category_id', 'max_attendees'];
  const booleanFields = ['is_online', 'allow_remote_attendance'];
  const nullableTextFields = [
    'location', 'online_link', 'video_url', 'accessibility_parking_details',
    'accessibility_transit_details', 'accessibility_assistance_contact', 'accessibility_notes'
  ];
  const triStateFields = [
    'accessibility_step_free', 'accessibility_toilet', 'accessibility_hearing_loop',
    'accessibility_quiet_space', 'accessibility_seating', 'accessibility_parking'
  ];

  for (const field of ['title', 'description']) {
    if (submitted[field] !== trimmed(event[field])) patch[field] = submitted[field];
  }
  for (const field of nullableIntegerFields) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const current = positiveInteger(event[field]);
    if (submitted[field] !== current) patch[field] = submitted[field];
  }
  for (const field of booleanFields) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    if (submitted[field] !== checked(event[field])) patch[field] = submitted[field];
  }
  for (const field of nullableTextFields) {
    if (!Object.prototype.hasOwnProperty.call(body, field) && field.startsWith('accessibility_')) continue;
    const current = trimmed(event[field]) || null;
    if (submitted[field] !== current) patch[field] = submitted[field];
  }
  for (const field of triStateFields) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    const current = event[field] === true || event[field] === 1
      ? true
      : (event[field] === false || event[field] === 0 ? false : null);
    if (submitted[field] !== current) patch[field] = submitted[field];
  }

  const timezone = trimmed(event.timezone) || 'UTC';
  if ((trimmed(body.timezone) || 'UTC') !== timezone || checked(body.all_day) !== checked(event.all_day)) {
    return null;
  }
  const currentStart = dateTimeLocalInZone(event.start_time ?? event.startTime, timezone);
  const submittedStart = trimmed(body.start_time);
  if (!submittedStart || submittedStart.slice(0, 10) !== currentStart.slice(0, 10)) return null;
  if (!checked(event.all_day) && submittedStart.slice(11, 16) !== currentStart.slice(11, 16)) {
    patch.local_start_time = submittedStart.slice(11, 16);
  }
  const currentEnd = dateTimeLocalInZone(event.end_time ?? event.endTime, timezone, checked(event.all_day));
  const submittedEnd = trimmed(body.end_time);
  if (checked(event.all_day)) {
    if (submittedEnd !== currentEnd) return null;
  } else if (!submittedEnd) {
    if (currentEnd) patch.local_end_time = null;
  } else {
    const expectedDate = currentEnd ? currentEnd.slice(0, 10) : currentStart.slice(0, 10);
    if (submittedEnd.slice(0, 10) !== expectedDate) return null;
    if (!currentEnd || submittedEnd.slice(11, 16) !== currentEnd.slice(11, 16)) {
      patch.local_end_time = submittedEnd.slice(11, 16);
    }
  }
  return Object.fromEntries(Object.entries(patch).sort(([left], [right]) => left.localeCompare(right)));
}

function recurrencePayload(body) {
  const frequency = ['daily', 'weekly', 'monthly'].includes(trimmed(body.recurrence_frequency))
    ? trimmed(body.recurrence_frequency)
    : 'weekly';
  const endsType = trimmed(body.recurrence_ends_type) === 'on_date' ? 'on_date' : 'after_count';

  return {
    recurrence_frequency: frequency,
    recurrence_interval: boundedPositiveInteger(body.recurrence_interval, 1),
    recurrence_ends_type: endsType,
    recurrence_ends_after_count: boundedPositiveInteger(body.recurrence_ends_after_count, 10, 52),
    recurrence_ends_on_date: trimmed(body.recurrence_ends_on_date) || null
  };
}

function pollIdsFrom(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  const unique = new Set();
  values.forEach((item) => {
    const id = positiveInteger(item);
    if (id !== null) {
      unique.add(id);
    }
  });
  return Array.from(unique);
}

router.post('/:id(\\d+)/people', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const action = selectedValue(req.body.action, ['approve', 'reject', 'cancel']);
  const userIds = pollIdsFrom(req.body.user_ids).slice(0, 101);
  const reason = trimmed(req.body.reason, 1000);
  const confirmed = checked(req.body.confirmation);
  if (!action || userIds.length === 0 || userIds.length > 100 || !confirmed
    || (['reject', 'cancel'].includes(action) && !reason)) {
    return redirectTo(res, eventPath(id, '/people?status=people-invalid'));
  }

  const requestKey = trimmed(req.body.idempotency_key, 128) || randomUUID();
  const operations = userIds.map((userId) => ({
    user_id: userId,
    action,
    expected_version: Math.max(0, Number.parseInt(req.body[`version_${userId}`], 10) || 0),
    idempotency_key: `accessible-people:${requestKey}:${action}:${userId}`,
    reason: reason || null
  }));

  try {
    const result = dataFrom(await callApi(tokenFrom(req), 'POST', `/${id}/people/bulk`, { operations })) || {};
    const updated = Math.max(0, Number.parseInt(result.succeeded, 10) || 0);
    const failed = Math.max(0, Number.parseInt(result.failed, 10) || 0);
    const status = failed > 0 ? 'people-partial' : 'people-updated';
    return redirectTo(res, eventPath(id, `/people?status=${status}&updated=${updated}&failed=${failed}`));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && [400, 403, 404, 409, 422].includes(error.status)) {
      return redirectTo(res, eventPath(id, '/people?status=people-failed'));
    }
    throw error;
  }
}));

router.post('/:id(\\d+)/check-in/:userId(\\d+)', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const userId = Number(req.params.userId);
  const action = selectedValue(req.body.action, ['check_in', 'check_out', 'no_show', 'undo']);
  const expectedVersion = Number.parseInt(req.body.expected_version, 10);
  const reason = trimmed(req.body.reason, 4000);
  if (!action || !Number.isInteger(expectedVersion) || expectedVersion < 0 || !checked(req.body.confirmation)
    || (action === 'undo' && !reason)) {
    return redirectTo(res, eventPath(id, '/check-in?status=attendance-invalid'));
  }

  try {
    await callApi(tokenFrom(req), 'POST', `/${id}/people/${userId}/attendance`, {
      action,
      expected_version: expectedVersion,
      reason: reason || null,
      idempotency_key: trimmed(req.body.idempotency_key, 191) || randomUUID()
    });
    return redirectTo(res, eventPath(id, '/check-in?status=attendance-updated'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && error.status === 409) {
      return redirectTo(res, eventPath(id, '/check-in?status=attendance-conflict'));
    }
    if (error instanceof ApiError && [400, 403, 404, 422].includes(error.status)) {
      return redirectTo(res, eventPath(id, '/check-in?status=attendance-failed'));
    }
    throw error;
  }
}));

router.post('/:id(\\d+)/waitlist', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());
  try {
    await callEventMutation(token, 'POST', `/${id}/registration/waitlist`, undefined, randomUUID());
    return redirectTo(res, eventRedirect(id, 'waitlist-joined'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    const code = apiErrorCode(error);
    const failureStatus = code === 'SAFEGUARDING_POLICY_UNAVAILABLE'
      ? 'waitlist-policy-unavailable'
      : ((code.startsWith('SAFEGUARDING_') || code === 'VETTING_REQUIRED')
        ? 'waitlist-vetting-required'
        : 'waitlist-failed');
    return redirectTo(res, eventRedirect(id, failureStatus));
  }
}));

router.post('/:id(\\d+)/waitlist/leave', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runCanonicalEventAction(
    req,
    res,
    `/${id}/registration/waitlist/leave`,
    eventRedirect(id, 'waitlist-left'),
    eventRedirect(id, 'waitlist-left')
  );
}));

const RECURRENCE_BLUEPRINT_SECTIONS = ['agenda', 'ticket_types', 'registration', 'safety', 'staff'];
const RECURRENCE_BLUEPRINT_COUNTS = [
  'sessions', 'speakers', 'resources', 'ticket_types',
  'registration_settings', 'published_forms', 'form_questions',
  'safety_requirements', 'staff_assignments'
];

function recurrenceBlueprintContext(result) {
  const event = eventFrom(result);
  const permissions = event.permissions && typeof event.permissions === 'object' ? event.permissions : {};
  const recurrence = event.series?.recurrence || event.recurrence || {};
  const recurrenceId = trimmed(recurrence.recurrence_id || recurrence.recurrenceId, 32);
  const allowedSections = {
    agenda: permissions.manage_agenda === true,
    ticket_types: permissions.manage_finance === true,
    registration: permissions.manage_registration === true,
    safety: permissions.edit === true,
    staff: permissions.manage_staff === true
  };
  return { event, recurrenceId, allowedSections };
}

function recurrenceDefinitionCandidate(event) {
  const context = recurrenceBlueprintContext(event);
  const recurrence = event?.series?.recurrence || event?.recurrence || {};
  return Object.values(context.allowedSections).some(Boolean)
    && recurrence.is_template !== true
    && positiveInteger(recurrence.parent_event_id ?? recurrence.parentEventId) !== null
    && /^\d{8}T\d{6}Z$/.test(context.recurrenceId)
    && trimmed(recurrence.engine) === 'sabre-vobject'
    && trimmed(recurrence.engine_version ?? recurrence.engineVersion) === '2';
}

function recurrenceCapabilitiesAllowDefinitions(result) {
  const capabilities = dataFrom(result) || {};
  return capabilities.engine === 'v2'
    && capabilities.schema_ready === true
    && capabilities.supports_definition_blueprints === true
    && capabilities.rollout_state === 'v2_rolling';
}

function recurrenceBlueprintSections(body, allowed) {
  const raw = body.sections;
  const values = Array.isArray(raw) ? raw : (typeof raw === 'string' ? [raw] : []);
  const unique = [...new Set(values.map((value) => trimmed(value)).filter(Boolean))];
  if (!unique.length || unique.some((value) => !RECURRENCE_BLUEPRINT_SECTIONS.includes(value) || allowed[value] !== true)) return null;
  return Object.fromEntries(RECURRENCE_BLUEPRINT_SECTIONS.map((section) => [section, unique.includes(section)]));
}

async function recurrenceBlueprintState(token, id, beforeVersion = null) {
  const suffix = beforeVersion ? `?limit=10&before_version=${beforeVersion}` : '?limit=10';
  const eventResult = await callApi(token, 'GET', `/${id}`);
  let history = { items: [], next_before_version: null };
  let historyError = false;
  try {
    const historyResult = await callApi(token, 'GET', `/${id}/recurrence-definition-blueprints${suffix}`);
    history = dataFrom(historyResult) || history;
  } catch (error) {
    if (error instanceof ApiError && [401, 403, 404].includes(error.status)) throw error;
    historyError = true;
  }
  const context = recurrenceBlueprintContext(eventResult);
  return { ...context, history, historyError };
}

function renderRecurrenceBlueprints(req, res, state, extras = {}) {
  const formatDate = typeof res.locals.formatLocaleDate === 'function'
    ? res.locals.formatLocaleDate
    : (value) => trimmed(value);
  const formatNumber = typeof res.locals.formatLocaleNumber === 'function'
    ? res.locals.formatLocaleNumber
    : (value) => String(Number(value) || 0);
  const historyItems = Array.isArray(state.history?.items) ? state.history.items.map((item) => {
    const recordedAt = new Date(item?.created_at);
    return {
      ...item,
      recordedAtLabel: item?.created_at && !Number.isNaN(recordedAt.getTime())
        ? formatDate(recordedAt, {
          day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC'
        })
        : res.locals.t('event_recurrence_blueprints.time_unknown'),
      selectedSectionKeys: RECURRENCE_BLUEPRINT_SECTIONS.filter((section) => item?.selected_sections?.[section] === true),
      countItems: RECURRENCE_BLUEPRINT_COUNTS
        .filter((key) => Number.isInteger(item?.counts?.[key]) && item.counts[key] > 0)
        .map((key) => ({ key, value: formatNumber(item.counts[key]) }))
    };
  }) : [];
  const history = { ...(state.history || {}), items: historyItems };
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  res.set('Referrer-Policy', 'no-referrer');
  return res.render('events/recurrence-blueprints', { title: res.locals.t('event_recurrence_blueprints.title'), activeNav: 'events', event: state.event, recurrenceId: state.recurrenceId, allowedSections: state.allowedSections, history, historyError: state.historyError === true, selectedSections: state.allowedSections, preview: null, idempotencyKey: randomUUID(), csrfToken: req.csrfToken ? req.csrfToken() : '', status: trimmed(req.query.status), statusVersion: positiveInteger(req.query.version), ...extras });
}

router.get('/:id(\\d+)/recurrence-definition-blueprints', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id); const beforeVersion = positiveInteger(req.query.before_version);
  if (req.query.before_version && !beforeVersion) return redirectTo(res, eventPath(id, '/recurrence-definition-blueprints?status=invalid'));
  const state = await recurrenceBlueprintState(tokenFrom(req), id, beforeVersion);
  return renderRecurrenceBlueprints(req, res, state);
}, { notFoundTitle: 'Event not found' }));

router.post('/:id(\\d+)/recurrence-definition-blueprints/preview', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id); const token = tokenFrom(req);
  try {
    const state = await recurrenceBlueprintState(token, id);
    const sections = recurrenceBlueprintSections(req.body, state.allowedSections);
    if (!sections || !/^\d{8}T\d{6}Z$/.test(state.recurrenceId)) return redirectTo(res, eventPath(id, '/recurrence-definition-blueprints?status=invalid'));
    const result = dataFrom(await callApi(token, 'POST', `/${id}/recurrence-definition-blueprints/preview`, { effective_from_recurrence_id: state.recurrenceId, sections })) || {};
    return renderRecurrenceBlueprints(req, res, state, { preview: result, selectedSections: sections, status: null });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && [400, 403, 404, 409, 422, 429, 503].includes(error.status)) return redirectTo(res, eventPath(id, '/recurrence-definition-blueprints?status=failed'));
    throw error;
  }
}));

router.post('/:id(\\d+)/recurrence-definition-blueprints/commit', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id); const token = tokenFrom(req); const key = trimmed(req.body.idempotency_key, 191); const previewToken = trimmed(req.body.preview_token, 8192);
  try {
    const eventResult = await callApi(token, 'GET', `/${id}`); const context = recurrenceBlueprintContext(eventResult); const sections = recurrenceBlueprintSections(req.body, context.allowedSections);
    if (!checked(req.body.confirm_definition_version) || !key || !previewToken || !sections || !/^\d{8}T\d{6}Z$/.test(context.recurrenceId)) return redirectTo(res, eventPath(id, '/recurrence-definition-blueprints?status=invalid'));
    const result = dataFrom(await callEventMutation(token, 'POST', `/${id}/recurrence-definition-blueprints/commit`, { effective_from_recurrence_id: context.recurrenceId, sections, preview_token: previewToken }, key)) || {};
    const status = result.idempotent_replay ? 'replayed' : 'created'; const version = positiveInteger(result.blueprint_version);
    return redirectTo(res, eventPath(id, `/recurrence-definition-blueprints?status=${status}${version ? `&version=${version}` : ''}`));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && [400, 403, 404, 409, 422, 429, 503].includes(error.status)) return redirectTo(res, eventPath(id, '/recurrence-definition-blueprints?status=failed'));
    throw error;
  }
}));

async function transitionEventPublication(req, res, action) {
  const id = Number(req.params.id);
  try {
    if (action === 'submit') {
      await callApi(tokenFrom(req), 'POST', `/${id}/submit`);
    } else {
      await callApi(tokenFrom(req), 'POST', `/${id}/publish`);
    }
    return redirectTo(res, eventPath(id, `?status=${action === 'submit' ? 'event-submitted' : 'event-published'}`));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && [400, 403, 404, 409, 422, 429, 503].includes(error.status)) return redirectTo(res, eventPath(id, '?status=event-publication-failed'));
    throw error;
  }
}

async function runCanonicalEventAction(req, res, path, successRedirect, failureRedirect) {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());
  try {
    await callEventMutation(token, 'POST', path, undefined, randomUUID());
    return redirectTo(res, successRedirect);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, failureRedirect);
  }
}

router.post('/:id(\\d+)/submit', requireAuth, asyncRoute(async (req, res) => transitionEventPublication(req, res, 'submit')));
router.post('/:id(\\d+)/publish', requireAuth, asyncRoute(async (req, res) => transitionEventPublication(req, res, 'publish')));

router.get('/templates', requireAuth, asyncRoute(async (req, res) => {
  const filter = selectedValue(req.query.filter, ['active', 'archived', 'all'], 'active'); const cursor = trimmed(req.query.cursor, 4096); const query = new URLSearchParams({ status: filter, per_page: '20' }); if (cursor) query.set('cursor', cursor);
  const result = await callEventTemplateApi(tokenFrom(req), 'GET', `?${query}`);
  const meta = result?.meta || {};
  res.set('Cache-Control', 'private, no-store');
  return res.render('events/templates', { title: res.locals.t('event_templates.title'), activeNav: 'events', templates: collectionFrom(result), pagination: { ...meta, next_cursor: trimmed(meta.next_cursor, 4096) }, filter, cursor, status: trimmed(req.query.status), csrfToken: req.csrfToken ? req.csrfToken() : '' });
}));

router.get('/:id(\\d+)/template-preview', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id); const templateId = positiveInteger(req.query.template_id); const token = tokenFrom(req);
  const [eventResult, previewResult, templateResult] = await Promise.all([callApi(token, 'GET', `/${id}`), callApi(token, 'POST', `/${id}/template-preview`), templateId ? callEventTemplateApi(token, 'GET', `/${templateId}`) : Promise.resolve(null)]);
  res.set('Cache-Control', 'private, no-store');
  return res.render('events/template-capture-preview', { title: res.locals.t('event_templates.capture_preview_title'), activeNav: 'events', event: eventFrom(eventResult), preview: dataFrom(previewResult) || {}, template: dataFrom(templateResult), status: trimmed(req.query.status), idempotencyKey: randomUUID(), csrfToken: req.csrfToken ? req.csrfToken() : '' });
}, { notFoundTitle: 'Event not found' }));

router.post('/:id(\\d+)/templates', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id); const templateId = positiveInteger(req.body.template_id); const expectedVersion = positiveInteger(req.body.expected_version); const key = trimmed(req.body.idempotency_key, 191);
  if (!key || (templateId && !expectedVersion)) return redirectTo(res, eventPath(id, `/template-preview${templateId ? `?template_id=${templateId}&status=invalid` : '?status=invalid'}`));
  try {
    if (templateId) await callEventTemplateApi(tokenFrom(req), 'POST', `/${templateId}/revisions`, { expected_version: expectedVersion }, { headers: { 'Idempotency-Key': key } });
    else await callEventMutation(tokenFrom(req), 'POST', `/${id}/templates`, {}, key);
    return redirectTo(res, `/events/templates?status=${templateId ? 'revised' : 'captured'}`);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && [400, 403, 404, 409, 422, 429, 503].includes(error.status)) return redirectTo(res, eventPath(id, `/template-preview?status=failed${templateId ? `&template_id=${templateId}` : ''}`));
    throw error;
  }
}));

router.get('/:id(\\d+)/check-in/credential', requireAuth, asyncRoute(async (req, res) => {
  return renderOfflineCredential(req, res, Number(req.params.id));
}, { notFoundTitle: 'Event not found' }));

router.post('/:id(\\d+)/check-in/credential/issue', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const idempotencyKey = trimmed(req.body.idempotency_key, 191);
  if (!checked(req.body.confirmation) || idempotencyKey.length < 8) {
    return redirectTo(res, eventPath(id, '/check-in/credential?status=invalid'));
  }
  try {
    const result = await callApi(tokenFrom(req), 'POST', `/${id}/offline-checkin/credentials`, {
      idempotency_key: idempotencyKey
    });
    const credential = offlineCredentialFrom(result);
    return renderOfflineCredential(req, res, id, {
      credentialResult: result,
      status: credential?.tokenOneShot ? 'issued' : 'already-active'
    });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && [400, 403, 404, 409, 422].includes(error.status)) {
      return redirectTo(res, eventPath(id, '/check-in/credential?status=failed'));
    }
    throw error;
  }
}));

router.get('/:id(\\d+)/safety', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const token = tokenFrom(req);
  const [eventResult, safetyResult] = await Promise.all([
    callApi(token, 'GET', `/${id}`),
    callApi(token, 'GET', `/${id}/safety`)
  ]);
  const event = eventFrom(eventResult);
  const safety = dataFrom(safetyResult) || {};
  const canReview = safety.permissions?.review_participation === true;
  let reviews = { items: [], total: 0, page: 1, per_page: 25 };
  let people = [];
  if (canReview) {
    const page = boundedPositiveInteger(req.query.page, 1);
    const [reviewsResult, peopleResult] = await Promise.all([
      callApi(token, 'GET', `/${id}/safety/reviews?page=${page}&per_page=25`),
      callApi(token, 'GET', `/${id}/people?page=1&per_page=100&sort=name&direction=asc`)
    ]);
    reviews = dataFrom(reviewsResult) || reviews;
    people = (Array.isArray(peopleResult?.data) ? peopleResult.data : [])
      .map(eventPerson)
      .filter((person) => person.id !== null);
  }
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  return res.render('events/safety', {
    title: res.locals.t('event_safety.govuk.title'),
    activeNav: 'events',
    event: { id, title: trimmed(event.title) },
    safety,
    reviews,
    people,
    status: trimmed(req.query.status),
    today: new Date().toISOString().slice(0, 10),
    idempotencyKey: randomUUID(),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { notFoundTitle: 'Event not found' }));

router.post('/:id(\\d+)/safety', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const action = selectedValue(req.body.action, [
    'save_requirements', 'publish_requirements', 'archive_requirements',
    'acknowledge_code', 'withdraw_code', 'request_guardian_consent',
    'withdraw_guardian_consent', 'record_review', 'withdraw_review'
  ]);
  const idempotencyKey = trimmed(req.body.idempotency_key, 191);
  const destructive = ['archive_requirements', 'withdraw_code', 'withdraw_guardian_consent', 'withdraw_review'].includes(action);
  if (!action || idempotencyKey.length < 8 || (destructive && !checked(req.body.confirm_destructive))) {
    return redirectTo(res, eventPath(id, '/safety?status=safety-failed'));
  }

  let path;
  let payload = {};
  let safetySubjectId = null;
  const expectedRevision = req.body.expected_revision === '' ? null : Number.parseInt(req.body.expected_revision, 10);
  const expectedVersion = Number.parseInt(req.body.expected_version, 10);
  if (action === 'save_requirements') {
    path = `/${id}/safety/requirements`;
    payload = {
      minimum_age: req.body.minimum_age === '' ? null : Number.parseInt(req.body.minimum_age, 10),
      guardian_consent_required: checked(req.body.guardian_consent_required),
      minor_age_threshold: req.body.minor_age_threshold === '' ? null : Number.parseInt(req.body.minor_age_threshold, 10),
      code_of_conduct_required: checked(req.body.code_of_conduct_required),
      code_of_conduct_text: trimmed(req.body.code_of_conduct_text, 20000),
      code_of_conduct_text_version: trimmed(req.body.code_of_conduct_text_version, 191),
      expected_revision: expectedRevision
    };
  } else if (action === 'publish_requirements' || action === 'archive_requirements') {
    path = `/${id}/safety/requirements/${action === 'publish_requirements' ? 'publish' : 'archive'}`;
    payload = { expected_revision: expectedRevision, expected_version: expectedVersion };
  } else if (action === 'acknowledge_code') {
    path = `/${id}/safety/code-of-conduct/acknowledgements`;
    payload = { text_version: trimmed(req.body.text_version, 191), text_hash: trimmed(req.body.text_hash, 191) };
  } else if (action === 'withdraw_code') {
    safetySubjectId = positiveInteger(req.body.acknowledgement_id) || 0;
    path = `/${id}/safety/code-of-conduct/acknowledgements/${safetySubjectId}`;
  } else if (action === 'request_guardian_consent') {
    path = `/${id}/safety/guardian-consents`;
    payload = {
      guardian_name: trimmed(req.body.guardian_name, 160),
      guardian_email: trimmed(req.body.guardian_email, 320),
      relationship_code: selectedValue(req.body.relationship_code, ['parent', 'guardian', 'legal_guardian', 'carer']),
      preferred_language: req.locale || 'en'
    };
  } else if (action === 'withdraw_guardian_consent') {
    safetySubjectId = positiveInteger(req.body.consent_id) || 0;
    path = `/${id}/safety/guardian-consents/${safetySubjectId}`;
  } else if (action === 'record_review') {
    path = `/${id}/safety/reviews`;
    payload = {
      user_id: positiveInteger(req.body.user_id),
      decision: selectedValue(req.body.decision, ['deny', 'remove']),
      reason_code: selectedValue(req.body.reason_code, ['safeguarding_policy', 'minimum_age', 'guardian_consent', 'code_of_conduct', 'conduct_violation', 'safety_review', 'user_block']),
      effective_from: trimmed(req.body.effective_from),
      effective_until: trimmed(req.body.effective_until) || null,
      expected_version: req.body.expected_version === '' ? null : Number.parseInt(req.body.expected_version, 10)
    };
  } else {
    safetySubjectId = positiveInteger(req.body.denial_id) || 0;
    path = `/${id}/safety/reviews/${safetySubjectId}`;
    payload = { expected_version: expectedVersion };
  }

  const invalidNumber = [payload.minimum_age, payload.minor_age_threshold, payload.expected_revision, payload.expected_version]
    .some((value) => value !== undefined && value !== null && (!Number.isInteger(value) || value < 0));
  const invalidPayload = invalidNumber
    || (action === 'request_guardian_consent' && (!payload.guardian_name || !payload.guardian_email || !payload.relationship_code))
    || (action === 'record_review' && (!payload.user_id || !payload.decision || !payload.reason_code || !payload.effective_from));
  if (invalidPayload || path.includes('/0')) {
    return redirectTo(res, eventPath(id, '/safety?status=safety-failed'));
  }
  try {
    const token = tokenFrom(req);
    switch (action) {
      case 'save_requirements':
        await callEventMutation(token, 'PUT', `/${id}/safety/requirements`, payload, idempotencyKey);
        break;
      case 'publish_requirements':
        await callEventMutation(token, 'POST', `/${id}/safety/requirements/publish`, payload, idempotencyKey);
        break;
      case 'archive_requirements':
        await callEventMutation(token, 'POST', `/${id}/safety/requirements/archive`, payload, idempotencyKey);
        break;
      case 'acknowledge_code':
        await callEventMutation(token, 'POST', `/${id}/safety/code-of-conduct/acknowledgements`, payload, idempotencyKey);
        break;
      case 'withdraw_code':
        await callEventMutation(token, 'DELETE', `/${id}/safety/code-of-conduct/acknowledgements/${safetySubjectId}`, payload, idempotencyKey);
        break;
      case 'request_guardian_consent':
        await callEventMutation(token, 'POST', `/${id}/safety/guardian-consents`, payload, idempotencyKey);
        break;
      case 'withdraw_guardian_consent':
        await callEventMutation(token, 'DELETE', `/${id}/safety/guardian-consents/${safetySubjectId}`, payload, idempotencyKey);
        break;
      case 'record_review':
        await callEventMutation(token, 'POST', `/${id}/safety/reviews`, payload, idempotencyKey);
        break;
      case 'withdraw_review':
        await callEventMutation(token, 'DELETE', `/${id}/safety/reviews/${safetySubjectId}`, payload, idempotencyKey);
        break;
      default:
        return redirectTo(res, eventPath(id, '/safety?status=safety-failed'));
    }
    return redirectTo(res, eventPath(id, '/safety?status=safety-updated'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && [400, 403, 404, 409, 422, 429].includes(error.status)) {
      return redirectTo(res, eventPath(id, '/safety?status=safety-failed'));
    }
    throw error;
  }
}));

router.get('/:id(\\d+)/agenda', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const token = tokenFrom(req);
  const [eventResult, agendaResult] = await Promise.all([
    callApi(token, 'GET', `/${id}`),
    callApi(token, 'GET', `/${id}/agenda?include_cancelled=true`)
  ]);
  const event = eventFrom(eventResult);
  const agenda = dataFrom(agendaResult) || {};
  const timezone = safeTimeZone(agenda.timezone);
  const formatDate = typeof res.locals.formatLocaleDate === 'function'
    ? res.locals.formatLocaleDate
    : (value) => trimmed(value);
  const sessions = (Array.isArray(agenda.sessions) ? agenda.sessions : []).map((session) => {
    const speakers = Array.isArray(session.speakers) ? session.speakers : [];
    const resources = Array.isArray(session.resources) ? session.resources : [];
    return {
      ...session,
      speakers,
      resources,
      speakerRows: [...speakers, ...Array.from({ length: Math.max(0, 5 - speakers.length) }, () => ({}))],
      resourceRows: [...resources, ...Array.from({ length: Math.max(0, 3 - resources.length) }, () => ({}))],
      start_at_local: dateTimeLocalInZone(session.start_at, timezone),
      end_at_local: dateTimeLocalInZone(session.end_at, timezone),
      startLabel: agendaDateLabel(session.start_at, timezone, formatDate),
      endLabel: agendaDateLabel(session.end_at, timezone, formatDate)
    };
  });
  const eventStart = event.start_at || event.start_time || event.start_date;
  const eventEnd = event.end_at || event.end_time || event.end_date;
  const startDate = new Date(eventStart);
  const endDate = new Date(eventEnd);
  const defaultEnd = !Number.isNaN(startDate.getTime())
    ? new Date(Math.min(
      startDate.getTime() + (60 * 60 * 1000),
      Number.isNaN(endDate.getTime()) ? Number.POSITIVE_INFINITY : endDate.getTime()
    ))
    : null;
  const createSessionDefaults = {
    type: 'session',
    visibility: 'public',
    start_at_local: dateTimeLocalInZone(startDate, timezone),
    end_at_local: defaultEnd ? dateTimeLocalInZone(defaultEnd, timezone) : '',
    speakers: [],
    resources: [],
    speakerRows: Array.from({ length: 5 }, () => ({})),
    resourceRows: Array.from({ length: 3 }, () => ({}))
  };
  agenda.timezone = timezone;
  agenda.sessions = sessions;
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  return res.render('events/agenda', {
    title: res.locals.t('govuk_alpha.events.agenda.title'),
    activeNav: 'events',
    event: { id, title: trimmed(event.title) },
    agenda,
    createSessionDefaults,
    scheduledSessions: sessions.filter((session) => session.status === 'scheduled'),
    cancelledSessions: sessions.filter((session) => session.status === 'cancelled'),
    status: trimmed(req.query.status),
    idempotencyKey: randomUUID(),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { notFoundTitle: 'Event not found' }));

router.post('/:id(\\d+)/agenda', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const action = selectedValue(req.body.action, ['create', 'update', 'cancel', 'move_up', 'move_down', 'register', 'withdraw']);
  const idempotencyKey = trimmed(req.body.idempotency_key, 191);
  const sessionId = positiveInteger(req.body.session_id);
  if (!action || idempotencyKey.length < 8 || (action !== 'create' && sessionId === null)
    || (action === 'withdraw' && !checked(req.body.confirm_destructive))) {
    return redirectTo(res, eventPath(id, '/agenda?status=agenda-failed'));
  }
  let payload = {};
  if (action === 'create' || action === 'update') {
    payload = agendaSessionPayload(req.body);
    if (!payload.title || !payload.start_at || !payload.end_at || (req.body.capacity !== '' && payload.capacity === null)) {
      return redirectTo(res, eventPath(id, '/agenda?status=agenda-failed'));
    }
    if (action === 'update') {
      payload.expected_version = positiveInteger(req.body.expected_version);
      if (payload.expected_version === null) return redirectTo(res, eventPath(id, '/agenda?status=agenda-failed'));
    }
  } else if (action === 'cancel') {
    payload = { expected_version: positiveInteger(req.body.expected_version), reason: trimmed(req.body.reason, 500) };
    if (payload.expected_version === null || !payload.reason) return redirectTo(res, eventPath(id, '/agenda?status=agenda-failed'));
  } else if (action === 'register' || action === 'withdraw') {
    payload = { expected_version: Math.max(0, Number.parseInt(req.body.expected_version, 10) || 0) };
  } else {
    const ordered = arrayValues(req.body.ordered_session_ids).map(positiveInteger).filter(Boolean);
    const currentIndex = ordered.indexOf(sessionId);
    const swapIndex = action === 'move_up' ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || swapIndex < 0 || swapIndex >= ordered.length) {
      return redirectTo(res, eventPath(id, '/agenda?status=agenda-failed'));
    }
    [ordered[currentIndex], ordered[swapIndex]] = [ordered[swapIndex], ordered[currentIndex]];
    payload = {
      expected_agenda_version: Math.max(0, Number.parseInt(req.body.expected_agenda_version, 10) || 0),
      ordered_session_ids: ordered
    };
  }
  try {
    const token = tokenFrom(req);
    switch (action) {
      case 'create':
        await callEventMutation(token, 'POST', `/${id}/agenda/sessions`, payload, idempotencyKey);
        break;
      case 'update':
        await callEventMutation(token, 'PUT', `/${id}/agenda/sessions/${sessionId}`, payload, idempotencyKey);
        break;
      case 'cancel':
        await callEventMutation(token, 'POST', `/${id}/agenda/sessions/${sessionId}/cancel`, payload, idempotencyKey);
        break;
      case 'register':
        await callEventMutation(token, 'POST', `/${id}/agenda/sessions/${sessionId}/registration`, payload, idempotencyKey);
        break;
      case 'withdraw':
        await callEventMutation(token, 'POST', `/${id}/agenda/sessions/${sessionId}/registration/withdraw`, payload, idempotencyKey);
        break;
      case 'move_up':
      case 'move_down':
        await callEventMutation(token, 'PUT', `/${id}/agenda/order`, payload, idempotencyKey);
        break;
      default:
        return redirectTo(res, eventPath(id, '/agenda?status=agenda-failed'));
    }
    const status = {
      create: 'agenda-created', update: 'agenda-updated', cancel: 'agenda-cancelled',
      move_up: 'agenda-reordered', move_down: 'agenda-reordered', register: 'agenda-session-registered', withdraw: 'agenda-session-withdrawn'
    }[action];
    return redirectTo(res, eventPath(id, `/agenda?status=${status}`));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && [400, 403, 404, 409, 422, 429].includes(error.status)) {
      return redirectTo(res, eventPath(id, '/agenda?status=agenda-failed'));
    }
    throw error;
  }
}));

router.get('/:id(\\d+)/reminders', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const token = tokenFrom(req);
  const [eventResult, preferencesResult] = await Promise.all([
    callApi(token, 'GET', `/${id}`),
    callApi(token, 'GET', `/${id}/reminders`)
  ]);
  const event = eventFrom(eventResult);
  const preferences = dataFrom(preferencesResult) || {};
  const resolved = preferences.resolved || {};
  const overrides = preferences.overrides || {};
  const selectedOffsets = (Array.isArray(preferences.rules) ? preferences.rules : [])
    .map((rule) => positiveInteger(rule.offset_minutes))
    .filter(Boolean);
  const limits = preferences.limits || {};
  res.set('Cache-Control', 'private, no-store');
  return res.render('events/reminders', {
    title: res.locals.t('govuk_alpha_events.reminders.title'),
    activeNav: 'events',
    event: { id, title: trimmed(event.title) },
    preferences,
    limits: {
      minimum: positiveInteger(limits.minimum_offset_minutes) || 5,
      maximum: positiveInteger(limits.maximum_offset_minutes) || 525600,
      maximumRules: positiveInteger(limits.maximum_rules) || 10
    },
    selectedOffsets: selectedOffsets.length ? selectedOffsets : (limits.default_offsets_minutes || [1440, 60]),
    enabled: overrides.reminders_enabled ?? resolved.reminders_enabled ?? false,
    channels: { ...(resolved.channels || {}), email: overrides.email_enabled ?? resolved.channels?.email, in_app: overrides.in_app_enabled ?? resolved.channels?.in_app, web_push: overrides.web_push_enabled ?? resolved.channels?.web_push, fcm: overrides.fcm_enabled ?? resolved.channels?.fcm, realtime: overrides.realtime_enabled ?? resolved.channels?.realtime },
    source: selectedValue(resolved.reminders_source, ['event', 'category', 'global', 'tenant'], 'unavailable'),
    status: trimmed(req.query.status),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { notFoundTitle: 'Event not found' }));

router.post('/:id(\\d+)/reminders', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const expectedRevision = Math.max(0, Number.parseInt(req.body.expected_revision, 10) || 0);
  const offsets = arrayValues(req.body.offsets).concat(trimmed(req.body.custom_offset) || [])
    .map(positiveInteger).filter(Boolean);
  const uniqueOffsets = [...new Set(offsets)].sort((left, right) => right - left);
  const enabled = checked(req.body.reminders_enabled);
  if ((enabled && uniqueOffsets.length === 0) || uniqueOffsets.length > 10 || uniqueOffsets.some((offset) => offset < 5 || offset > 525600)) {
    return redirectTo(res, eventPath(id, '/reminders?status=invalid'));
  }
  try {
    await callApi(tokenFrom(req), 'PUT', `/${id}/reminders`, {
      overrides: {
        reminders_enabled: enabled,
        cadence: enabled ? 'instant' : 'off',
        email_enabled: checked(req.body.channel_email),
        in_app_enabled: checked(req.body.channel_in_app),
        web_push_enabled: checked(req.body.channel_web_push),
        fcm_enabled: checked(req.body.channel_fcm),
        realtime_enabled: checked(req.body.channel_realtime)
      },
      rules: uniqueOffsets.map((offset) => ({ offset_minutes: offset, enabled: true, email_enabled: null, in_app_enabled: null, web_push_enabled: null, fcm_enabled: null, realtime_enabled: null })),
      expected_revision: expectedRevision
    });
    return redirectTo(res, eventPath(id, '/reminders?status=saved'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && error.status === 409) return redirectTo(res, eventPath(id, '/reminders?status=conflict'));
    if (error instanceof ApiError && [400, 403, 404, 422, 429].includes(error.status)) return redirectTo(res, eventPath(id, '/reminders?status=failed'));
    throw error;
  }
}));

router.post('/:id(\\d+)/reminders/reset', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const expectedRevision = Number.parseInt(req.body.expected_revision, 10);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) return redirectTo(res, eventPath(id, '/reminders?status=invalid'));
  try {
    await callApi(tokenFrom(req), 'DELETE', `/${id}/reminders`, { expected_revision: expectedRevision });
    return redirectTo(res, eventPath(id, '/reminders?status=reset'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && error.status === 409) return redirectTo(res, eventPath(id, '/reminders?status=conflict'));
    if (error instanceof ApiError && [400, 403, 404, 422, 429].includes(error.status)) return redirectTo(res, eventPath(id, '/reminders?status=failed'));
    throw error;
  }
}));

const COMMUNICATION_VARIANTS = ['announcement', 'follow_up', 'review_request'];
const COMMUNICATION_SEGMENTS = ['registration_confirmed', 'waitlist_active', 'attendance_attended', 'attendance_no_show'];
const COMMUNICATION_CHANNELS = ['email', 'in_app', 'push'];

function communicationDraft(body = {}) {
  const variant = selectedValue(body.variant, COMMUNICATION_VARIANTS);
  const segments = [...new Set(arrayValues(body.segments).map((value) => trimmed(value)).filter((value) => COMMUNICATION_SEGMENTS.includes(value)))];
  const channels = [...new Set(arrayValues(body.channels).map((value) => trimmed(value)).filter((value) => COMMUNICATION_CHANNELS.includes(value)))];
  const message = trimmed(body.body, 20001);
  if (!variant || segments.length === 0 || channels.length === 0 || !message || message.length > 20000) return null;
  return { variant, segments, channels, body: message };
}

async function renderCommunications(req, res, options = {}) {
  const id = Number(req.params.id);
  const token = tokenFrom(req);
  const page = boundedPositiveInteger(req.query.page, 1);
  const historyPage = boundedPositiveInteger(req.query.history_page, 1);
  const broadcastId = positiveInteger(req.query.broadcast_id);
  const [eventResult, listResult, detailResult] = await Promise.all([
    callApi(token, 'GET', `/${id}`),
    callApi(token, 'GET', `/${id}/broadcasts?page=${page}&per_page=20`),
    broadcastId ? callEventBroadcastApi(token, 'GET', `/${broadcastId}?history_page=${historyPage}&history_per_page=50`) : null
  ]);
  const event = eventFrom(eventResult);
  const formatDate = typeof res.locals.formatLocaleDate === 'function'
    ? res.locals.formatLocaleDate
    : (value) => trimmed(value);
  const dateLabel = (value) => {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) {
      return res.locals.t('govuk_alpha.events.communications.not_recorded');
    }
    return `${formatDate(date, {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
    })}, ${formatDate(date, {
      day: undefined, month: undefined, year: undefined,
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC', timeZoneName: 'short'
    })}`;
  };
  const formatNumber = typeof res.locals.formatLocaleNumber === 'function'
    ? res.locals.formatLocaleNumber
    : (value) => String(Number(value) || 0);
  const broadcasts = collectionFrom(listResult).map((broadcast) => ({
    ...broadcast,
    versionLabel: formatNumber(broadcast?.version || 0),
    recipientCountLabel: formatNumber(broadcast?.audience?.recipient_count || 0),
    delivery: {
      ...(broadcast?.delivery || {}),
      totalLabel: formatNumber(broadcast?.delivery?.total || 0),
      deliveredLabel: formatNumber(broadcast?.delivery?.delivered || 0),
      suppressedLabel: formatNumber(broadcast?.delivery?.suppressed || 0),
      deadLetteredLabel: formatNumber(broadcast?.delivery?.dead_lettered || 0)
    },
    scheduledAtLabel: dateLabel(broadcast?.scheduled_at)
  }));
  const listMeta = listResult?.meta || dataFrom(listResult)?.meta || dataFrom(listResult)?.pagination || {};
  const listCurrentPage = positiveInteger(listMeta.current_page ?? listMeta.page) || page;
  const listPerPage = positiveInteger(listMeta.per_page) || 20;
  const listTotal = Math.max(0, Number(listMeta.total) || broadcasts.length);
  const listTotalPages = Math.max(
    1,
    positiveInteger(listMeta.total_pages ?? listMeta.last_page)
      || Math.ceil(listTotal / listPerPage)
  );
  const detail = detailResult ? dataFrom(detailResult) : null;
  if (detail?.broadcast && positiveInteger(detail.broadcast.event_id) !== id) {
    return res.status(404).render('errors/404', { title: 'Broadcast not found' });
  }
  const historyMeta = detail?.history_meta || {};
  const detailBroadcastId = positiveInteger(detail?.broadcast?.id);
  const historyCurrentPage = positiveInteger(historyMeta.current_page) || historyPage;
  const historyTotalPages = Math.max(1, positiveInteger(historyMeta.total_pages) || 1);
  const history = Array.isArray(detail?.history) ? detail.history.map((entry) => {
    return { ...entry, dateLabel: dateLabel(entry?.created_at) };
  }) : [];
  const historyPath = (targetPage) => eventPath(
    id,
    `/communications?page=${listCurrentPage}&broadcast_id=${detailBroadcastId}&history_page=${targetPage}`
  );
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  return res.render('events/communications', {
    title: res.locals.t('govuk_alpha.events.communications.title'), activeNav: 'events',
    event: { id, title: trimmed(event.title) }, broadcasts,
    pagination: {
      currentPage: listCurrentPage,
      totalPages: listTotalPages,
      previousHref: listCurrentPage > 1 ? eventPath(id, `/communications?page=${listCurrentPage - 1}`) : '',
      nextHref: listCurrentPage < listTotalPages ? eventPath(id, `/communications?page=${listCurrentPage + 1}`) : ''
    },
    detail: detail ? {
      ...detail,
      history,
      pagination: {
        previousHref: detailBroadcastId && historyCurrentPage > 1 ? historyPath(historyCurrentPage - 1) : '',
        nextHref: detailBroadcastId && historyCurrentPage < historyTotalPages ? historyPath(historyCurrentPage + 1) : ''
      }
    } : null,
    preview: options.preview || null,
    draft: options.draft || { variant: 'announcement', segments: ['registration_confirmed'], channels: ['email', 'in_app'], body: '' },
    status: options.status ?? trimmed(req.query.status), idempotencyKey: randomUUID(), csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}

router.get('/:id(\\d+)/communications', requireAuth, asyncRoute(async (req, res) => renderCommunications(req, res), { notFoundTitle: 'Event not found' }));

router.post('/:id(\\d+)/communications/preview', requireAuth, asyncRoute(async (req, res) => {
  const draft = communicationDraft(req.body);
  if (!draft) return redirectTo(res, eventPath(Number(req.params.id), '/communications?status=invalid'));
  try {
    const result = await callApi(tokenFrom(req), 'POST', `/${Number(req.params.id)}/broadcasts/preview`, {
      variant: draft.variant, segments: draft.segments, channels: draft.channels
    });
    return renderCommunications(req, res, { draft, preview: dataFrom(result) });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && [400, 403, 404, 409, 422, 429, 503].includes(error.status)) return redirectTo(res, eventPath(Number(req.params.id), '/communications?status=failed'));
    throw error;
  }
}));

router.post('/:id(\\d+)/communications', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const draft = communicationDraft(req.body);
  const key = trimmed(req.body.idempotency_key, 191);
  if (!draft || !checked(req.body.preview_confirmed) || !key) return redirectTo(res, eventPath(id, '/communications?status=invalid'));
  try {
    await callEventMutation(tokenFrom(req), 'POST', `/${id}/broadcasts`, draft, key);
    return redirectTo(res, eventPath(id, '/communications?status=created'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && [400, 403, 404, 409, 422, 429, 503].includes(error.status)) return redirectTo(res, eventPath(id, '/communications?status=failed'));
    throw error;
  }
}));

async function mutateCommunication(req, res, action) {
  const id = Number(req.params.id);
  const broadcastId = positiveInteger(req.params.broadcastId);
  const expectedVersion = positiveInteger(req.body.expected_version);
  const key = trimmed(req.body.idempotency_key, 191);
  const payload = { expected_version: expectedVersion };
  if (action === 'schedule') payload.scheduled_at = trimmed(req.body.scheduled_at) || null;
  if (action === 'cancel') payload.reason = trimmed(req.body.reason, 501);
  if (!broadcastId || !expectedVersion || !key || (action === 'cancel' && (!payload.reason || payload.reason.length > 500))) {
    return redirectTo(res, eventPath(id, '/communications?status=invalid'));
  }
  try {
    const options = { headers: { 'Idempotency-Key': key } };
    if (action === 'schedule') await callEventBroadcastApi(tokenFrom(req), 'POST', `/${broadcastId}/schedule`, payload, options);
    else if (action === 'cancel') await callEventBroadcastApi(tokenFrom(req), 'POST', `/${broadcastId}/cancel`, payload, options);
    else await callEventBroadcastApi(tokenFrom(req), 'POST', `/${broadcastId}/retry`, payload, options);
    const success = { schedule: 'scheduled', cancel: 'cancelled', retry: 'retried' }[action];
    return redirectTo(res, eventPath(id, `/communications?status=${success}`));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && [400, 403, 404, 409, 422, 429, 503].includes(error.status)) return redirectTo(res, eventPath(id, '/communications?status=failed'));
    throw error;
  }
}

router.post('/:id(\\d+)/communications/:broadcastId(\\d+)/schedule', requireAuth, asyncRoute(async (req, res) => mutateCommunication(req, res, 'schedule')));
router.post('/:id(\\d+)/communications/:broadcastId(\\d+)/cancel', requireAuth, asyncRoute(async (req, res) => mutateCommunication(req, res, 'cancel')));
router.post('/:id(\\d+)/communications/:broadcastId(\\d+)/retry', requireAuth, asyncRoute(async (req, res) => mutateCommunication(req, res, 'retry')));

async function ticketCatalogue(token, eventId) {
  const result = await callApi(token, 'GET', `/${eventId}/tickets`);
  const data = dataFrom(result) || {};
  return data.catalogue || data;
}

router.get('/:id(\\d+)/tickets', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const token = tokenFrom(req);
  const [eventResult, catalogue] = await Promise.all([callApi(token, 'GET', `/${id}`), ticketCatalogue(token, id)]);
  const event = eventFrom(eventResult);
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  return res.render('events/tickets', {
    title: res.locals.t('event_tickets.title'), activeNav: 'events', event: { id, title: trimmed(event.title) },
    catalogue, ticketNames: Object.fromEntries(collectionFrom({ data: catalogue.ticket_types || [] }).map((ticket) => [ticket.id, ticket])),
    status: trimmed(req.query.status), idempotencyKey: randomUUID(), csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { notFoundTitle: 'Event not found' }));

router.post('/:id(\\d+)/tickets/:ticketTypeId(\\d+)/allocate', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const ticketTypeId = positiveInteger(req.params.ticketTypeId);
  const units = positiveInteger(req.body.units);
  const key = trimmed(req.body.idempotency_key, 512);
  if (!ticketTypeId || !units || units > 1000 || !key) return redirectTo(res, eventPath(id, '/tickets?status=invalid'));
  try {
    await callEventMutation(tokenFrom(req), 'POST', `/${id}/tickets/${ticketTypeId}/allocate`, { units }, key);
    return redirectTo(res, eventPath(id, '/tickets?status=allocated'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && [400, 403, 404, 409, 422, 429, 503].includes(error.status)) return redirectTo(res, eventPath(id, '/tickets?status=allocate-failed'));
    throw error;
  }
}));

router.get('/:id(\\d+)/tickets/entitlements/:entitlementId(\\d+)/cancel', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const entitlementId = positiveInteger(req.params.entitlementId);
  const catalogue = await ticketCatalogue(tokenFrom(req), id);
  const entitlement = arrayValues(catalogue.own_entitlements).find((item) => positiveInteger(item?.id) === entitlementId);
  const ticket = arrayValues(catalogue.ticket_types).find((item) => positiveInteger(item?.id) === positiveInteger(entitlement?.ticket_type_id));
  if (!entitlement || !ticket || entitlement.kind !== 'free') return res.status(404).render('errors/404', { title: 'Ticket not found' });
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  return res.render('events/ticket-cancel', {
    title: res.locals.t('event_tickets.cancel_title'), activeNav: 'events', eventId: id, entitlement, ticket,
    status: trimmed(req.query.status), idempotencyKey: randomUUID(), csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { notFoundTitle: 'Ticket not found' }));

router.post('/:id(\\d+)/tickets/entitlements/:entitlementId(\\d+)/cancel', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const entitlementId = positiveInteger(req.params.entitlementId);
  const expectedVersion = positiveInteger(req.body.expected_version);
  const key = trimmed(req.body.idempotency_key, 512);
  const reason = trimmed(req.body.reason, 501);
  if (!entitlementId || !expectedVersion || !key || !reason || reason.length > 500) return redirectTo(res, eventPath(id, `/tickets/entitlements/${entitlementId || 0}/cancel?status=invalid`));
  try {
    await callEventMutation(tokenFrom(req), 'POST', `/${id}/ticket-entitlements/${entitlementId}/cancel`, { expected_version: expectedVersion, reason }, key);
    return redirectTo(res, eventPath(id, '/tickets?status=cancelled'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && [400, 403, 404, 409, 422, 429, 503].includes(error.status)) return redirectTo(res, eventPath(id, `/tickets/entitlements/${entitlementId}/cancel?status=failed`));
    throw error;
  }
}));

router.get('/:id(\\d+)/analytics', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const result = await callApi(tokenFrom(req), 'GET', `/${id}/analytics`);
  const summary = dataFrom(result) || {};
  const value = (input) => input && typeof input === 'object'
    ? (input.suppressed ? 'suppressed' : (input.basis_points === null || input.basis_points === undefined ? (input.value ?? 0) : `${(Number(input.basis_points) / 100).toFixed(1)}%`))
    : (input ?? 0);
  const sections = {
    registration: [['confirmed', value(summary.registration?.confirmed)], ['pending', value(summary.registration?.pending)], ['cancelled', value(summary.registration?.cancelled)], ['capacity_remaining', summary.registration?.remaining ?? 'not_limited']],
    acquisition: [['invitations_issued', value(summary.invitation?.issued)], ['invitations_accepted', value(summary.invitation?.accepted)], ['invitation_conversion', value(summary.invitation?.conversion)], ['waitlist_joined', value(summary.waitlist?.joined)], ['waitlist_accepted', value(summary.waitlist?.accepted)], ['waitlist_conversion', value(summary.waitlist?.conversion)]],
    attendance: [['checked_in', value(summary.attendance?.checked_in)], ['attended', value(summary.attendance?.attended)], ['no_show', value(summary.attendance?.no_show)], ['attendance_rate', value(summary.attendance?.attendance_rate)]],
    communications: [['delivered', value(summary.communications?.delivered)], ['suppressed_deliveries', value(summary.communications?.suppressed)], ['failed_deliveries', value(summary.communications?.failed)], ['dead_lettered', value(summary.communications?.dead_lettered)], ['delivery_rate', value(summary.communications?.delivery_rate)]],
    funnel: [['event_views', value(summary.optional_funnel?.event_views)], ['registration_starts', value(summary.optional_funnel?.registration_starts)], ['start_conversion', value(summary.optional_funnel?.start_to_registration_conversion)], ['guardian_consents', value(summary.safeguarding?.guardian_consents)]],
    finance: summary.tickets?.redacted ? [['finance', 'finance_redacted']] : [['ticket_units', value(summary.tickets?.confirmed_units)], ['ticket_credit_value', value(summary.tickets?.confirmed_credit_value)], ['completed_credit_claims', value(summary.credits?.completed_claims)], ['failed_credit_claims', value(summary.credits?.failed_claims)]]
  };
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  return res.render('events/analytics', {
    title: res.locals.t('govuk_alpha.events.analytics.title'), activeNav: 'events', eventId: id, summary, sections
  });
}, { notFoundTitle: 'Event not found' }));

router.get('/:id(\\d+)/analytics/export.csv', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const download = await downloadEventApi(tokenFrom(req), `/${id}/analytics/export.csv`);
  res.status(download.status || 200);
  res.set('Content-Type', download.headers['content-type'] || 'text/csv; charset=UTF-8');
  res.set('Content-Disposition', download.headers['content-disposition'] || `attachment; filename="event-${id}-analytics.csv"`);
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  res.set('X-Content-Type-Options', 'nosniff');
  return res.send(download.body);
}));

function calendarSensitive(res) {
  res.set('Cache-Control', 'private, no-store, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Robots-Tag', 'noindex, nofollow');
}

router.get('/:id(\\d+)/calendar', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const token = tokenFrom(req);
  const [eventResult, actionsResult] = await Promise.all([callApi(token, 'GET', `/${id}`), callApi(token, 'GET', `/${id}/calendar-actions`)]);
  return res.render('events/calendar', {
    title: res.locals.t('govuk_alpha.events.calendar_actions_title'), activeNav: 'events',
    event: { id, title: trimmed(eventFrom(eventResult).title) }, actions: dataFrom(actionsResult) || {}
  });
}, { notFoundTitle: 'Event not found' }));

async function streamCalendar(req, res, path, fallbackName) {
  const download = await downloadEventApi(tokenFrom(req), path);
  res.status(download.status || 200);
  res.set('Content-Type', download.headers['content-type'] || 'text/calendar; charset=utf-8');
  res.set('Content-Disposition', download.headers['content-disposition'] || `attachment; filename="${fallbackName}"`);
  calendarSensitive(res);
  res.set('X-Content-Type-Options', 'nosniff');
  return res.send(download.body);
}

router.get('/:id(\\d+)/calendar.ics', requireAuth, asyncRoute(async (req, res) => streamCalendar(req, res, `/${Number(req.params.id)}/calendar.ics`, `event-${Number(req.params.id)}.ics`)));
router.get('/calendar.ics', requireAuth, asyncRoute(async (req, res) => streamCalendar(req, res, '/calendar/feed.ics', 'events.ics')));

async function calendarTokens(token) {
  return collectionFrom(await callApi(token, 'GET', '/calendar/feed-tokens'));
}

router.get('/calendar-subscriptions', requireAuth, asyncRoute(async (req, res) => {
  calendarSensitive(res);
  return res.render('events/calendar-subscriptions', {
    title: res.locals.t('govuk_alpha.events.calendar_subscriptions_title'), activeNav: 'events',
    tokens: await calendarTokens(tokenFrom(req)), createdFeedUrl: '', status: trimmed(req.query.status), label: '', csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.post('/calendar-subscriptions', requireAuth, asyncRoute(async (req, res) => {
  const label = trimmed(req.body.label, 101);
  const hasControlCharacters = [...label].some((character) => character.codePointAt(0) <= 31 || character.codePointAt(0) === 127);
  if (label.length > 100 || hasControlCharacters) return redirectTo(res, '/events/calendar-subscriptions?status=invalid');
  try {
    const result = await callApi(tokenFrom(req), 'POST', '/calendar/feed-tokens', { label: label || null });
    const created = dataFrom(result) || {};
    calendarSensitive(res);
    return res.status(201).render('events/calendar-subscriptions', {
      title: res.locals.t('govuk_alpha.events.calendar_subscriptions_title'), activeNav: 'events',
      tokens: await calendarTokens(tokenFrom(req)), createdFeedUrl: trimmed(created.feed_url, 4096), status: 'created', label: '', csrfToken: req.csrfToken ? req.csrfToken() : ''
    });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && [400, 409, 422, 429].includes(error.status)) return redirectTo(res, '/events/calendar-subscriptions?status=failed');
    throw error;
  }
}));

router.get('/calendar-subscriptions/:tokenId(\\d+)/revoke', requireAuth, asyncRoute(async (req, res) => {
  const tokenId = positiveInteger(req.params.tokenId);
  const token = (await calendarTokens(tokenFrom(req))).find((item) => positiveInteger(item?.id) === tokenId && checked(item?.active));
  if (!token) return res.status(404).render('errors/404', { title: 'Calendar subscription not found' });
  calendarSensitive(res);
  return res.render('events/calendar-subscription-revoke', {
    title: res.locals.t('govuk_alpha.events.calendar_subscription_revoke_title'), activeNav: 'events', token,
    status: trimmed(req.query.status), csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.post('/calendar-subscriptions/:tokenId(\\d+)/revoke', requireAuth, asyncRoute(async (req, res) => {
  const tokenId = positiveInteger(req.params.tokenId);
  if (!tokenId || req.body.confirm_revoke !== 'yes') return redirectTo(res, `/events/calendar-subscriptions/${tokenId || 0}/revoke?status=invalid`);
  try {
    await callApi(tokenFrom(req), 'DELETE', `/calendar/feed-tokens/${tokenId}`);
    calendarSensitive(res);
    return redirectTo(res, '/events/calendar-subscriptions?status=revoked');
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && [400, 403, 404, 409, 422, 429].includes(error.status)) return redirectTo(res, `/events/calendar-subscriptions/${tokenId}/revoke?status=failed`);
    throw error;
  }
}));

router.get('/:id(\\d+)/lifecycle-history', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const perPage = boundedPositiveInteger(req.query.per_page, 20, 100);
  const cursor = trimmed(req.query.cursor, 2048);
  const query = new URLSearchParams({ per_page: String(perPage) });
  if (cursor) query.set('cursor', cursor);
  const token = tokenFrom(req);
  const [eventResult, historyResult] = await Promise.all([
    callApi(token, 'GET', `/${id}`), callApi(token, 'GET', `/${id}/lifecycle-history?${query.toString()}`)
  ]);
  const event = eventFrom(eventResult);
  const formatDate = typeof res.locals.formatLocaleDate === 'function'
    ? res.locals.formatLocaleDate
    : (value) => trimmed(value);
  const formatNumber = typeof res.locals.formatLocaleNumber === 'function'
    ? res.locals.formatLocaleNumber
    : (value) => String(Number(value) || 0);
  const entries = collectionFrom(historyResult).map((entry) => {
    const recordedAt = new Date(entry?.created_at);
    const recordedAtLabel = entry?.created_at && !Number.isNaN(recordedAt.getTime())
      ? formatDate(recordedAt, {
        day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC'
      })
      : res.locals.t('event_lifecycle_history.timestamp_unknown');
    const cascade = entry?.evidence?.cascade || {};
    const evidenceItems = ['reminders_cancelled', 'waitlist_cancelled', 'registrations_cancelled']
      .filter((key) => Number.isInteger(cascade[key]) && cascade[key] > 0)
      .map((key) => res.locals.t(`event_lifecycle_history.cascade.${key}`, {
        count: formatNumber(cascade[key])
      }));
    const series = entry?.evidence?.series;
    if (series && ['template', 'occurrence'].includes(series.member_type) && positiveInteger(series.root_event_id)) {
      evidenceItems.push(res.locals.t(`event_lifecycle_history.series.${series.member_type}`, {
        id: formatNumber(series.root_event_id)
      }));
    }
    if (entry?.evidence?.notifications_suppressed === true) {
      evidenceItems.push(res.locals.t('event_lifecycle_history.notifications_suppressed'));
    }
    return { ...entry, recordedAtLabel, evidenceItems };
  });
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
  return res.render('events/lifecycle-history', {
    title: res.locals.t('event_lifecycle_history.title'), activeNav: 'events', event: { id, title: trimmed(event.title) },
    entries, pagination: historyResult?.meta || {}, perPage
  });
}, { notFoundTitle: 'Event not found' }));

async function registrationProductState(token, id, query = '') {
  const attendee = dataFrom(await callApi(token, 'GET', `/${id}/registration-product`)) || {};
  let organizer = null;
  try { organizer = dataFrom(await callApi(token, 'GET', `/${id}/registration-product/manage${query}`)) || {}; }
  catch (error) { if (!(error instanceof ApiError) || error.status !== 403) throw error; }
  return { attendee, organizer };
}

function registrationPagination(id, sourceQuery, organizer) {
  const collections = ['submissions', 'campaigns', 'guests'];
  const href = (collection, page) => {
    if (!positiveInteger(page)) return '';
    const query = new URLSearchParams();
    for (const candidate of collections) for (const suffix of ['page', 'per_page']) {
      const key = `${candidate}_${suffix}`;
      const value = positiveInteger(sourceQuery?.[key]);
      if (value) query.set(key, String(value));
    }
    query.set(`${collection}_page`, String(page));
    return eventPath(id, `/registration?${query.toString()}#registration-${collection}`);
  };
  return Object.fromEntries(collections.map((collection) => {
    const pagination = organizer?.pagination?.[collection] || {};
    return [collection, {
      previousHref: href(collection, pagination.previous_page),
      nextHref: href(collection, pagination.next_page)
    }];
  }));
}

function registrationQuestions(value) {
  const rows = value && typeof value === 'object' ? Object.values(value).slice(0, 100) : [];
  return rows.filter((row) => row && checked(row.enabled)).map((row, index) => {
    const type = selectedValue(row.question_type, ['short_text', 'long_text', 'single_choice', 'multiple_choice', 'dietary', 'accessibility', 'consent', 'waiver']);
    const choices = ['single_choice', 'multiple_choice'].includes(type) ? trimmed(row.choices, 10000).split(/\r?\n/).map((item) => item.trim()).filter(Boolean) : null;
    const validation = {};
    for (const field of ['min_length', 'max_length']) { const parsed = Number.parseInt(row[field], 10); if (Number.isInteger(parsed) && parsed >= 0) validation[field] = parsed; }
    const conditionKey = trimmed(row.condition_key, 191);
    return { stable_key: trimmed(row.stable_key, 191) || `question_${index + 1}`, question_type: type, prompt: trimmed(row.prompt, 2000), help_text: trimmed(row.help_text, 2000) || null, is_required: checked(row.is_required), data_classification: selectedValue(row.data_classification, ['public', 'internal', 'confidential', 'sensitive'], 'internal'), purpose: trimmed(row.purpose, 2000), retention_days: positiveInteger(row.retention_days), choice_options: choices, validation_rules: Object.keys(validation).length ? validation : null, visibility_rules: conditionKey ? { match: 'all', conditions: [{ question_key: conditionKey, operator: selectedValue(row.condition_operator, ['equals', 'not_equals', 'contains', 'not_contains'], 'equals'), value: trimmed(row.condition_value, 1000) }] } : null, displayed_text: ['consent', 'waiver'].includes(type) ? trimmed(row.displayed_text, 10000) : null, displayed_text_version: ['consent', 'waiver'].includes(type) ? trimmed(row.displayed_text_version, 191) : null };
  }).filter((question) => question.question_type && question.prompt && question.purpose && question.retention_days);
}

function registrationAnswers(questions, value) {
  const submitted = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(arrayValues(questions).map((question) => {
    const key = trimmed(question?.stable_key, 191);
    const type = trimmed(question?.question_type);
    const raw = submitted[key];
    if (type === 'multiple_choice') return [key, arrayValues(raw).map((item) => String(item))];
    if (['consent', 'waiver'].includes(type)) return [key, checked(raw)];
    return [key, raw === undefined || raw === null ? '' : String(raw)];
  }).filter(([key]) => key));
}

function registrationAnswerErrors(questions, answers, res) {
  const errors = {};
  for (const question of arrayValues(questions)) {
    const key = trimmed(question?.stable_key, 191);
    if (!key) continue;
    const type = trimmed(question?.question_type);
    const value = answers[key];
    const rules = question?.validation_rules && typeof question.validation_rules === 'object'
      ? question.validation_rules
      : {};
    const isConditional = question?.visibility_rules && typeof question.visibility_rules === 'object';
    const selections = Array.isArray(value) ? value : [];
    const textValue = typeof value === 'string' ? value : '';
    const answered = type === 'multiple_choice'
      ? selections.length > 0
      : (['consent', 'waiver'].includes(type) ? value === true : textValue.trim() !== '');

    if (question?.is_required && !isConditional && !answered) {
      errors[key] = res.locals.t('event_registration.answers.validation.required');
      continue;
    }
    if (!answered) continue;

    const minLength = Number.parseInt(rules.min_length, 10);
    const configuredMaxLength = Number.parseInt(rules.max_length, 10);
    const hardMaxLength = type === 'short_text' ? 500 : 10000;
    const maxLength = Number.isInteger(configuredMaxLength)
      ? Math.min(configuredMaxLength, hardMaxLength)
      : hardMaxLength;
    if (!Array.isArray(value) && Number.isInteger(minLength) && textValue.length < minLength) {
      errors[key] = res.locals.t('event_registration.answers.validation.min_length', { limit: minLength });
      continue;
    }
    if (!Array.isArray(value) && textValue.length > maxLength) {
      errors[key] = res.locals.t('event_registration.answers.validation.max_length', { limit: maxLength });
      continue;
    }
    const minSelections = Number.parseInt(rules.min_selections, 10);
    const maxSelections = Number.parseInt(rules.max_selections, 10);
    if (Array.isArray(value) && Number.isInteger(minSelections) && selections.length < minSelections) {
      errors[key] = res.locals.tc('event_registration.answers.validation.min_selections', minSelections, { count: minSelections });
      continue;
    }
    if (Array.isArray(value) && Number.isInteger(maxSelections) && selections.length > maxSelections) {
      errors[key] = res.locals.tc('event_registration.answers.validation.max_selections', maxSelections, { count: maxSelections });
    }
  }
  return errors;
}

function rememberRegistrationAnswers(req, eventId, formId, values, errors = {}) {
  if (!req.session) return;
  req.session.eventRegistrationAnswers = { eventId, formId, values, errors };
}

function consumeRegistrationAnswers(req, eventId, formId) {
  const replay = req.session?.eventRegistrationAnswers;
  if (req.session?.eventRegistrationAnswers) delete req.session.eventRegistrationAnswers;
  return replay && replay.eventId === eventId && replay.formId === formId
    ? replay
    : { values: {}, errors: {} };
}

function registrationFormInput(body) {
  const rows = body?.questions && typeof body.questions === 'object'
    ? Object.values(body.questions).slice(0, 100)
    : [];
  return {
    name: trimmed(body?.name, 255),
    description: trimmed(body?.description, 2000),
    questions: rows.map((row, index) => {
      const conditionKey = trimmed(row?.condition_key, 191);
      const validation = {};
      if (row?.min_length !== '' && row?.min_length !== undefined) validation.min_length = row.min_length;
      if (row?.max_length !== '' && row?.max_length !== undefined) validation.max_length = row.max_length;
      return {
        enabled: checked(row?.enabled), stable_key: trimmed(row?.stable_key, 191) || `question_${index + 1}`,
        question_type: trimmed(row?.question_type), data_classification: trimmed(row?.data_classification),
        prompt: trimmed(row?.prompt, 2000), help_text: trimmed(row?.help_text, 2000), purpose: trimmed(row?.purpose, 2000),
        retention_days: row?.retention_days, is_required: checked(row?.is_required),
        choice_options: trimmed(row?.choices, 10000).split(/\r?\n/).map((choice) => choice.trim()).filter(Boolean),
        validation_rules: validation, displayed_text: trimmed(row?.displayed_text, 10000),
        displayed_text_version: trimmed(row?.displayed_text_version, 191),
        visibility_rules: conditionKey ? { conditions: [{ question_key: conditionKey, operator: trimmed(row?.condition_operator) || 'equals', value: trimmed(row?.condition_value, 1000) }] } : null
      };
    })
  };
}

function rememberRegistrationForm(req, eventId, formId, values, message) {
  if (!req.session) return;
  req.session.eventRegistrationForm = { eventId, formId: formId || 0, values, errors: [message] };
}

function consumeRegistrationForm(req, eventId, formId) {
  const replay = req.session?.eventRegistrationForm;
  if (req.session?.eventRegistrationForm) delete req.session.eventRegistrationForm;
  return replay && replay.eventId === eventId && replay.formId === (formId || 0)
    ? replay
    : { values: null, errors: [] };
}

router.get('/:id(\\d+)/registration', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id); const token = tokenFrom(req); const query = new URLSearchParams();
  for (const collection of ['submissions', 'campaigns', 'guests']) for (const suffix of ['page', 'per_page']) { const key = `${collection}_${suffix}`; if (positiveInteger(req.query[key])) query.set(key, String(positiveInteger(req.query[key]))); }
  const [eventResult, state] = await Promise.all([callApi(token, 'GET', `/${id}`), registrationProductState(token, id, query.size ? `?${query}` : '')]);
  const activeRegistration = arrayValues(state.attendee?.registrations).find((registration) => ['invited', 'confirmed', 'pending'].includes(trimmed(registration?.registration_state)));
  const replay = consumeRegistrationAnswers(req, id, positiveInteger(state.attendee?.form?.id));
  const settings = state.organizer?.settings;
  const timezone = trimmed(settings?.event_timezone_snapshot) || 'UTC';
  const organizer = state.organizer && {
    ...state.organizer,
    settings: settings && {
      ...settings,
      opens_at_local: dateTimeLocalInZone(settings.opens_at_utc, timezone),
      closes_at_local: dateTimeLocalInZone(settings.closes_at_utc, timezone),
      cancellation_cutoff_at_local: dateTimeLocalInZone(settings.cancellation_cutoff_at_utc, timezone)
    }
  };
  res.set('Cache-Control', 'private, no-store');
  return res.render('events/registration', { title: res.locals.t('event_registration.title'), activeNav: 'events', event: { id, title: trimmed(eventFrom(eventResult).title) }, ...state, organizer, registrationPagination: registrationPagination(id, req.query, organizer), activeRegistration, status: trimmed(req.query.status), answerValues: replay.values, answerErrors: replay.errors, idempotencyKey: randomUUID(), csrfToken: req.csrfToken ? req.csrfToken() : '' });
}, { notFoundTitle: 'Event not found' }));

router.post('/:id(\\d+)/registration/settings', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id); const key = trimmed(req.body.idempotency_key, 191); const expectedRevision = Number.parseInt(req.body.expected_revision, 10); const approvalMode = selectedValue(req.body.approval_mode, ['auto', 'manual']); const perMemberLimit = positiveInteger(req.body.per_member_limit); const guestRetentionDays = positiveInteger(req.body.guest_retention_days); const guestsEnabled = checked(req.body.guests_enabled); const maxGuests = guestsEnabled ? positiveInteger(req.body.max_guests_per_registration) : 0;
  if (!key || !Number.isInteger(expectedRevision) || expectedRevision < 0 || !approvalMode || !perMemberLimit || !guestRetentionDays || maxGuests === null) return redirectTo(res, eventPath(id, '/registration?status=invalid'));
  const payload = { approval_mode: approvalMode, opens_at: trimmed(req.body.opens_at) || null, closes_at: trimmed(req.body.closes_at) || null, cancellation_cutoff_at: trimmed(req.body.cancellation_cutoff_at) || null, per_member_limit: perMemberLimit, guests_enabled: guestsEnabled, max_guests_per_registration: maxGuests, guest_retention_days: guestRetentionDays, expected_revision: expectedRevision };
  try { await callEventMutation(tokenFrom(req), 'PUT', `/${id}/registration-product/settings`, payload, key); return redirectTo(res, eventPath(id, '/registration?status=settings-saved')); }
  catch (error) { if (redirectOnAuthError(error, res)) return undefined; if (error instanceof ApiError && [400, 403, 404, 409, 422, 429, 503].includes(error.status)) return redirectTo(res, eventPath(id, '/registration?status=failed')); throw error; }
}));

router.post('/:id(\\d+)/registration/settings/publish', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id); const revision = positiveInteger(req.body.expected_revision); const key = trimmed(req.body.idempotency_key, 191);
  if (!revision || !key) return redirectTo(res, eventPath(id, '/registration?status=invalid'));
  try { await callEventMutation(tokenFrom(req), 'POST', `/${id}/registration-product/settings/publish`, { expected_revision: revision }, key); return redirectTo(res, eventPath(id, '/registration?status=settings-published')); }
  catch (error) { if (redirectOnAuthError(error, res)) return undefined; if (error instanceof ApiError && [400, 403, 404, 409, 422, 429, 503].includes(error.status)) return redirectTo(res, eventPath(id, '/registration?status=failed')); throw error; }
}));

async function renderRegistrationForm(req, res) {
  const id = Number(req.params.id); const formId = positiveInteger(req.params.formId); const state = await registrationProductState(tokenFrom(req), id);
  if (!state.organizer) return renderForbidden(res, new Error('You do not have permission to manage registration forms.'));
  const form = formId ? arrayValues(state.organizer.forms).find((item) => positiveInteger(item?.id) === formId) : null;
  if (formId && (!form || form.status !== 'draft')) return res.status(404).render('errors/404', { title: 'Registration form not found' });
  const replay = consumeRegistrationForm(req, id, formId);
  const formValues = replay.values || form || {};
  const questionRows = replay.values
    ? [...arrayValues(replay.values.questions), ...Array(Math.max(0, 5 - arrayValues(replay.values.questions).length)).fill({ enabled: false })]
    : [...arrayValues(form?.questions).map((row) => ({ ...row, enabled: true })), ...Array(5).fill({ enabled: false })];
  res.set('Cache-Control', 'private, no-store');
  return res.render('events/registration-form', { title: res.locals.t(`event_registration.forms.editor.${form ? 'edit_title' : 'create_title'}`), activeNav: 'events', eventId: id, form, formValues, formErrors: replay.errors, questionRows, settingsRevision: positiveInteger(state.organizer.settings?.revision) || 1, idempotencyKey: randomUUID(), csrfToken: req.csrfToken ? req.csrfToken() : '' });
}
router.get('/:id(\\d+)/registration/forms/new', requireAuth, asyncRoute(renderRegistrationForm));
router.get('/:id(\\d+)/registration/forms/:formId(\\d+)', requireAuth, asyncRoute(renderRegistrationForm));

async function saveRegistrationForm(req, res) {
  const id = Number(req.params.id); const formId = positiveInteger(req.params.formId); const key = trimmed(req.body.idempotency_key, 191); const settingsRevision = positiveInteger(req.body.expected_settings_revision); const formRevision = formId ? positiveInteger(req.body.expected_form_revision) : null; const name = trimmed(req.body.name, 255); const description = trimmed(req.body.description, 2000) || null; const questions = registrationQuestions(req.body.questions);
  const replay = registrationFormInput(req.body);
  const errorMessage = res.locals.t('event_registration.accessible.validation_error');
  if (!key || !settingsRevision || !name || questions.length === 0 || (formId && !formRevision)) {
    rememberRegistrationForm(req, id, formId, replay, errorMessage);
    return redirectTo(res, eventPath(id, formId ? `/registration/forms/${formId}?status=invalid` : '/registration/forms/new?status=invalid'));
  }
  const payload = { name, description, questions, expected_settings_revision: settingsRevision, ...(formId ? { expected_form_revision: formRevision } : {}) };
  try {
    if (formId) await callEventMutation(tokenFrom(req), 'PUT', `/${id}/registration-product/forms/${formId}`, payload, key);
    else await callEventMutation(tokenFrom(req), 'POST', `/${id}/registration-product/forms`, payload, key);
    return redirectTo(res, eventPath(id, '/registration?status=form-saved'));
  }
  catch (error) { if (redirectOnAuthError(error, res)) return undefined; if (error instanceof ApiError && [400, 403, 404, 409, 422, 429, 503].includes(error.status)) { rememberRegistrationForm(req, id, formId, replay, errorMessage); return redirectTo(res, eventPath(id, formId ? `/registration/forms/${formId}?status=failed` : '/registration/forms/new?status=failed')); } throw error; }
}
router.post('/:id(\\d+)/registration/forms/new', requireAuth, asyncRoute(saveRegistrationForm));
router.post('/:id(\\d+)/registration/forms/:formId(\\d+)', requireAuth, asyncRoute(saveRegistrationForm));

async function transitionRegistrationForm(req, res, action) {
  const id = Number(req.params.id); const formId = positiveInteger(req.params.formId); const key = trimmed(req.body.idempotency_key, 191); const settingsRevision = positiveInteger(req.body.expected_settings_revision); const formRevision = positiveInteger(req.body.expected_form_revision);
  if (!formId || !key || !settingsRevision || (action === 'publish' && !formRevision)) return redirectTo(res, eventPath(id, '/registration?status=invalid'));
  const payload = { expected_settings_revision: settingsRevision, ...(action === 'publish' ? { expected_form_revision: formRevision } : {}) };
  try {
    if (action === 'publish') await callEventMutation(tokenFrom(req), 'POST', `/${id}/registration-product/forms/${formId}/publish`, payload, key);
    else await callEventMutation(tokenFrom(req), 'POST', `/${id}/registration-product/forms/${formId}/fork`, payload, key);
    return redirectTo(res, eventPath(id, `/registration?status=form-${action === 'fork' ? 'forked' : 'published'}`));
  }
  catch (error) { if (redirectOnAuthError(error, res)) return undefined; if (error instanceof ApiError && [400, 403, 404, 409, 422, 429, 503].includes(error.status)) return redirectTo(res, eventPath(id, '/registration?status=failed')); throw error; }
}
router.post('/:id(\\d+)/registration/forms/:formId(\\d+)/publish', requireAuth, asyncRoute(async (req, res) => transitionRegistrationForm(req, res, 'publish')));
router.post('/:id(\\d+)/registration/forms/:formId(\\d+)/fork', requireAuth, asyncRoute(async (req, res) => transitionRegistrationForm(req, res, 'fork')));

router.post('/:id(\\d+)/registration/registrations/:registrationId(\\d+)/forms/:formId(\\d+)/submit', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id); const registrationId = positiveInteger(req.params.registrationId); const formId = positiveInteger(req.params.formId); const key = trimmed(req.body.idempotency_key, 180);
  if (!registrationId || !formId || !key) return redirectTo(res, eventPath(id, '/registration?status=invalid'));
  let answers = req.body.answers && typeof req.body.answers === 'object' ? { ...req.body.answers } : {};
  const expectedRevision = req.body.expected_submission_revision === '' || req.body.expected_submission_revision === undefined ? null : Math.max(0, Number.parseInt(req.body.expected_submission_revision, 10));
  try {
    const attendee = dataFrom(await callApi(tokenFrom(req), 'GET', `/${id}/registration-product`)) || {};
    const registration = arrayValues(attendee.registrations).find((item) => positiveInteger(item?.id) === registrationId);
    if (!registration || positiveInteger(attendee.form?.id) !== formId) throw new ApiError('Registration form identity mismatch', 409);
    const questions = arrayValues(attendee.form?.questions);
    answers = registrationAnswers(questions, answers);
    const errors = registrationAnswerErrors(questions, answers, res);
    if (Object.keys(errors).length) {
      rememberRegistrationAnswers(req, id, formId, answers, errors);
      return redirectTo(res, eventPath(id, '/registration?status=invalid#registration-answers'));
    }
    const saved = dataFrom(await callEventMutation(tokenFrom(req), 'POST', `/${id}/registration-product/submissions`, { registration_id: registrationId, form_version_id: formId, answers, expected_revision: expectedRevision }, `${key}:draft`)) || {};
    const submission = saved.submission || saved; const submissionId = positiveInteger(submission.id); const revision = positiveInteger(submission.revision);
    if (!submissionId || !revision) throw new ApiError('Registration submission response was incomplete', 502);
    await callEventMutation(tokenFrom(req), 'POST', `/${id}/registration-product/submissions/${submissionId}/submit`, { expected_revision: revision }, `${key}:submit`);
    return redirectTo(res, eventPath(id, '/registration?status=answers-submitted'));
  } catch (error) { if (redirectOnAuthError(error, res)) return undefined; if (error instanceof ApiError && [400, 403, 404, 409, 422, 429, 503].includes(error.status)) { rememberRegistrationAnswers(req, id, formId, answers); return redirectTo(res, eventPath(id, '/registration?status=failed#registration-answers')); } throw error; }
}));

router.post('/:id(\\d+)/registration/submissions/:submissionId(\\d+)/review', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id); const submissionId = positiveInteger(req.params.submissionId); const purpose = trimmed(req.body.purpose, 500); const correlation = trimmed(req.body.correlation_id, 191);
  if (!submissionId || !purpose || !correlation) return redirectTo(res, eventPath(id, '/registration?status=invalid'));
  const token = tokenFrom(req);
  const [answerResult, state] = await Promise.all([callApi(token, 'POST', `/${id}/registration-product/submissions/${submissionId}/answers`, { purpose, correlation_id: correlation, include_sensitive: checked(req.body.include_sensitive) }), registrationProductState(token, id)]);
  const questions = {};
  for (const form of arrayValues(state.organizer?.forms)) for (const question of arrayValues(form.questions)) questions[question.id] = question.prompt;
  res.set('Cache-Control', 'private, no-store');
  return res.render('events/registration-answers', { title: res.locals.t('event_registration.accessible.review_submission', { id: submissionId }), activeNav: 'events', eventId: id, submissionId, answers: dataFrom(answerResult)?.answers || {}, questions });
}));

router.post('/:id(\\d+)/registration/submissions/export', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id); const purpose = trimmed(req.body.purpose, 500); const correlation = trimmed(req.body.correlation_id, 191);
  if (!purpose || !correlation) return redirectTo(res, eventPath(id, '/registration?status=invalid'));
  const download = await downloadEventRegistrationSubmissions(tokenFrom(req), id, { purpose, correlation_id: correlation, include_sensitive: checked(req.body.include_sensitive) });
  res.status(download.status || 200); res.set('Content-Type', download.headers['content-type'] || 'text/csv; charset=UTF-8'); res.set('Content-Disposition', download.headers['content-disposition'] || `attachment; filename="event-registration-${id}.csv"`); res.set('Cache-Control', 'private, no-store'); res.set('X-Content-Type-Options', 'nosniff'); return res.send(download.body);
}));

router.post('/:id(\\d+)/registration/invitations/:invitationId(\\d+)/accept', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id); const invitationId = positiveInteger(req.params.invitationId); const key = trimmed(req.body.idempotency_key, 191);
  if (!invitationId || !key) return redirectTo(res, eventPath(id, '/registration?status=invalid'));
  try { await callEventMutation(tokenFrom(req), 'POST', `/${id}/registration-product/invitations/${invitationId}/accept`, {}, key); return redirectTo(res, eventPath(id, '/registration?status=invitation-accepted')); }
  catch (error) { if (redirectOnAuthError(error, res)) return undefined; if (error instanceof ApiError && [400, 403, 404, 409, 422, 429, 503].includes(error.status)) return redirectTo(res, eventPath(id, '/registration?status=failed')); throw error; }
}));

router.post('/:id(\\d+)/registration/registrations/:registrationId(\\d+)/guests', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id); const registrationId = positiveInteger(req.params.registrationId); const version = positiveInteger(req.body.expected_registration_version); const displayName = trimmed(req.body.display_name, 255);
  if (!registrationId || !version || !displayName || !checked(req.body.consent_accepted)) return redirectTo(res, eventPath(id, '/registration?status=invalid'));
  const notificationConsent = checked(req.body.notification_consent);
  const payload = { expected_registration_version: version, display_name: displayName, email: trimmed(req.body.email, 320) || null, phone: trimmed(req.body.phone, 50) || null, consent_accepted: true, consent_text: res.locals.t('event_registration.accessible.privacy_consent_text'), consent_text_version: '2026-07-12', preferred_locale: res.locals.locale || 'en', notification_consent: notificationConsent, notification_consent_text: notificationConsent ? res.locals.t('event_registration.accessible.notification_consent_text') : null, notification_consent_version: notificationConsent ? '2026-07-12' : null, ticket_entitlement_id: positiveInteger(req.body.ticket_entitlement_id) };
  try { await callApi(tokenFrom(req), 'POST', `/${id}/registration-product/registrations/${registrationId}/guests`, payload); return redirectTo(res, eventPath(id, '/registration?status=guest-added')); }
  catch (error) { if (redirectOnAuthError(error, res)) return undefined; if (error instanceof ApiError && [400, 403, 404, 409, 422, 429, 503].includes(error.status)) return redirectTo(res, eventPath(id, '/registration?status=failed')); throw error; }
}));

router.post('/:id(\\d+)/registration/guests/:guestId(\\d+)/cancel', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id); const guestId = positiveInteger(req.params.guestId); const revision = positiveInteger(req.body.expected_revision); const reason = trimmed(req.body.reason, 500);
  if (!guestId || !revision || !reason || !checked(req.body.confirm_destructive)) return redirectTo(res, eventPath(id, '/registration?status=invalid'));
  try { await callApi(tokenFrom(req), 'POST', `/${id}/registration-product/guests/${guestId}/cancel`, { expected_revision: revision, reason }); return redirectTo(res, eventPath(id, '/registration?status=guest-cancelled')); }
  catch (error) { if (redirectOnAuthError(error, res)) return undefined; if (error instanceof ApiError && [400, 403, 404, 409, 422, 429, 503].includes(error.status)) return redirectTo(res, eventPath(id, '/registration?status=failed')); throw error; }
}));

router.post('/:id(\\d+)/registration/guests/:guestId(\\d+)/attendance/:action(check_in|check_out|no_show|undo)', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id); const guestId = positiveInteger(req.params.guestId); const version = Number.parseInt(req.body.expected_version, 10); const key = trimmed(req.body.idempotency_key, 191);
  if (!guestId || !Number.isInteger(version) || version < 0 || !key) return redirectTo(res, eventPath(id, '/registration?status=invalid'));
  try { await callEventMutation(tokenFrom(req), 'POST', `/${id}/registration-product/guests/${guestId}/attendance/${req.params.action}`, { expected_version: version, reason: trimmed(req.body.reason, 500) || null }, key); return redirectTo(res, eventPath(id, '/registration?status=attendance-updated')); }
  catch (error) { if (redirectOnAuthError(error, res)) return undefined; if (error instanceof ApiError && [400, 403, 404, 409, 422, 429, 503].includes(error.status)) return redirectTo(res, eventPath(id, '/registration?status=failed')); throw error; }
}));

function registrationCampaignSource(type, raw) {
  const values = trimmed(raw, 20000).split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean);
  if (type === 'member') return { member_ids: values.map(positiveInteger).filter(Boolean) };
  if (type === 'email') return { emails: values };
  if (type === 'group') return positiveInteger(values[0]) ? { group_id: positiveInteger(values[0]) } : null;
  if (type === 'audience') return { criteria: values.length ? { all_active: true, roles: values } : { all_active: true } };
  if (type === 'csv') return trimmed(raw, 20000) ? { csv: trimmed(raw, 20000) } : null;
  return null;
}

async function renderRegistrationResult(req, res, extras = {}) {
  const id = Number(req.params.id); const token = tokenFrom(req);
  const [eventResult, state] = await Promise.all([callApi(token, 'GET', `/${id}`), registrationProductState(token, id)]);
  res.set('Cache-Control', 'private, no-store');
  return res.render('events/registration', { title: res.locals.t('event_registration.title'), activeNav: 'events', event: { id, title: trimmed(eventFrom(eventResult).title) }, ...state, status: null, idempotencyKey: randomUUID(), csrfToken: req.csrfToken ? req.csrfToken() : '', ...extras });
}

router.post('/:id(\\d+)/registration/campaigns/preview', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id); const key = trimmed(req.body.idempotency_key, 191); const type = selectedValue(req.body.campaign_type, ['member', 'email', 'group', 'audience', 'csv']); const source = registrationCampaignSource(type, req.body.source);
  if (!key || !type || !source) return redirectTo(res, eventPath(id, '/registration?status=invalid'));
  try { const result = dataFrom(await callEventMutation(tokenFrom(req), 'POST', `/${id}/registration-product/campaigns/preview`, { campaign_type: type, source, default_locale: selectedValue(req.body.default_locale, ['en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar'], 'en') }, key)) || {}; return renderRegistrationResult(req, res, { campaignPreview: result.campaign || result }); }
  catch (error) { if (redirectOnAuthError(error, res)) return undefined; if (error instanceof ApiError && [400, 403, 404, 409, 422, 429, 503].includes(error.status)) return redirectTo(res, eventPath(id, '/registration?status=failed')); throw error; }
}));

async function mutateRegistrationCampaign(req, res, action) {
  const id = Number(req.params.id); const campaignId = positiveInteger(req.params.campaignId); const revision = positiveInteger(req.body.expected_revision); const key = trimmed(req.body.idempotency_key, 191); const payload = { expected_revision: revision };
  if (action === 'issue') payload.expires_at = trimmed(req.body.expires_at);
  if (action === 'schedule') payload.scheduled_for = trimmed(req.body.scheduled_for);
  if (action === 'cancel') payload.reason = trimmed(req.body.reason, 2000);
  if (!campaignId || !revision || !key || (action === 'issue' && !payload.expires_at) || (action === 'schedule' && !payload.scheduled_for) || (action === 'cancel' && !payload.reason)) return redirectTo(res, eventPath(id, '/registration?status=invalid'));
  try {
    if (action === 'issue') await callEventMutation(tokenFrom(req), 'POST', `/${id}/registration-product/campaigns/${campaignId}/issue`, payload, key);
    else if (action === 'schedule') await callEventMutation(tokenFrom(req), 'POST', `/${id}/registration-product/campaigns/${campaignId}/schedule`, payload, key);
    else await callEventMutation(tokenFrom(req), 'POST', `/${id}/registration-product/campaigns/${campaignId}/cancel`, payload, key);
    const status = { issue: 'campaign-issued', schedule: 'campaign-scheduled', cancel: 'campaign-cancelled' }[action];
    return redirectTo(res, eventPath(id, `/registration?status=${status}`));
  }
  catch (error) { if (redirectOnAuthError(error, res)) return undefined; if (error instanceof ApiError && [400, 403, 404, 409, 422, 429, 503].includes(error.status)) return redirectTo(res, eventPath(id, '/registration?status=failed')); throw error; }
}
router.post('/:id(\\d+)/registration/campaigns/:campaignId(\\d+)/issue', requireAuth, asyncRoute(async (req, res) => mutateRegistrationCampaign(req, res, 'issue')));
router.post('/:id(\\d+)/registration/campaigns/:campaignId(\\d+)/schedule', requireAuth, asyncRoute(async (req, res) => mutateRegistrationCampaign(req, res, 'schedule')));
router.post('/:id(\\d+)/registration/campaigns/:campaignId(\\d+)/cancel', requireAuth, asyncRoute(async (req, res) => mutateRegistrationCampaign(req, res, 'cancel')));

router.post('/:id(\\d+)/registration/retention/preview', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id); const key = trimmed(req.body.idempotency_key, 191); const asOf = trimmed(req.body.as_of, 32);
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return redirectTo(res, eventPath(id, '/registration?status=invalid'));
  try { const result = dataFrom(await callEventMutation(tokenFrom(req), 'POST', `/${id}/registration-product/retention/dry-run`, { as_of: asOf }, key)) || {}; return renderRegistrationResult(req, res, { retentionRun: result.run || result }); }
  catch (error) { if (redirectOnAuthError(error, res)) return undefined; if (error instanceof ApiError && [400, 403, 404, 409, 422, 429, 503].includes(error.status)) return redirectTo(res, eventPath(id, '/registration?status=failed')); throw error; }
}));

router.post('/:id(\\d+)/registration/retention/:runId(\\d+)/apply', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id); const runId = positiveInteger(req.params.runId); const key = trimmed(req.body.idempotency_key, 191);
  if (!runId || !key || !checked(req.body.confirm_destructive)) return redirectTo(res, eventPath(id, '/registration?status=invalid'));
  try { await callEventMutation(tokenFrom(req), 'POST', `/${id}/registration-product/retention/${runId}/apply`, {}, key); return redirectTo(res, eventPath(id, '/registration?status=retention-applied')); }
  catch (error) { if (redirectOnAuthError(error, res)) return undefined; if (error instanceof ApiError && [400, 403, 404, 409, 422, 429, 503].includes(error.status)) return redirectTo(res, eventPath(id, '/registration?status=failed')); throw error; }
}));

router.post('/:id(\\d+)/check-in/credential/rotate', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const credentialId = positiveInteger(req.body.credential_id);
  const expectedVersion = positiveInteger(req.body.expected_version);
  const idempotencyKey = trimmed(req.body.idempotency_key, 191);
  if (!checked(req.body.confirmation) || credentialId === null || expectedVersion === null || idempotencyKey.length < 8) {
    return redirectTo(res, eventPath(id, '/check-in/credential?status=invalid'));
  }
  try {
    const result = await callApi(tokenFrom(req), 'POST', `/${id}/offline-checkin/credentials/${credentialId}/rotate`, {
      expected_version: expectedVersion,
      idempotency_key: idempotencyKey
    });
    const credential = offlineCredentialFrom(result);
    return renderOfflineCredential(req, res, id, {
      credentialResult: result,
      status: credential?.tokenOneShot ? 'replaced' : 'already-active'
    });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && [400, 403, 404, 409, 422].includes(error.status)) {
      return redirectTo(res, eventPath(id, '/check-in/credential?status=failed'));
    }
    throw error;
  }
}));

router.post('/:id(\\d+)/check-in/credential/revoke', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const credentialId = positiveInteger(req.body.credential_id);
  const expectedVersion = positiveInteger(req.body.expected_version);
  const reason = trimmed(req.body.reason, 501);
  if (!checked(req.body.confirmation) || credentialId === null || expectedVersion === null || !reason || reason.length > 500) {
    return redirectTo(res, eventPath(id, '/check-in/credential?status=invalid'));
  }
  try {
    await callApi(tokenFrom(req), 'POST', `/${id}/offline-checkin/credentials/${credentialId}/revoke`, {
      expected_version: expectedVersion,
      reason
    });
    return redirectTo(res, eventPath(id, '/check-in/credential?status=revoked'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && [400, 403, 404, 409, 422].includes(error.status)) {
      return redirectTo(res, eventPath(id, '/check-in/credential?status=failed'));
    }
    throw error;
  }
}));

router.post('/:id(\\d+)/waitlist/accept', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const token = trimmed(req.body.token, 513);
  if (token.length > 512) {
    return redirectTo(res, eventRedirect(id, 'waitlist-offer-accept-failed'));
  }
  const payload = {
    idempotency_key: trimmed(req.body.idempotency_key, 191) || randomUUID()
  };
  if (token) payload.token = token;
  return runEventAction(
    req,
    res,
    'POST',
    `/${id}/registration/waitlist/accept`,
    payload,
    eventRedirect(id, 'waitlist-offer-accepted'),
    eventRedirect(id, 'waitlist-offer-accept-failed')
  );
}));

router.post('/:id(\\d+)/attendees/:attendeeId(\\d+)/check-in', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const attendeeId = Number(req.params.attendeeId);
  return runEventAction(
    req,
    res,
    'POST',
    `/${id}/attendees/${attendeeId}/check-in`,
    undefined,
    eventRedirect(id, 'checkin-success'),
    eventRedirect(id, 'checkin-failed')
  );
}));

router.post('/:id(\\d+)/polls/:pollId(\\d+)/vote', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());
  const id = Number(req.params.id);
  const pollId = Number(req.params.pollId);
  const optionId = positiveInteger(req.body.option_id);
  if (optionId === null) {
    return redirectTo(res, eventRedirect(id, 'poll-vote-failed', `#poll-${pollId}`));
  }

  try {
    await votePoll(token, pollId, { option_id: optionId });
    return redirectTo(res, eventRedirect(id, 'poll-voted', `#poll-${pollId}`));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, eventRedirect(id, 'poll-vote-failed', `#poll-${pollId}`));
  }
}));

router.post('/:id(\\d+)/polls', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runEventAction(
    req,
    res,
    'PUT',
    `/${id}`,
    { poll_ids: pollIdsFrom(req.body.poll_ids) },
    eventPath(id, '/polls?status=polls-updated'),
    eventPath(id, '/polls?status=polls-failed')
  );
}));

router.post('/:id(\\d+)/recurring-edit', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const scope = trimmed(req.body.scope) === 'all' ? 'all' : 'single';
  if (scope === 'all') {
    const token = tokenFrom(req);
    if (!token) return redirectTo(res, loginRedirect());
    try {
      const [eventResult, capabilitiesResult] = await Promise.all([
        callApi(token, 'GET', `/${id}`),
        callApi(token, 'GET', '/recurrence-capabilities')
      ]);
      if (!supportsEffectiveRevisions(capabilitiesResult)) return redirectTo(res, eventPath(id, '/recurring-edit?status=unavailable'));
      const event = eventFrom(eventResult);
      if (!eventIsSeries(event) || checked(event.is_recurring_template) || positiveInteger(event.parent_event_id) === null) {
        return redirectTo(res, eventPath(id, '/recurring-edit?status=concrete-required'));
      }
      const patch = recurringRevisionPatch(req.body, event);
      if (!patch || trimmed(req.body.title).length < 1 || trimmed(req.body.title).length > 255
        || !trimmed(req.body.description) || !Object.keys(patch).length) {
        return redirectTo(res, eventPath(id, `/recurring-edit?status=${patch && !Object.keys(patch).length ? 'no-changes' : 'invalid'}`));
      }
      const preview = dataFrom(await callApi(token, 'POST', `/${id}/recurrence-revisions/preview`, { patch })) || {};
      res.set('Cache-Control', 'private, no-store'); res.set('Pragma', 'no-cache'); res.set('Referrer-Policy', 'no-referrer');
      return res.render('events/recurring-preview', { title: res.locals.t('govuk_alpha_events.recurring_edit.confirm_title'), activeNav: 'events', event: { id, title: patch.title || trimmed(event.title) }, patch, preview, patchJson: JSON.stringify(patch), idempotencyKey: randomUUID(), csrfToken: req.csrfToken ? req.csrfToken() : '' });
    } catch (error) {
      if (redirectOnAuthError(error, res)) return undefined;
      if (error instanceof ApiError && [400, 403, 404, 409, 413, 422, 429, 503].includes(error.status)) return redirectTo(res, eventPath(id, '/recurring-edit?status=preview-failed'));
      throw error;
    }
  }
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());
  try {
    await callApi(token, 'PUT', `/${id}/recurring`, {
      ...eventScopedPayload(req.body),
      scope
    });
    return redirectTo(res, eventRedirect(id, 'event-updated'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    const errors = eventFormErrors(
      error,
      res.locals.t('govuk_alpha_events.recurring_edit.validation_failed')
    );
    storeRecurringForm(req, id, req.body, errors);
    return redirectTo(res, eventPath(id, '/recurring-edit'));
  }
}));

router.post('/:id(\\d+)/recurring-edit/commit', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id); const key = trimmed(req.body.idempotency_key, 191); const token = trimmed(req.body.preview_token, 8192); let patch = null;
  try { patch = JSON.parse(trimmed(req.body.patch_json, 20000)); } catch { patch = null; }
  if (!key || !token || !patch || Array.isArray(patch) || !Object.keys(patch).length || Object.keys(patch).some((field) => !RECURRING_REVISION_FIELDS.includes(field))) return redirectTo(res, eventPath(id, '/recurring-edit?status=preview-invalid'));
  try { await callEventMutation(tokenFrom(req), 'POST', `/${id}/recurrence-revisions/commit`, { patch, preview_token: token }, key); return redirectTo(res, eventPath(id, '?status=event-updated')); }
  catch (error) { if (redirectOnAuthError(error, res)) return undefined; if (error instanceof ApiError && [400, 403, 404, 409, 413, 422, 429, 503].includes(error.status)) return redirectTo(res, eventPath(id, '/recurring-edit?status=commit-failed')); throw error; }
}));

router.post('/:id(\\d+)/translate', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());
  const id = Number(req.params.id);
  const sourceText = trimmed(req.body.source_text || req.body.description, 8000);
  if (sourceText === '') {
    return redirectTo(res, eventPath(id, '/translate?status=translate-empty'));
  }

  const payload = {
    content_type: 'event',
    content_id: id,
    source_text: sourceText,
    target_locale: trimmed(req.body.target_locale) || 'en'
  };

  const sourceLocale = trimmed(req.body.source_locale);
  if (sourceLocale !== '') {
    payload.source_locale = sourceLocale;
  }

  try {
    const result = await callUgcTranslateApi(token, payload);
    const translated = trimmed(result?.data?.translated_text || result?.translated_text, 10000);
    if (translated === '') {
      return redirectTo(res, eventPath(id, '/translate?status=translate-unavailable'));
    }
    if (translated === sourceText) {
      return redirectTo(res, eventPath(id, '/translate?status=translate-same'));
    }
    if (req.session) {
      req.session.eventTranslation = {
        eventId: id,
        text: translated,
        targetLocale: payload.target_locale
      };
    }
    return redirectTo(res, eventPath(id, '/translate?status=translate-done'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, eventPath(id, '/translate?status=translate-failed'));
  }
}));

// List events
router.get('/', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const limit = 12;
  const searchQuery = trimmed(req.query.q || req.query.search);
  const categoryId = positiveInteger(req.query.category_id);
  const when = ['upcoming', 'past', 'all'].includes(req.query.when)
    ? req.query.when
    : (req.query.upcoming_only === 'false' ? 'all' : 'upcoming');
  const near = ['any', '5', '10', '25', '50'].includes(String(req.query.near))
    ? String(req.query.near)
    : 'any';
  const stepFree = ['any', 'yes', 'no', 'unknown'].includes(String(req.query.step_free))
    ? String(req.query.step_free)
    : 'any';
  const upcomingOnly = when === 'upcoming';
  const hasFilters = Boolean(searchQuery || categoryId || when !== 'upcoming' || near !== 'any' || stepFree !== 'any');
  let nearNoLocation = false;
  let nearFilters = {};

  if (res.locals.eventsDisabled) {
    return res.status(403).render('events/index', {
      title: res.locals.t('events.title'),
      events: [],
      loadError: false,
      categories: [],
      searchQuery,
      categoryId,
      hasFilters,
      upcomingOnly,
      when,
      near,
      stepFree,
      nearNoLocation: false,
      pagination: { hasMore: false, cursor: '' },
      isAuthenticated: Boolean(token),
      canModerateEvents: false,
      moduleDisabled: true,
      successMessage: null,
      errorMessage: null
    });
  }

  if (near !== 'any' && token) {
    const profile = await getRequestProfile(req, token).catch((error) => {
      if (isAuthError(error)) throw error;
      return null;
    });
    const latitude = Number(profile?.latitude ?? profile?.location?.latitude);
    const longitude = Number(profile?.longitude ?? profile?.location?.longitude);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      nearFilters = { near_lat: latitude, near_lng: longitude, radius_km: Number(near) };
    } else {
      nearNoLocation = true;
    }
  }

  const [result, categoriesResult, moderationProbe] = await Promise.all([
    getEvents(token, {
      per_page: limit,
      cursor: trimmed(req.query.cursor) || undefined,
      q: searchQuery,
      category_id: categoryId,
      when,
      step_free: stepFree,
      ...nearFilters
    }).catch((error) => {
      if (!token && isAuthError(error)) {
        return { data: [], meta: { has_more: false, cursor: null }, loadError: true };
      }
      throw error;
    }),
    getEventCategories(token).catch((error) => {
      if (isAuthError(error)) throw error;
      return { data: [] };
    }),
    token
      ? callAdminEventApi(token, 'GET', '?publication_state=pending_review&page=1&per_page=1')
        .catch((error) => {
          if (isAuthError(error)) throw error;
          return null;
        })
      : null
  ]);

  const events = collectionFrom(result).map((row) => {
    const event = currentEventDetail(eventWithAssetUrls(row));
    const scheduleLabels = eventScheduleLabels(event, res.locals.formatLocaleDate);
    return {
      ...event,
      start_label: scheduleLabels.startLabel,
      end_label: scheduleLabels.endLabel
    };
  });
  const categories = collectionFrom(categoriesResult);
  const meta = result?.meta || {};
  const loadError = result?.loadError === true;
  const eventStatus = ['event-archived', 'event-deleted', 'event-archive-failed'].includes(trimmed(req.query.status))
    ? trimmed(req.query.status)
    : '';

  res.render('events/index', {
    title: 'Events',
    events,
    loadError,
    categories,
    searchQuery,
    categoryId,
    hasFilters,
    upcomingOnly,
    when,
    near,
    stepFree,
    nearNoLocation,
    moduleDisabled: false,
    eventStatus,
    pagination: {
      hasMore: Boolean(meta.has_more),
      cursor: trimmed(meta.cursor || meta.next_cursor)
    },
    isAuthenticated: Boolean(token),
    canModerateEvents: moderationProbe !== null,
    successMessage: eventStatus ? null : (req.flash ? req.flash('success')[0] : null),
    errorMessage: eventStatus ? null : (req.flash ? req.flash('error')[0] : null)
  });
}));

// Create event form
router.get('/new', requireAuth, asyncRoute(async (req, res) => {
  let setupErrorMessage = null;

  const categoriesResult = await getEventCategories(req.token).catch((error) => {
    if (error instanceof ApiError && error.status === 401) {
      throw error;
    }
    setupErrorMessage = 'Sorry, there is a problem loading event setup information.';
    return { data: [] };
  });
  const categories = collectionFrom(categoriesResult);

  res.render('events/new', {
    title: 'Create an event',
    categories,
    setupErrorMessage,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

// Create event
router.post('/new', requireAuth, audit.eventCreate(), asyncRoute(async (req, res) => {
  const {
    title,
    description,
    start_time,
    end_time,
    group_id,
    is_recurring,
    recurrence_frequency,
    recurrence_interval,
    recurrence_ends_type,
    recurrence_ends_after_count,
    recurrence_ends_on_date
  } = req.body;
  const image = uploadedFile(req, 'image');
  const values = {
    ...req.body,
    title: trimmed(title),
    description: trimmed(description),
    start_time: dateTimeLocal(start_time),
    end_time: dateTimeLocal(end_time),
    is_online: checked(req.body.is_online),
    allow_remote_attendance: checked(req.body.allow_remote_attendance),
    is_recurring: checked(is_recurring)
  };

  const errors = [];

  if (values.title === '') {
    errors.push({ text: 'Enter an event title', href: '#title' });
  } else if (values.title.length > 255) {
    errors.push({ text: 'Title must be 255 characters or fewer', href: '#title' });
  }

  if (values.description === '') {
    errors.push({ text: 'Enter an event description', href: '#description' });
  }

  if (values.start_time === '') {
    errors.push({ text: 'Enter a start date and time', href: '#start_time' });
  }

  // Helper to render form with errors
  const renderFormWithErrors = async (errorList) => {
    await removeUploadedFile(image);
    let categories = [];
    try {
      const categoriesResult = await getEventCategories(req.token);
      categories = collectionFrom(categoriesResult);
    } catch (error) {
      if (isAuthError(error)) throw error;
      // Non-auth support-data failures remain visible through the validation form.
    }

    return res.render('events/new', {
      title: 'Create an event',
      errors: errorList,
      values,
      categories,
      csrfToken: req.csrfToken ? req.csrfToken() : ''
    });
  };

  if (errors.length > 0) {
    return renderFormWithErrors(errors);
  }

  try {
    const eventData = {
      ...eventScopedPayload(req.body),
      group_id: positiveInteger(group_id)
    };

    const result = checked(is_recurring)
      ? await callApi(req.token, 'POST', '/recurring', {
        ...eventData,
        ...recurrencePayload({ recurrence_frequency, recurrence_interval, recurrence_ends_type, recurrence_ends_after_count, recurrence_ends_on_date })
      })
      : await createEvent(req.token, eventData);
    const eventId = resultEventId(result);
    if (eventId === null) {
      throw new ApiError('The event API did not return the created event ID.', 502, result);
    }

    try {
      await uploadEventCoverImage(req.token, eventId, image);
    } catch (uploadError) {
      if (uploadError instanceof ApiError && uploadError.status === 401) {
        throw uploadError;
      }
    } finally {
      await removeUploadedFile(image);
    }

    redirectTo(res, checked(is_recurring)
      ? `${EVENTS_PATH}?status=event-created`
      : eventPath(eventId, '?status=event-created'));
  } catch (error) {
    await removeUploadedFile(image);
    if (isOnboardingRequired(error)) {
      return redirectTo(res, '/onboarding');
    }
    if (error instanceof ApiError && [400, 409, 422].includes(error.status)) {
      return renderFormWithErrors(eventFormErrors(error, 'Unable to create event'));
    }
    if (error instanceof ApiError && error.status === 403) {
      return renderForbidden(res, error);
    }
    throw error; // asyncRoute handles 401, 404, and 503 consistently.
  }
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Event not found' }));

// View event details
router.get('/:id(\\d+)', asyncRoute(async (req, res) => {
  const { id } = req.params;
  const token = tokenFrom(req);
  const attendeesCursor = trimmed(req.query.attendees_cursor, 2048);

  const [eventResult, rsvpsResult, currentUserResult, relationshipResult, polls] = await Promise.all([
    getEvent(token, id),
    getEventRsvps(token, id, { status: 'all', perPage: 50, cursor: attendeesCursor }).catch((error) => {
      if (isAuthError(error)) throw error;
      return { data: [], meta: {}, attendeesLoadFailed: true };
    }),
    token ? getRequestProfile(req, token).catch((error) => {
      if (isAuthError(error)) throw error;
      return null;
    }) : Promise.resolve(null),
    token ? callApi(token, 'GET', `/${id}/relationship`).catch((error) => {
      if (isAuthError(error)) throw error;
      return null;
    }) : Promise.resolve(null),
    eventPollDetails(token, Number(id), res.locals.t)
  ]);

  const event = currentEventDetail(eventFrom(eventResult));
  event.onlineLink = event.online_link;
  event.videoUrl = event.video_url;
  const ownerId = eventOwnerId(event);
  const currentUserId = idFrom(currentUserResult);
  const isCurrentUserOwner = ownerId !== null && currentUserId !== null && String(ownerId) === String(currentUserId);
  const canEditFromApi = event.can_edit === true || event.canEdit === true || event.permissions?.edit === true;
  event.isArchived = event.is_archived;
  event.isCancelled = event.is_cancelled;
  event.can_edit = !event.is_archived && Boolean(token) && (canEditFromApi || isCurrentUserOwner);
  event.canEdit = event.can_edit;
  let recurrenceDefinitions = false;
  if (token && recurrenceDefinitionCandidate(event)) {
    try {
      recurrenceDefinitions = recurrenceCapabilitiesAllowDefinitions(
        await callApi(token, 'GET', '/recurrence-capabilities')
      );
    } catch (error) {
      if (isAuthError(error)) throw error;
    }
  }
  const relationship = eventRelationship(relationshipResult, event);
  const relationshipRsvp = relationship?.registrationState === 'confirmed'
    ? 'going'
    : (['declined', 'cancelled'].includes(relationship?.registrationState)
      ? 'not_going'
      : (relationship?.engagementState === 'interested' ? 'interested' : ''));
  const rawRsvp = relationshipRsvp || event.myRsvp || event.my_rsvp || event.user_rsvp || event.rsvp_status;
  const myRsvpStatus = trimmed(
    rawRsvp && typeof rawRsvp === 'object' ? rawRsvp.status : rawRsvp
  ).toLowerCase();
  const myRsvp = myRsvpStatus
    ? { status: myRsvpStatus === 'maybe' ? 'interested' : myRsvpStatus }
    : null;
  const attendees = collectionFrom(rsvpsResult).map((row) => eventAttendee(row, res.locals.t));
  const attendeesMeta = collectionMeta(rsvpsResult);
  const attendeesNextCursor = trimmed(attendeesMeta.cursor || attendeesMeta.next_cursor, 2048);
  const attendeesNextPath = attendeesMeta.has_more
    ? eventAttendeesNextPath(id, req.query, attendeesNextCursor)
    : '';

  const scheduleLabels = eventScheduleLabels(event, res.locals.formatLocaleDate);
  res.render('events/detail', {
    title: event.title,
    event,
    myRsvp,
    relationship,
    isOwner: isCurrentUserOwner,
    mapsEnabled: flagEnabled(req.accessibleRouting?.tenant || {}, 'maps', 'features', false),
    eventStartLabel: scheduleLabels.startLabel,
    eventEndLabel: scheduleLabels.endLabel,
    recurrenceDefinitions,
    polls,
    attendees,
    attendeesLoadFailed: rsvpsResult.attendeesLoadFailed === true,
    attendeesNextPath,
    isAuthenticated: Boolean(token),
    status: selectedValue(req.query.status, EVENT_DETAIL_STATUSES),
    idempotencyKey: randomUUID(),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { notFoundTitle: 'Event not found' }));

// Edit event form
router.get('/:id(\\d+)/edit', requireAuth, asyncRoute(async (req, res) => {
  const { id } = req.params;

  const [eventResult, currentUser] = await Promise.all([
    getEvent(req.token, id),
    getRequestProfile(req, req.token)
  ]);
  const event = eventFrom(eventResult);
  const ownerId = eventOwnerId(event);
  const currentUserId = idFrom(currentUser);
  if (ownerId !== null && currentUserId !== null && String(ownerId) !== String(currentUserId)) {
    return res.status(403).render('errors/403', { title: 'Forbidden' });
  }

  let setupErrorMessage = null;
  const categoriesResult = await getEventCategories(req.token).catch((error) => {
    if (error instanceof ApiError && error.status === 401) {
      throw error;
    }
    setupErrorMessage = 'Sorry, there is a problem loading event setup information.';
    return { data: [] };
  });
  const categories = collectionFrom(categoriesResult);

  res.render('events/edit', {
    title: `Edit ${event.title}`,
    event,
    categories,
    setupErrorMessage,
    startTime: dateTimeLocal(event.start_time ?? event.startTime),
    endTime: dateTimeLocal(event.end_time ?? event.endTime),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { notFoundTitle: 'Event not found' }));

// Update event
router.post('/:id(\\d+)/edit', requireAuth, audit.eventUpdate(), asyncRoute(async (req, res) => {
  const { id } = req.params;
  const { title, description, start_time, end_time } = req.body;
  const image = uploadedFile(req, 'image');
  const values = {
    ...req.body,
    title: trimmed(title),
    description: trimmed(description),
    start_time: dateTimeLocal(start_time),
    end_time: dateTimeLocal(end_time),
    is_online: checked(req.body.is_online),
    allow_remote_attendance: checked(req.body.allow_remote_attendance)
  };

  const errors = [];

  if (values.title === '') {
    errors.push({ text: 'Enter an event title', href: '#title' });
  } else if (values.title.length > 255) {
    errors.push({ text: 'Title must be 255 characters or fewer', href: '#title' });
  }

  if (values.description === '') {
    errors.push({ text: 'Enter an event description', href: '#description' });
  }

  if (values.start_time === '') {
    errors.push({ text: 'Enter a start date and time', href: '#start_time' });
  }

  // Helper to render form with errors
  const renderFormWithErrors = async (errorList) => {
    await removeUploadedFile(image);
    let categories = [];
    try {
      const categoriesResult = await getEventCategories(req.token);
      categories = collectionFrom(categoriesResult);
    } catch (error) {
      if (isAuthError(error)) throw error;
      // Non-auth support-data failures remain visible through the validation form.
    }

    return res.render('events/edit', {
      title: 'Edit event',
      event: { id, ...values },
      errors: errorList,
      categories,
      startTime: values.start_time,
      endTime: values.end_time,
      csrfToken: req.csrfToken ? req.csrfToken() : ''
    });
  };

  if (errors.length > 0) {
    return renderFormWithErrors(errors);
  }

  try {
    await updateEvent(req.token, id, eventScopedPayload(req.body));

    try {
      await uploadEventCoverImage(req.token, id, image);
    } catch (uploadError) {
      if (uploadError instanceof ApiError && uploadError.status === 401) {
        throw uploadError;
      }
    } finally {
      await removeUploadedFile(image);
    }

    redirectTo(res, eventPath(id, '?status=event-updated'));
  } catch (error) {
    await removeUploadedFile(image);
    if (isOnboardingRequired(error)) {
      return redirectTo(res, '/onboarding');
    }
    if (error instanceof ApiError && [400, 409, 422].includes(error.status)) {
      return renderFormWithErrors(eventFormErrors(error, 'Unable to update event'));
    }
    if (error instanceof ApiError && error.status === 403) {
      return renderForbidden(res, error);
    }
    throw error; // asyncRoute handles 401, 404, and 503 consistently.
  }
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Event not found' }));

// Cancel event
router.post('/:id(\\d+)/cancel', requireAuth, asyncRoute(async (req, res) => {
  const { id } = req.params;
  const reason = trimmed(req.body.reason);
  const idempotencyKey = trimmed(req.body.idempotency_key) || randomUUID();

  if (!reason || reason.length > 4000) {
    return redirectTo(res, eventPath(id, '?status=event-cancel-failed'));
  }

  try {
    await cancelEvent(req.token, id, {
      reason,
      idempotency_key: idempotencyKey
    });

    return redirectTo(res, eventPath(id, '?status=event-cancelled'));
  } catch (error) {
    if (isOnboardingRequired(error)) {
      return redirectTo(res, '/onboarding');
    }
    if (error instanceof ApiError && error.status === 403) {
      return renderForbidden(res, error);
    }
    if (error instanceof ApiError && [400, 409, 422].includes(error.status)) {
      return redirectTo(res, eventPath(id, '?status=event-cancel-failed'));
    }
    throw error; // asyncRoute handles 401, 404, and 503 consistently.
  }

}, { redirectOn401: loginRedirect(), notFoundTitle: 'Event not found' }));

// Archive event through Laravel's archive-first DELETE lifecycle contract.
router.post('/:id(\\d+)/delete', requireAuth, audit.eventDelete(), asyncRoute(async (req, res) => {
  const { id } = req.params;
  const reason = trimmed(req.body.reason);
  const idempotencyKey = trimmed(req.body.idempotency_key) || randomUUID();

  if (!reason || reason.length > 4000) {
    return redirectTo(res, `${EVENTS_PATH}?status=event-archive-failed`);
  }

  try {
    await deleteEvent(req.token, id, {
      reason,
      idempotency_key: idempotencyKey
    });

    redirectTo(res, `${EVENTS_PATH}?status=event-archived`);
  } catch (error) {
    if (isOnboardingRequired(error)) {
      return redirectTo(res, '/onboarding');
    }
    if (error instanceof ApiError && error.status === 403) {
      return renderForbidden(res, error);
    }
    if (error instanceof ApiError && [400, 409, 422].includes(error.status)) {
      return redirectTo(res, `${EVENTS_PATH}?status=event-archive-failed`);
    }
    throw error; // asyncRoute handles 401, 404, and 503 consistently.
  }
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Event not found' }));

// RSVP to event
router.post('/:id(\\d+)/rsvp', requireAuth, audit.eventRsvp(), asyncRoute(async (req, res) => {
  const { id } = req.params;
  const requestedStatus = trimmed(req.body.status).toLowerCase();
  const status = ['going', 'interested', 'not_going'].includes(requestedStatus)
    ? requestedStatus
    : 'going';

  try {
    await (status === 'going'
      ? callEventMutation(req.token, 'POST', `/${id}/registration/confirm`, undefined, randomUUID())
      : (status === 'not_going'
        ? callEventMutation(req.token, 'POST', `/${id}/registration/withdraw`, undefined, randomUUID())
        : rsvpToEvent(req.token, id, status)));
  } catch (error) {
    if (isOnboardingRequired(error)) {
      return redirectTo(res, '/onboarding');
    }
    if (error instanceof ApiError && error.status !== 401) {
      const code = apiErrorCode(error);
      if (error.status === 403
        && code !== 'SAFEGUARDING_POLICY_UNAVAILABLE'
        && !code.startsWith('SAFEGUARDING_')
        && code !== 'VETTING_REQUIRED') {
        return renderForbidden(res, error);
      }
      const failureStatus = code === 'SAFEGUARDING_POLICY_UNAVAILABLE'
        ? 'rsvp-policy-unavailable'
        : ((code.startsWith('SAFEGUARDING_') || code === 'VETTING_REQUIRED')
          ? 'rsvp-vetting-required'
          : 'rsvp-failed');
      return redirectTo(res, eventPath(id, `?status=${failureStatus}`));
    }
    throw error;
  }

  redirectTo(res, eventPath(id, '?status=rsvp-updated'));
}));

module.exports = router;
