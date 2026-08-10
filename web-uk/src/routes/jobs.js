// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const fs = require('fs/promises');
const { requireAuth } = require('../middleware/auth');
const {
  ApiError,
  callAdminJobApi,
  callJobApi,
  callJobDownload,
  getJobs,
  getJob,
  getUserV2,
  uploadJobApplication
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { createTranslator } = require('../lib/localization');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');
const { getRequestProfile } = require('../lib/request-profile');

const router = express.Router();
const fallbackTranslator = createTranslator('en');

const JOB_TYPES = ['paid', 'volunteer', 'timebank'];
const JOB_COMMITMENTS = ['full_time', 'part_time', 'flexible', 'one_off'];
const JOB_SALARY_TYPES = ['hourly', 'monthly', 'annual'];
const JOB_STATUSES = ['open', 'draft'];
const JOB_SORTS = ['newest', 'deadline', 'salary_desc'];
const JOBS_PER_PAGE = 12;
const TALENT_PER_PAGE = 20;
const JOB_CV_MAX_BYTES = 5 * 1024 * 1024;
const JOB_CV_EXTENSIONS = new Set(['.pdf', '.doc', '.docx']);
const JOB_FORM_FIELDS = new Set([
  'title', 'description', 'type', 'commitment', 'category', 'location', 'is_remote',
  'skills_required', 'deadline', 'salary_min', 'salary_max', 'salary_currency',
  'salary_type', 'salary_negotiable', 'hours_per_week', 'time_credits', 'contact_email', 'status'
]);
const JOB_TYPE_LABELS = {
  paid: 'Paid',
  volunteer: 'Volunteer',
  timebank: 'Time credits'
};
const JOB_COMMITMENT_LABELS = {
  full_time: 'Full time',
  part_time: 'Part time',
  flexible: 'Flexible',
  one_off: 'One-off'
};
const APPLICATION_STATUSES = [
  'applied',
  'pending',
  'screening',
  'reviewed',
  'shortlisted',
  'interview',
  'offer',
  'accepted',
  'rejected',
  'withdrawn'
];
const JOB_APPLICATION_STATUSES = [
  'applied',
  'pending',
  'screening',
  'reviewed',
  'interview',
  'offer',
  'accepted',
  'rejected',
  'withdrawn'
];
const JOB_TERMINAL_APPLICATION_STATUSES = ['accepted', 'rejected', 'withdrawn'];
const JOB_APPLICATION_LABELS = {
  applied: 'Applied',
  pending: 'Pending',
  screening: 'Screening',
  reviewed: 'Reviewed',
  shortlisted: 'Shortlisted',
  interview: 'Interview',
  offer: 'Offer',
  accepted: 'Accepted',
  rejected: 'Not selected',
  withdrawn: 'Withdrawn'
};
const JOB_POSTING_STATUS_LABELS = {
  open: 'Open',
  draft: 'Draft',
  closed: 'Closed',
  filled: 'Filled'
};
const JOB_ALERT_SUCCESS_MESSAGES = {
  'alert-created': 'Your job alert has been created.',
  'alert-paused': 'The alert has been paused.',
  'alert-resumed': 'The alert has been resumed.',
  'alert-deleted': 'The alert has been deleted.'
};
const JOB_ALERT_ERROR_MESSAGES = {
  'alert-failed': 'We could not complete that action. Please try again.'
};
const JOB_ALERT_MESSAGE_KEYS = Object.freeze({
  'alert-created': 'jobs_t4.states.alert-created',
  'alert-paused': 'jobs_t4.states.alert-paused',
  'alert-resumed': 'jobs_t4.states.alert-resumed',
  'alert-deleted': 'jobs_t4.states.alert-deleted',
  'alert-failed': 'jobs_t4.states.alert-failed'
});
const JOB_RESPONSE_SUCCESS_MESSAGES = {
  'interview-accepted': 'You accepted the interview. The employer has been notified.',
  'interview-declined': 'You declined the interview. The employer has been notified.',
  'offer-accepted': 'You accepted the offer. The employer has been notified.',
  'offer-rejected': 'You declined the offer. The employer has been notified.'
};
const JOB_RESPONSE_ERROR_MESSAGES = {
  'interview-failed': 'Sorry, we could not update that interview. It may have already been responded to.',
  'offer-failed': 'Sorry, we could not update that offer. It may have expired or already been responded to.'
};
const JOB_RESPONSE_MESSAGE_KEYS = Object.freeze({
  'interview-accepted': 'govuk_alpha_jobs.responses.states_interview_accepted',
  'interview-declined': 'govuk_alpha_jobs.responses.states_interview_declined',
  'interview-failed': 'govuk_alpha_jobs.responses.states_interview_failed',
  'offer-accepted': 'govuk_alpha_jobs.responses.states_offer_accepted',
  'offer-rejected': 'govuk_alpha_jobs.responses.states_offer_rejected',
  'offer-failed': 'govuk_alpha_jobs.responses.states_offer_failed'
});
const JOB_INTERVIEW_STATUSES = ['proposed', 'accepted', 'declined'];
const JOB_OFFER_STATUSES = ['pending', 'accepted', 'rejected', 'withdrawn', 'expired'];
const JOB_APPLICANT_STAGE_OPTIONS = [
  'applied',
  'pending',
  'screening',
  'reviewed',
  'shortlisted',
  'interview',
  'offer',
  'accepted',
  'rejected'
];
const JOB_PIPELINE_COLUMNS = ['applied', 'screening', 'interview', 'offer', 'accepted', 'rejected'];
const JOB_PIPELINE_LABELS = {
  applied: 'Applied',
  screening: 'Screening',
  interview: 'Interview',
  offer: 'Offer',
  accepted: 'Accepted',
  rejected: 'Rejected',
  other: 'Other'
};
const JOB_APPLICANT_SUCCESS_MESSAGES = {
  'status-updated': 'The application stage has been updated.'
};
const JOB_APPLICANT_ERROR_MESSAGES = {
  'status-failed': 'We could not update the application. Please try again.',
  'export-failed': 'We could not prepare the download. Please try again.'
};
const JOB_APPLICANT_MESSAGE_KEYS = Object.freeze({
  'status-updated': 'jobs_t3.states.status-updated',
  'status-failed': 'jobs_t3.states.status-failed',
  'export-failed': 'jobs_t3.states.export-failed'
});
const JOB_PIPELINE_SUCCESS_MESSAGES = {
  'status-updated': 'Candidate moved to the new stage.'
};
const JOB_PIPELINE_ERROR_MESSAGES = {
  'status-failed': 'Sorry, we could not move that candidate. Please try again.'
};
const JOB_PIPELINE_MESSAGE_KEYS = Object.freeze({
  'status-updated': 'govuk_alpha_jobs.pipeline.status_moved',
  'status-failed': 'govuk_alpha_jobs.pipeline.status_failed'
});
const JOB_STATUS_MESSAGES = Object.freeze({
  applied: 'Your application has been submitted.',
  saved: 'Opportunity saved.',
  unsaved: 'Opportunity removed from your saved list.',
  withdrawn: 'Your application has been withdrawn.',
  deleted: 'The opportunity has been deleted.',
  created: 'Your opportunity has been posted.',
  updated: 'Your changes have been saved.',
  renewed: 'The closing date has been extended.'
});
const JOB_STATUS_MESSAGE_KEYS = Object.freeze({
  applied: 'jobs.states.applied',
  saved: 'jobs_t2.states.saved',
  unsaved: 'jobs_t2.states.unsaved',
  withdrawn: 'jobs_t2.states.withdrawn',
  deleted: 'jobs_t3.states.deleted',
  created: 'jobs_t3.states.created',
  updated: 'jobs_t3.states.updated',
  renewed: 'jobs_t3.states.renewed'
});
const JOB_STATUS_ERROR_MESSAGES = Object.freeze({
  'delete-failed': 'We could not delete the opportunity. Please try again.',
  'create-failed': 'The opportunity could not be saved. Check the details and try again.'
});
const JOB_STATUS_ERROR_MESSAGE_KEYS = Object.freeze({
  'delete-failed': 'jobs_t3.states.delete-failed',
  'create-failed': 'jobs_t3.error_generic'
});
const JOB_APPLICATION_ERROR_MESSAGES = Object.freeze({
  'withdraw-failed': 'We could not withdraw your application. Please try again.'
});
const JOB_APPLICATION_ERROR_MESSAGE_KEYS = Object.freeze({
  'withdraw-failed': 'jobs_t2.states.withdraw-failed'
});
const JOB_ACTION_ERROR_MESSAGES = Object.freeze({
  'apply-failed': 'We could not submit your application. You may have already applied.',
  'save-failed': 'We could not save this opportunity. Please try again.',
  'renew-failed': 'We could not renew the opportunity. Please try again.',
  'cv-invalid': 'Your CV must be a PDF, DOC or DOCX file. Your application was not submitted.',
  'cv-too-large': 'Your CV must be 5MB or smaller. Your application was not submitted.',
  'cover-required': 'Please tell the employer why you are a good fit. Your application was not submitted.'
});
const JOB_ACTION_ERROR_MESSAGE_KEYS = Object.freeze({
  'apply-failed': 'jobs.states.apply-failed',
  'save-failed': 'jobs_t2.states.save-failed',
  'renew-failed': 'jobs_t3.states.renew-failed',
  'cv-invalid': 'jobs.states.cv-invalid',
  'cv-too-large': 'jobs.states.cv-too-large',
  'cover-required': 'jobs.states.cover-required'
});
const JOB_FORM_ERROR_MESSAGES = Object.freeze({
  'title-required': 'Enter a title for the opportunity.',
  'create-failed': 'The opportunity could not be saved. Check the details and try again.',
  'update-failed': 'The opportunity could not be saved. Check the details and try again.'
});
const JOB_FORM_ERROR_MESSAGE_KEYS = Object.freeze({
  'title-required': 'jobs_t3.error_title_required',
  'create-failed': 'jobs_t3.error_generic',
  'update-failed': 'jobs_t3.error_generic'
});
const JOB_QUALIFICATION_LABELS = {
  excellent: 'Excellent match',
  good: 'Good match',
  moderate: 'Moderate match',
  low: 'Developing match'
};
const JOB_REVIEW_DIMENSION_LABELS = {
  respect: 'Respect',
  communication: 'Communication',
  flexibility: 'Flexibility',
  impact: 'Impact'
};
const JOB_BIAS_SOURCE_LABELS = {
  direct: 'Direct',
  referral: 'Referral'
};
const DOWNLOAD_HEADER_NAMES = [
  'content-type',
  'content-disposition',
  'content-length',
  'cache-control',
  'pragma',
  'expires',
  'etag',
  'last-modified'
];

router.use(requireAuth);

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || req.token || '';
}

function loginRedirect() {
  return '/login?status=auth-required';
}

function trimmed(value, limit = null) {
  const text = String(value || '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function checkedOne(value) {
  return String(value || '') === '1';
}

function checked(value) {
  return value === true || value === 1 || value === '1';
}

function allowed(value, choices, fallback) {
  const text = trimmed(value);
  return choices.includes(text) ? text : fallback;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isAuthError(error) {
  return error instanceof ApiError && error.status === 401;
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function redirectOnAuthError(error, res) {
  if (isAuthError(error)) {
    redirectTo(res, loginRedirect());
    return true;
  }

  return false;
}

async function callJob(token, method, path, data = undefined) {
  if (data === undefined) {
    return callJobApi(token, method, path);
  }

  return callJobApi(token, method, path, data);
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

async function callAdminJob(token, method, path, data = undefined) {
  if (data === undefined) {
    return callAdminJobApi(token, method, path);
  }

  return callAdminJobApi(token, method, path, data);
}

function applyDownloadHeaders(res, headers = {}) {
  DOWNLOAD_HEADER_NAMES.forEach((name) => {
    if (headers[name]) {
      res.set(name, headers[name]);
    }
  });
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined
    ? result.data
    : result;
}

function collectionItems(result) {
  const data = dataFrom(result);
  if (Array.isArray(result && result.items)) return result.items;
  if (Array.isArray(data && data.items)) return data.items;
  if (Array.isArray(data)) return data;
  return [];
}

function collectionMeta(result, filters) {
  const data = dataFrom(result);
  const source = result && typeof result === 'object' ? result : {};
  const itemCount = collectionItems(result).length;
  const dataSource = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const meta = (source.meta && typeof source.meta === 'object')
    ? source.meta
    : ((data && data.meta && typeof data.meta === 'object') ? data.meta : {});
  const filterOffset = filters && filters.offset !== undefined ? filters.offset : 0;
  const rawCursor = meta.cursor ?? source.cursor ?? dataSource.cursor ?? '';

  return {
    total: finiteNumber(meta.total ?? source.total ?? (Array.isArray(data) ? data.length : itemCount), itemCount),
    has_more: Boolean(meta.has_more ?? source.has_more ?? dataSource.has_more ?? false),
    offset: finiteNumber(meta.offset ?? source.offset ?? dataSource.offset ?? filterOffset, filterOffset),
    per_page: finiteNumber(meta.per_page ?? meta.limit ?? source.per_page ?? source.limit ?? dataSource.per_page ?? dataSource.limit ?? JOBS_PER_PAGE, JOBS_PER_PAGE),
    cursor: rawCursor ? trimmed(rawCursor, 500) : ''
  };
}

function jobFilters(query) {
  return {
    q: trimmed(query.q, 255),
    type: allowed(query.type, JOB_TYPES, ''),
    commitment: allowed(query.commitment, JOB_COMMITMENTS, ''),
    sort: allowed(query.sort, JOB_SORTS, 'newest'),
    remote: checkedOne(query.remote),
    offset: nonNegativeInteger(query.offset)
  };
}

function jobsApiParams(filters) {
  const params = {
    limit: JOBS_PER_PAGE,
    offset: filters.offset,
    status: 'open',
    sort: filters.sort
  };

  if (filters.q !== '') params.search = filters.q;
  if (filters.type !== '') params.type = filters.type;
  if (filters.commitment !== '') params.commitment = filters.commitment;
  if (filters.remote) params.is_remote = 1;

  return params;
}

function jobsHref(filters, offset = null) {
  const query = new URLSearchParams();
  if (filters.q !== '') query.set('q', filters.q);
  if (filters.type !== '') query.set('type', filters.type);
  if (filters.commitment !== '') query.set('commitment', filters.commitment);
  if (filters.sort !== 'newest') query.set('sort', filters.sort);
  if (filters.remote) query.set('remote', '1');
  if (offset !== null && offset > 0) query.set('offset', offset);

  const queryString = query.toString();
  return `/jobs${queryString ? `?${queryString}` : ''}`;
}

function queryPath(path, params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      query.set(key, value);
    }
  });

  const queryString = query.toString();
  return `${path}${queryString ? `?${queryString}` : ''}`;
}

function savedJobsPath(cursor) {
  return queryPath('/saved', {
    per_page: JOBS_PER_PAGE,
    cursor: cursor || null
  });
}

function savedJobsHref(cursor) {
  return queryPath('/jobs/saved', { cursor: cursor || null });
}

function applicationFilters(query) {
  return {
    statusFilter: allowed(query.status_filter, JOB_APPLICATION_STATUSES, ''),
    cursor: trimmed(query.cursor, 500)
  };
}

function applicationsPath(filters) {
  return queryPath('/my-applications', {
    per_page: JOBS_PER_PAGE,
    status: filters.statusFilter || null,
    cursor: filters.cursor || null
  });
}

function applicationsHref(filters, cursor) {
  return queryPath('/jobs/applications', {
    status_filter: filters.statusFilter || null,
    cursor: cursor || null
  });
}

function myPostingsPath(cursor) {
  return queryPath('/my-postings', {
    per_page: JOBS_PER_PAGE,
    cursor: cursor || null
  });
}

function myPostingsHref(cursor) {
  return queryPath('/jobs/mine', { cursor: cursor || null });
}

function talentSearchFilters(query) {
  return {
    keywords: trimmed(query.keywords, 120),
    skills: trimmed(query.skills, 200),
    location: trimmed(query.location, 120),
    offset: nonNegativeInteger(query.offset)
  };
}

function talentSearchPath(filters) {
  return queryPath('/talent-search', {
    per_page: TALENT_PER_PAGE,
    offset: filters.offset,
    keywords: filters.keywords || null,
    skills: filters.skills || null,
    location: filters.location || null
  });
}

function talentSearchHref(filters, offset = null) {
  return queryPath('/jobs/talent-search', {
    keywords: filters.keywords || null,
    skills: filters.skills || null,
    location: filters.location || null,
    offset: offset !== null && offset > 0 ? offset : null
  });
}

function talentHasSearched(filters) {
  return filters.keywords !== '' || filters.skills !== '' || filters.location !== '';
}

function formatDateLong(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return trimmed(value);
  return date.toLocaleDateString(getRequestIntlLocale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function formatUtcDateParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(getRequestIntlLocale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

function formatDateOnlyLong(value) {
  if (!value) return '';
  const text = trimmed(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return formatUtcDateParts(Number(match[1]), Number(match[2]), Number(match[3])) || text;
  }

  return formatDateLong(text);
}

function formatDateOnlyShort(value) {
  const label = formatDateOnlyLong(value);
  return label.replace(/\s+\d{4}$/, '');
}

function formatMonthYear(value) {
  if (!value) return '';
  const text = trimmed(value);
  const match = text.match(/^(\d{4})-(\d{2})-\d{2}/);
  const date = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1))
    : new Date(text);

  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString(getRequestIntlLocale(), {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

function dateInputValue(value) {
  if (!value) return '';
  const text = trimmed(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : text;
}

function formatDateTimeLong(value) {
  if (!value) return '';
  const text = trimmed(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
  if (match) {
    const dateLabel = formatUtcDateParts(Number(match[1]), Number(match[2]), Number(match[3]));
    return dateLabel ? `${dateLabel}, ${match[4]}:${match[5]}` : text;
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleString(getRequestIntlLocale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function formatDateTimeMeridiem(value) {
  if (!value) return '';
  const text = trimmed(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
  if (!match) return formatDateTimeLong(text);

  const dateLabel = formatUtcDateParts(Number(match[1]), Number(match[2]), Number(match[3]));
  if (!dateLabel) return text;

  const hour = Number(match[4]);
  const displayHour = hour % 12 || 12;
  const suffix = hour < 12 ? 'am' : 'pm';

  return `${dateLabel}, ${displayHour}:${match[5]}${suffix}`;
}

function timestampForFilename(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '_',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
}

function money(value, currency) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  const amount = Number.isFinite(number)
    ? number.toLocaleString(getRequestIntlLocale(), { maximumFractionDigits: 0 })
    : trimmed(value);
  return trimmed(`${currency || ''} ${amount}`);
}

function salaryLabel(job) {
  const currency = trimmed(job.salary_currency, 10);
  const min = money(job.salary_min, currency);
  const max = money(job.salary_max, currency);
  if (min && max) return `${min} – ${max}`;
  return min || max || '';
}

function personName(value) {
  if (!value) return '';
  if (typeof value === 'string') return trimmed(value);
  if (typeof value === 'object') return trimmed(value.name || value.display_name || value.title || '');
  return '';
}

function listText(value) {
  if (Array.isArray(value)) {
    return value.map((item) => personName(item) || trimmed(item)).filter(Boolean).join(', ');
  }

  return trimmed(value, 1000);
}

function skillsFrom(job) {
  if (Array.isArray(job.skills)) {
    return job.skills.map((skill) => trimmed(skill)).filter(Boolean);
  }

  return trimmed(job.skills_required, 2000)
    .split(',')
    .map((skill) => trimmed(skill))
    .filter(Boolean);
}

function countLabel(count, singular, plural, zero) {
  if (count === 0 && zero) return zero;
  if (count === 1) return `1 ${singular}`;
  return `${count} ${plural}`;
}

function decorateJob(job) {
  const organizationName = personName(job.organization);
  const posterName = organizationName || personName(job.creator);
  const viewsCount = Math.trunc(finiteNumber(job.views_count, 0));
  const applicationsCount = Math.trunc(finiteNumber(job.applications_count, 0));

  return {
    ...job,
    id: positiveInteger(job.id) || 0,
    title: trimmed(job.title, 255) || 'Jobs',
    description: trimmed(job.description, 20000),
    typeLabel: JOB_TYPE_LABELS[job.type] || JOB_TYPE_LABELS.volunteer,
    typeTranslationKey: JOB_TYPES.includes(job.type) ? `jobs.type_${job.type}` : 'jobs.type_volunteer',
    commitmentLabel: JOB_COMMITMENT_LABELS[job.commitment] || '',
    commitmentTranslationKey: JOB_COMMITMENTS.includes(job.commitment)
      ? `jobs_t2.commitment_${job.commitment}`
      : '',
    organizationName,
    posterName,
    locationLabel: checked(job.is_remote) ? 'Remote' : trimmed(job.location, 255),
    salaryLabel: salaryLabel(job),
    deadlineLabel: formatDateLong(job.deadline),
    skillsList: skillsFrom(job),
    viewsCount,
    applicationsCount,
    viewsLabel: countLabel(viewsCount, 'view', 'views', 'No views'),
    applicationsLabel: countLabel(applicationsCount, 'application', 'applications', 'No applications'),
    isFeatured: checked(job.is_featured),
    hasApplied: checked(job.has_applied),
    isSaved: checked(job.is_saved),
    isRemote: checked(job.is_remote),
    statusLabel: JOB_POSTING_STATUS_LABELS[job.status] || trimmed(job.status) || JOB_POSTING_STATUS_LABELS.open,
    statusTranslationKey: JOB_POSTING_STATUS_LABELS[job.status]
      ? `jobs_t3.status_${job.status}`
      : 'jobs_t3.status_open'
  };
}

function decorateApplication(application) {
  const vacancy = application.vacancy || application.job || application.job_vacancy || {};
  const vacancyId = positiveInteger(vacancy.id)
    || positiveInteger(application.vacancy_id)
    || positiveInteger(application.job_id)
    || 0;
  const status = allowed(application.status, JOB_APPLICATION_STATUSES, 'applied');

  return {
    ...application,
    id: positiveInteger(application.id) || 0,
    vacancyId,
    title: trimmed(vacancy.title, 255) || 'Jobs',
    status,
    statusLabel: JOB_APPLICATION_LABELS[status] || JOB_APPLICATION_LABELS.applied,
    statusTranslationKey: `jobs_t2.app_status_${status}`,
    appliedOnLabel: formatDateLong(application.created_at || application.applied_at),
    canWithdraw: !JOB_TERMINAL_APPLICATION_STATUSES.includes(status)
  };
}

function decorateAlert(alert) {
  const keywords = trimmed(alert.keywords, 255);
  const categories = listText(alert.categories || alert.category);
  const typeLabel = JOB_TYPE_LABELS[alert.type] || '';
  const commitmentLabel = JOB_COMMITMENT_LABELS[alert.commitment] || '';
  const location = trimmed(alert.location, 255);
  const isRemoteOnly = checked(alert.is_remote_only || alert.isRemoteOnly);
  const activeValue = alert.is_active !== undefined ? alert.is_active : alert.isActive;
  const criteria = [];

  if (keywords) criteria.push(`Keywords: ${keywords}`);
  if (categories) criteria.push(`Categories: ${categories}`);
  if (typeLabel) criteria.push(`Type: ${typeLabel}`);
  if (commitmentLabel) criteria.push(`Commitment: ${commitmentLabel}`);
  if (location) criteria.push(`Location: ${location}`);
  if (isRemoteOnly) criteria.push('Remote opportunities only');
  if (criteria.length === 0) criteria.push('Any opportunity');

  return {
    ...alert,
    id: positiveInteger(alert.id) || 0,
    criteria,
    primaryCriteria: criteria[0],
    secondaryCriteria: criteria.slice(1),
    isActive: activeValue === undefined ? true : checked(activeValue)
  };
}

function vacancyTitle(row) {
  const vacancy = row.vacancy || row.job || row.job_vacancy || {};
  return trimmed(row.vacancy_title || row.job_title || vacancy.title || row.title, 255) || 'Jobs';
}

function vacancyId(row) {
  const vacancy = row.vacancy || row.job || row.job_vacancy || {};
  return positiveInteger(row.vacancy_id)
    || positiveInteger(row.job_id)
    || positiveInteger(vacancy.id)
    || 0;
}

function formatPlainNumber(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString(getRequestIntlLocale(), { maximumFractionDigits: 0 })
    : trimmed(value);
}

function jobTranslation(req, key, fallbackMessage = '', replacements = {}) {
  const requestTranslator = typeof req?.t === 'function' ? req.t : fallbackTranslator;
  const translated = requestTranslator(key, replacements);
  if (typeof translated === 'string' && translated !== '' && translated !== key) return translated;

  const english = fallbackTranslator(key, replacements);
  return typeof english === 'string' && english !== '' && english !== key ? english : fallbackMessage;
}

function offerSalaryLine(offer, req) {
  const amount = offer.salary_offered ?? offer.salary_amount ?? offer.salary;
  if (amount === null || amount === undefined || amount === '' || Number(amount) <= 0) {
    return jobTranslation(req, 'govuk_alpha_jobs.responses.salary_unspecified', 'No pay specified');
  }

  const currency = trimmed(offer.salary_currency || offer.currency || '', 10);
  const periodValue = trimmed(offer.salary_type || offer.salary_period || 'hourly');
  const periodKey = ['hourly', 'monthly', 'annual'].includes(periodValue) ? periodValue : 'hourly';
  const period = jobTranslation(req, `govuk_alpha_jobs.responses.period_${periodKey}`, periodKey);
  const amountLabel = formatPlainNumber(amount);
  return jobTranslation(req, 'govuk_alpha_jobs.responses.salary_line', `${amountLabel} ${currency} per ${period}`, {
    amount: amountLabel,
    currency,
    period
  });
}

function compactUtcTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function interviewCalendarHref(interview, req, title, typeLabel, details, duration) {
  const scheduled = new Date(interview.scheduled_at || interview.scheduled_for || '');
  if (Number.isNaN(scheduled.getTime())) return '';

  const end = new Date(scheduled.getTime() + ((duration || 30) * 60 * 1000));
  const text = jobTranslation(req, 'govuk_alpha_jobs.responses.calendar_event_title', `Interview: ${title}`, { title });
  const query = new URLSearchParams({
    action: 'TEMPLATE',
    text,
    dates: `${compactUtcTimestamp(scheduled)}/${compactUtcTimestamp(end)}`,
    details: typeLabel,
    location: details
  });
  return `https://calendar.google.com/calendar/render?${query.toString()}`;
}

function decorateInterview(interview, req) {
  const status = allowed(interview.status, JOB_INTERVIEW_STATUSES, 'proposed');
  const type = trimmed(interview.interview_type || interview.type);
  const duration = positiveInteger(interview.duration_mins || interview.duration_minutes || interview.duration);
  const typeKey = ['phone', 'in_person'].includes(type) ? type : 'video';
  const title = vacancyTitle(interview) || jobTranslation(req, 'govuk_alpha_jobs.responses.opportunity_unknown', 'An opportunity');
  const typeLabel = jobTranslation(req, `govuk_alpha_jobs.responses.type_${typeKey}`, typeKey);
  const details = trimmed(interview.location_notes || interview.details || interview.notes || interview.message, 2000);

  return {
    ...interview,
    id: positiveInteger(interview.id) || 0,
    vacancyId: vacancyId(interview),
    title,
    typeLabel,
    status,
    statusKey: `govuk_alpha_jobs.responses.interview_status_${status}`,
    tagClass: status === 'accepted' ? 'govuk-tag--green' : (status === 'declined' ? 'govuk-tag--grey' : 'govuk-tag--yellow'),
    scheduledLabel: formatDateTimeLong(interview.scheduled_at || interview.scheduled_for),
    duration,
    details,
    calendarHref: interviewCalendarHref(interview, req, title, typeLabel, details, duration),
    canRespond: status === 'proposed'
  };
}

function decorateOffer(offer, req) {
  const status = allowed(offer.status, JOB_OFFER_STATUSES, 'pending');
  const expiresValue = offer.expires_at || offer.respond_by || offer.response_due_at;
  const expiresAt = expiresValue ? new Date(expiresValue) : null;
  const isExpired = status === 'pending' && expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now();
  const effectiveStatus = isExpired ? 'expired' : status;

  return {
    ...offer,
    id: positiveInteger(offer.id) || 0,
    vacancyId: vacancyId(offer),
    title: vacancyTitle(offer) || jobTranslation(req, 'govuk_alpha_jobs.responses.opportunity_unknown', 'An opportunity'),
    status,
    effectiveStatus,
    statusKey: `govuk_alpha_jobs.responses.offer_status_${effectiveStatus}`,
    tagClass: effectiveStatus === 'accepted' ? 'govuk-tag--green' : (['rejected', 'withdrawn', 'expired'].includes(effectiveStatus) ? 'govuk-tag--grey' : 'govuk-tag--yellow'),
    salaryLine: offerSalaryLine(offer, req),
    startLabel: formatDateOnlyLong(offer.start_date || offer.starts_at),
    expiresLabel: formatDateOnlyLong(expiresValue),
    messageText: trimmed(offer.message || offer.employer_message || offer.notes, 5000),
    canRespond: status === 'pending' && !isExpired
  };
}

function jobFormForEdit(job) {
  return {
    ...job,
    deadline: dateInputValue(job.deadline),
    is_remote: checked(job.is_remote || job.isRemote),
    salary_negotiable: checked(job.salary_negotiable || job.salaryNegotiable)
  };
}

function profileUserId(result) {
  const data = dataFrom(result);
  const profile = data && typeof data === 'object' && !Array.isArray(data) ? data : result;

  return positiveInteger(profile?.id || profile?.user_id || profile?.userId);
}

function jobOwnerId(job) {
  return positiveInteger(job.user_id || job.userId || job.creator?.id || job.owner?.id);
}

function analyticsFrom(result) {
  const data = dataFrom(result);
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data;
  }

  return null;
}

function analyticsSeries(rows, labelKey, labelFormatter = null) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const labelValue = row[labelKey];
    const label = labelFormatter ? labelFormatter(labelValue) : trimmed(labelValue);

    return {
      ...row,
      label: label || trimmed(labelValue) || 'Unknown',
      count: finiteNumber(row.count, 0)
    };
  });
}

function decorateAnalytics(result, req) {
  const analytics = analyticsFrom(result);
  if (!analytics) return null;

  const hasReferralStats = analytics.referral_stats && typeof analytics.referral_stats === 'object';
  const referralStats = hasReferralStats
    ? analytics.referral_stats
    : {};
  const totalApplications = finiteNumber(analytics.total_applications, 0);
  const viewsByDay = analyticsSeries(analytics.views_by_day, 'date', formatDateOnlyShort);
  const weeklyTrend = analyticsSeries(analytics.weekly_trend, 'week');
  const applicationsByStage = (Array.isArray(analytics.applications_by_stage) ? analytics.applications_by_stage : []).map((row) => {
    const stage = trimmed(row.stage) || 'applied';
    const count = finiteNumber(row.count, 0);
    const percentage = totalApplications > 0 ? Math.round((count / totalApplications) * 100) : 0;

    return {
      ...row,
      stage,
      label: translateStatusMessage(
        req,
        `govuk_alpha_jobs.stage.${stage}`,
        JOB_PIPELINE_LABELS[stage] || JOB_APPLICATION_LABELS[stage] || statusTitle(stage)
      ),
      count,
      percentage
    };
  });

  return {
    ...analytics,
    totalViews: finiteNumber(analytics.total_views, 0),
    totalViewsLabel: formatPlainNumber(analytics.total_views),
    uniqueViewers: finiteNumber(analytics.unique_viewers, 0),
    uniqueViewersLabel: formatPlainNumber(analytics.unique_viewers),
    totalApplications,
    totalApplicationsLabel: formatPlainNumber(totalApplications),
    conversionRate: finiteNumber(analytics.conversion_rate, 0),
    averageTimeToApplyHours: analytics.avg_time_to_apply_hours === null || analytics.avg_time_to_apply_hours === undefined
      ? null
      : finiteNumber(analytics.avg_time_to_apply_hours, 0),
    timeToFillDays: analytics.time_to_fill_days === null || analytics.time_to_fill_days === undefined
      ? null
      : finiteNumber(analytics.time_to_fill_days, 0),
    viewsByDay,
    maxViews: Math.max(1, ...viewsByDay.map((row) => row.count)),
    weeklyTrend,
    maxWeekly: Math.max(1, ...weeklyTrend.map((row) => row.count)),
    applicationsByStage,
    referralStats: hasReferralStats ? {
      totalShares: finiteNumber(referralStats.total_shares, 0),
      totalSharesLabel: formatPlainNumber(referralStats.total_shares),
      referralApplications: finiteNumber(referralStats.referral_applications, 0),
      referralApplicationsLabel: formatPlainNumber(referralStats.referral_applications),
      referralConversionPct: finiteNumber(referralStats.referral_conversion_pct, 0)
    } : null,
    scorecardAverage: analytics.scorecard_avg === null || analytics.scorecard_avg === undefined
      ? null
      : finiteNumber(analytics.scorecard_avg, 0)
  };
}

function objectFrom(result) {
  const data = dataFrom(result);
  return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
}

function predictionAboveAverage(value) {
  if (value.above_average !== undefined || value.aboveAverage !== undefined) {
    return checked(value.above_average ?? value.aboveAverage);
  }

  const label = trimmed(value.label || value.comparison_label || value.comparisonLabel).toLowerCase();
  return label.includes('above');
}

function decoratePredictions(result) {
  const predictions = objectFrom(result);
  if (!predictions) return null;

  const expectedApplications = predictions.expected_applications && typeof predictions.expected_applications === 'object'
    ? predictions.expected_applications
    : {};
  const estimatedTimeToFill = predictions.estimated_time_to_fill && typeof predictions.estimated_time_to_fill === 'object'
    ? predictions.estimated_time_to_fill
    : {};
  const conversionRate = predictions.conversion_rate && typeof predictions.conversion_rate === 'object'
    ? predictions.conversion_rate
    : {};
  const salaryComparison = predictions.salary_comparison && typeof predictions.salary_comparison === 'object'
    ? predictions.salary_comparison
    : null;

  return {
    ...predictions,
    similarJobsAnalyzed: finiteNumber(predictions.similar_jobs_analyzed ?? predictions.similarJobsAnalyzed, 0),
    expectedApplications: {
      value: finiteNumber(expectedApplications.value, 0),
      current: finiteNumber(expectedApplications.current, 0),
      aboveAverage: predictionAboveAverage(expectedApplications)
    },
    estimatedTimeToFill: {
      value: estimatedTimeToFill.value === null || estimatedTimeToFill.value === undefined
        ? null
        : finiteNumber(estimatedTimeToFill.value, 0),
      daysPosted: finiteNumber(estimatedTimeToFill.days_posted, 0)
    },
    conversionRate: {
      yours: finiteNumber(conversionRate.yours, 0),
      average: finiteNumber(conversionRate.average, 0),
      aboveAverage: predictionAboveAverage(conversionRate)
    },
    salaryComparison: salaryComparison ? {
      yourSalary: formatPlainNumber(salaryComparison.your_salary),
      marketAverage: formatPlainNumber(salaryComparison.market_avg),
      diffPercent: finiteNumber(salaryComparison.diff_percent, 0)
    } : null
  };
}

function decorateApplicant(application, req = null, anonymousKey = 'govuk_alpha_jobs.shared.anonymous') {
  const applicant = application.applicant || application.user || {};
  const status = allowed(application.stage || application.status, JOB_APPLICANT_STAGE_OPTIONS, 'applied');

  return {
    ...application,
    id: positiveInteger(application.id) || 0,
    applicantName: personName(applicant) || translateStatusMessage(
      req,
      anonymousKey,
      'Anonymous candidate'
    ),
    status,
    statusLabel: translateStatusMessage(
      req,
      `jobs_t2.app_status_${status}`,
      JOB_APPLICATION_LABELS[status] || statusTitle(status)
    ),
    appliedOnLabel: formatDateOnlyLong(application.created_at || application.applied_at),
    coverLetter: trimmed(application.message || application.cover_letter || application.notes, 5000),
    cvFilename: trimmed(application.cv_filename || application.cvFilename, 255)
  };
}

function groupPipeline(applications, req) {
  const grouped = new Map();
  JOB_PIPELINE_COLUMNS.forEach((stage) => grouped.set(stage, []));

  applications.forEach((application) => {
    const target = JOB_PIPELINE_COLUMNS.includes(application.status) ? application.status : 'other';
    if (!grouped.has(target)) grouped.set(target, []);
    grouped.get(target).push(application);
  });

  return Array.from(grouped.entries())
    .filter(([stage, rows]) => stage !== 'other' || rows.length > 0)
    .map(([stage, rows]) => ({
      stage,
      label: translateStatusMessage(
        req,
        `govuk_alpha_jobs.pipeline.column_${stage}`,
        JOB_PIPELINE_LABELS[stage] || statusTitle(stage) || 'Other'
      ),
      applications: rows,
      count: rows.length
    }));
}

function decorateQualification(result, req) {
  const qualification = objectFrom(result);
  if (!qualification) return null;

  const level = trimmed(qualification.level);
  const totalRequired = finiteNumber(qualification.total_required, 0);
  const totalMatched = finiteNumber(qualification.total_matched, 0);

  return {
    ...qualification,
    jobId: positiveInteger(qualification.job_id || qualification.jobId) || 0,
    jobTitle: trimmed(qualification.job_title || qualification.jobTitle, 255) || 'Opportunity',
    percentage: finiteNumber(qualification.percentage, 0),
    level,
    levelLabel: translateStatusMessage(
      req,
      `govuk_alpha_jobs.qualification.level_${level || 'low'}`,
      JOB_QUALIFICATION_LABELS[level] || JOB_QUALIFICATION_LABELS.low
    ),
    levelTagClass: level === 'excellent'
      ? 'govuk-tag--green'
      : level === 'good'
        ? 'govuk-tag--turquoise'
        : level === 'moderate'
          ? 'govuk-tag--yellow'
          : 'govuk-tag--grey',
    totalRequired,
    totalMatched,
    skillsMatchedLabel: `${totalMatched} of ${totalRequired} skills matched`,
    breakdown: (Array.isArray(qualification.breakdown) ? qualification.breakdown : []).map((row) => ({
      skill: trimmed(row.skill, 255),
      matched: checked(row.matched)
    })).filter((row) => row.skill),
    dimensions: (Array.isArray(qualification.dimensions) ? qualification.dimensions : []).map((row) => ({
      label: trimmed(row.label, 255),
      score: finiteNumber(row.score, 0),
      detail: trimmed(row.detail, 1000)
    })).filter((row) => row.label),
    aiSummary: trimmed(qualification.ai_summary || qualification.aiSummary, 5000)
  };
}

function candidateSkills(value) {
  if (Array.isArray(value)) {
    return value.map((skill) => personName(skill) || trimmed(skill)).filter(Boolean);
  }

  return trimmed(value, 2000)
    .split(',')
    .map((skill) => trimmed(skill))
    .filter(Boolean);
}

function candidateInitial(name) {
  return (trimmed(name).charAt(0) || 'A').toUpperCase();
}

function decorateCandidate(candidate, req) {
  const name = trimmed(candidate.name || candidate.display_name || candidate.full_name, 255)
    || translateStatusMessage(req, 'govuk_alpha_jobs.shared.anonymous', 'Anonymous candidate');
  const skills = candidateSkills(candidate.skills);

  return {
    ...candidate,
    id: positiveInteger(candidate.id) || 0,
    name,
    initial: candidateInitial(name),
    headline: trimmed(candidate.headline || candidate.resume_headline, 255)
      || translateStatusMessage(req, 'govuk_alpha_jobs.talent.headline_none', 'No headline provided'),
    location: trimmed(candidate.location, 255),
    avatarUrl: trimmed(candidate.avatar_url || candidate.avatarUrl, 1000),
    skills,
    skillsPreview: skills.slice(0, 6),
    lastActiveLabel: formatDateOnlyLong(candidate.last_active || candidate.lastActive),
    memberSinceLabel: formatMonthYear(candidate.member_since || candidate.memberSince || candidate.created_at),
    summary: trimmed(candidate.summary, 5000),
    bio: trimmed(candidate.bio, 5000)
  };
}

function talentSearchMeta(result, filters, itemCount) {
  const data = dataFrom(result);
  const source = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const meta = source.meta && typeof source.meta === 'object' ? source.meta : {};
  const total = finiteNumber(meta.total ?? source.total, itemCount);
  const perPage = finiteNumber(meta.per_page ?? meta.limit ?? source.per_page ?? source.limit, TALENT_PER_PAGE);
  const offset = finiteNumber(meta.offset ?? source.offset, filters.offset);
  const hasMore = Boolean(meta.has_more ?? source.has_more ?? ((offset + perPage) < total));

  return {
    total,
    perPage,
    offset,
    hasMore,
    resultsLabel: countLabel(total, 'candidate found', 'candidates found', 'No candidates found'),
    nextHref: hasMore ? talentSearchHref(filters, offset + perPage) : ''
  };
}

function employerName(user) {
  const first = trimmed(user.first_name || user.firstName, 120);
  const last = trimmed(user.last_name || user.lastName, 120);
  return trimmed(user.name || user.display_name || user.displayName || `${first} ${last}`, 255);
}

function decorateEmployer(result, employerId) {
  const user = objectFrom(result);
  if (!user) return null;

  const name = employerName(user) || 'Employer profile';

  return {
    ...user,
    id: positiveInteger(user.id) || employerId,
    name,
    initial: candidateInitial(name),
    avatarUrl: trimmed(user.avatar_url || user.avatarUrl, 1000),
    headline: trimmed(user.resume_headline || user.headline, 255),
    bio: trimmed(user.bio, 5000),
    location: trimmed(user.location, 255),
    memberSinceLabel: formatMonthYear(user.member_since || user.memberSince || user.created_at)
  };
}

function reviewRowsFrom(result) {
  const data = objectFrom(result) || {};
  const rows = Array.isArray(data.reviews) ? data.reviews : collectionItems(result);

  return rows.map((review) => ({
    ...review,
    id: positiveInteger(review.id) || 0,
    rating: finiteNumber(review.rating, 0),
    comment: trimmed(review.comment, 5000),
    reviewerName: personName(review.reviewer) || trimmed(review.reviewer_name || review.reviewerName, 255),
    createdLabel: formatDateOnlyLong(review.created_at || review.createdAt),
    dimensions: review.dimensions && typeof review.dimensions === 'object' ? review.dimensions : {}
  }));
}

function dimensionAverages(reviews) {
  const totals = {};
  const counts = {};

  reviews.forEach((review) => {
    Object.entries(review.dimensions || {}).forEach(([key, value]) => {
      const score = Number(value);
      if (!Number.isFinite(score)) return;
      totals[key] = (totals[key] || 0) + score;
      counts[key] = (counts[key] || 0) + 1;
    });
  });

  return Object.fromEntries(Object.keys(totals).map((key) => [key, totals[key] / counts[key]]));
}

function decorateReviewStats(result, reviews) {
  const data = objectFrom(result) || {};
  const stats = data.stats && typeof data.stats === 'object' ? data.stats : {};
  const total = finiteNumber(stats.total_reviews ?? stats.totalReviews, reviews.length);
  const average = stats.average_rating ?? stats.averageRating;
  const dimensions = stats.dimensions && typeof stats.dimensions === 'object'
    ? stats.dimensions
    : dimensionAverages(reviews);

  return {
    averageRating: average === null || average === undefined ? null : finiteNumber(average, 0),
    totalReviews: total,
    reviewsLabel: countLabel(total, 'review', 'reviews', 'No reviews yet'),
    dimensionRows: Object.entries(dimensions).map(([key, value]) => ({
      key,
      label: JOB_REVIEW_DIMENSION_LABELS[key] || statusTitle(key),
      labelKey: `govuk_alpha_jobs.employer.dimension_${key}`,
      score: finiteNumber(value, 0)
    })).filter((row) => row.label)
  };
}

function employerOpenJobsMeta(result, openJobs) {
  const meta = collectionMeta(result, { offset: 0 });
  const total = finiteNumber(meta.total, openJobs.length);

  return {
    total,
    countLabel: countLabel(total, 'open opportunity', 'open opportunities', 'No open opportunities')
  };
}

function onboardingHasPosted(result) {
  const meta = collectionMeta(result, { offset: 0 });
  return collectionItems(result).length > 0 || meta.total > 0;
}

function dateFilter(value) {
  const text = trimmed(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function biasAuditFilters(query) {
  return {
    from: dateFilter(query.from),
    to: dateFilter(query.to),
    jobId: positiveInteger(query.job_id)
  };
}

function biasAuditPath(filters) {
  return queryPath('/bias-audit', {
    job_id: filters.jobId || null,
    date_from: filters.from || null,
    date_to: filters.to || null
  });
}

function formatDecimal(value, maximumFractionDigits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return trimmed(value);

  return number.toLocaleString(getRequestIntlLocale(), {
    maximumFractionDigits,
    minimumFractionDigits: 0
  });
}

function percentLabel(value) {
  return `${formatDecimal(value, 1)}%`;
}

function dateRangeLabel(req, from, to) {
  const fromLabel = formatDateOnlyLong(from);
  const toLabel = formatDateOnlyLong(to);
  if (fromLabel && toLabel) {
    return translateStatusMessage(
      req,
      'govuk_alpha_jobs.bias_audit.period_label',
      `Period: ${fromLabel} to ${toLabel}`
    ).replace(':from', fromLabel).replace(':to', toLabel);
  }
  if (fromLabel) return `From ${fromLabel}`;
  if (toLabel) return `To ${toLabel}`;
  return '';
}

function orderedKeys(source, preferred) {
  const keys = source && typeof source === 'object' ? Object.keys(source) : [];
  return [
    ...preferred.filter((key) => keys.includes(key)),
    ...keys.filter((key) => !preferred.includes(key))
  ];
}

function biasStageLabel(req, stage) {
  return translateStatusMessage(
    req,
    `govuk_alpha_jobs.stage.${stage}`,
    JOB_PIPELINE_LABELS[stage] || JOB_APPLICATION_LABELS[stage] || statusTitle(stage) || 'Other'
  );
}

function decorateBiasReport(result, req) {
  const report = objectFrom(result);
  if (!report) return null;

  const totalApplications = finiteNumber(report.total_applications ?? report.totalApplications, 0);
  const period = report.period && typeof report.period === 'object' ? report.period : {};
  const funnel = report.funnel && typeof report.funnel === 'object' ? report.funnel : {};
  const rejectionRates = report.rejection_rates && typeof report.rejection_rates === 'object' ? report.rejection_rates : {};
  const avgTime = report.avg_time_in_stage && typeof report.avg_time_in_stage === 'object' ? report.avg_time_in_stage : {};
  const outcomes = report.skills_match_correlation && typeof report.skills_match_correlation === 'object'
    ? report.skills_match_correlation
    : {};
  const sources = report.source_effectiveness && typeof report.source_effectiveness === 'object'
    ? report.source_effectiveness
    : {};
  const stageOrder = [...APPLICATION_STATUSES, 'other'];

  return {
    totalApplications,
    totalApplicationsLabel: formatPlainNumber(totalApplications),
    hiringVelocityLabel: report.hiring_velocity_days === null || report.hiring_velocity_days === undefined
      ? ''
      : `${formatDecimal(report.hiring_velocity_days, 1)} ${translateStatusMessage(req, 'govuk_alpha_jobs.bias_audit.days', 'days')}`,
    periodLabel: dateRangeLabel(req, period.from, period.to),
    funnelRows: orderedKeys(funnel, stageOrder).map((stage) => {
      const count = finiteNumber(funnel[stage], 0);
      return {
        stage,
        label: biasStageLabel(req, stage),
        count,
        countLabel: formatPlainNumber(count),
        percentLabel: percentLabel(totalApplications > 0 ? (count / totalApplications) * 100 : 0)
      };
    }),
    rejectionRows: orderedKeys(rejectionRates, stageOrder).map((stage) => {
      const row = rejectionRates[stage] && typeof rejectionRates[stage] === 'object' ? rejectionRates[stage] : {};
      return {
        stage,
        label: biasStageLabel(req, stage),
        entered: finiteNumber(row.total, 0),
        rejected: finiteNumber(row.rejected, 0),
        rateLabel: percentLabel(finiteNumber(row.rate, 0))
      };
    }),
    timeRows: orderedKeys(avgTime, stageOrder).map((stage) => ({
      stage,
      label: biasStageLabel(req, stage),
      daysLabel: `${formatDecimal(avgTime[stage], 1)} ${translateStatusMessage(req, 'govuk_alpha_jobs.bias_audit.days', 'days')}`
    })),
    outcomeRows: [
      {
        label: biasStageLabel(req, 'accepted'),
        count: finiteNumber(outcomes.accepted_count ?? outcomes.acceptedCount, 0),
        proportionLabel: percentLabel(finiteNumber(outcomes.accepted_avg ?? outcomes.acceptedAvg, 0) * 100)
      },
      {
        label: biasStageLabel(req, 'rejected'),
        count: finiteNumber(outcomes.rejected_count ?? outcomes.rejectedCount, 0),
        proportionLabel: percentLabel(finiteNumber(outcomes.rejected_avg ?? outcomes.rejectedAvg, 0) * 100)
      }
    ],
    sourceRows: orderedKeys(sources, ['direct', 'referral']).map((source) => {
      const row = sources[source] && typeof sources[source] === 'object' ? sources[source] : {};
      return {
        source,
        label: translateStatusMessage(
          req,
          `govuk_alpha_jobs.bias_audit.source_${source}`,
          JOB_BIAS_SOURCE_LABELS[source] || statusTitle(source)
        ),
        applications: finiteNumber(row.applications, 0),
        accepted: finiteNumber(row.accepted, 0),
        rateLabel: percentLabel(finiteNumber(row.rate, 0))
      };
    })
  };
}

function statusTitle(value) {
  const text = trimmed(value);
  if (!text) return '';

  return text
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(' ');
}

function decorateApplicationHistory(entry, req) {
  const toStatus = trimmed(entry.to_status || entry.toStatus);
  const fromStatus = trimmed(entry.from_status || entry.fromStatus);
  const changedByName = trimmed(entry.changed_by_name || entry.changedByName);

  return {
    ...entry,
    id: positiveInteger(entry.id) || 0,
    statusLabel: toStatus
      ? translateStatusMessage(
        req,
        `jobs_t2.app_status_${toStatus}`,
        JOB_APPLICATION_LABELS[toStatus] || statusTitle(toStatus)
      )
      : translateStatusMessage(req, 'govuk_alpha_jobs.history.status_unknown', 'Updated'),
    fromLabel: fromStatus
      ? translateStatusMessage(req, 'govuk_alpha_jobs.history.from', `from ${statusTitle(fromStatus)}`)
        .replace(
          ':status',
          translateStatusMessage(
            req,
            `jobs_t2.app_status_${fromStatus}`,
            JOB_APPLICATION_LABELS[fromStatus] || statusTitle(fromStatus)
          )
        )
      : '',
    changedAtLabel: formatDateTimeMeridiem(entry.changed_at || entry.changedAt),
    changedByLabel: changedByName
      ? translateStatusMessage(req, 'govuk_alpha_jobs.history.by', `by ${changedByName}`)
        .replace(':name', changedByName)
      : '',
    notesText: trimmed(entry.notes, 5000)
  };
}

function translateStatusMessage(req, key, fallbackMessage = '') {
  if (!key) return fallbackMessage;

  const requestTranslator = typeof req?.t === 'function' ? req.t : fallbackTranslator;
  const translated = requestTranslator(key);
  if (typeof translated === 'string' && translated !== '' && translated !== key) return translated;

  const english = fallbackTranslator(key);
  return typeof english === 'string' && english !== '' && english !== key ? english : fallbackMessage;
}

function localizedStatusMessage(req, status, messages, messageKeys) {
  const fallbackMessage = messages[status] || '';
  if (!fallbackMessage) return '';

  return translateStatusMessage(req, messageKeys[status], fallbackMessage);
}

function statusMessage(req, status) {
  return localizedStatusMessage(req, status, JOB_STATUS_MESSAGES, JOB_STATUS_MESSAGE_KEYS);
}

function statusErrorMessage(req, status) {
  return localizedStatusMessage(req, status, JOB_STATUS_ERROR_MESSAGES, JOB_STATUS_ERROR_MESSAGE_KEYS);
}

function applicationErrorMessage(req, status) {
  return localizedStatusMessage(
    req,
    status,
    JOB_APPLICATION_ERROR_MESSAGES,
    JOB_APPLICATION_ERROR_MESSAGE_KEYS
  );
}

function actionErrorMessage(req, status) {
  return localizedStatusMessage(req, status, JOB_ACTION_ERROR_MESSAGES, JOB_ACTION_ERROR_MESSAGE_KEYS);
}

function formErrors(req, status) {
  const message = localizedStatusMessage(req, status, JOB_FORM_ERROR_MESSAGES, JOB_FORM_ERROR_MESSAGE_KEYS);
  return message ? [{ text: message, href: '#title' }] : [];
}

function apiJobFormErrors(error, fallback) {
  if (!(error instanceof ApiError) || !Array.isArray(error.data?.errors)) {
    return [];
  }

  const errors = error.data.errors
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const field = trimmed(entry.field);
      return {
        text: trimmed(entry.message) || fallback,
        ...(JOB_FORM_FIELDS.has(field) ? { href: `#${field}` } : {})
      };
    });

  return errors;
}

function alertSuccessMessage(req, status) {
  return localizedStatusMessage(req, status, JOB_ALERT_SUCCESS_MESSAGES, JOB_ALERT_MESSAGE_KEYS);
}

function alertErrorMessage(req, status) {
  return localizedStatusMessage(req, status, JOB_ALERT_ERROR_MESSAGES, JOB_ALERT_MESSAGE_KEYS);
}

function responseSuccessMessage(req, status) {
  return localizedStatusMessage(req, status, JOB_RESPONSE_SUCCESS_MESSAGES, JOB_RESPONSE_MESSAGE_KEYS);
}

function responseErrorMessage(req, status) {
  return localizedStatusMessage(req, status, JOB_RESPONSE_ERROR_MESSAGES, JOB_RESPONSE_MESSAGE_KEYS);
}

function applicantSuccessMessage(req, status) {
  return localizedStatusMessage(req, status, JOB_APPLICANT_SUCCESS_MESSAGES, JOB_APPLICANT_MESSAGE_KEYS);
}

function applicantErrorMessage(req, status) {
  return localizedStatusMessage(req, status, JOB_APPLICANT_ERROR_MESSAGES, JOB_APPLICANT_MESSAGE_KEYS);
}

function pipelineSuccessMessage(req, status) {
  return localizedStatusMessage(req, status, JOB_PIPELINE_SUCCESS_MESSAGES, JOB_PIPELINE_MESSAGE_KEYS);
}

function pipelineErrorMessage(req, status) {
  return localizedStatusMessage(req, status, JOB_PIPELINE_ERROR_MESSAGES, JOB_PIPELINE_MESSAGE_KEYS);
}

function resultId(result) {
  const data = dataFrom(result);
  if (!data || typeof data !== 'object') return null;

  return positiveInteger(data.id) || positiveInteger(data.job && data.job.id);
}

function statusRedirect(path, status) {
  return `${path}?status=${encodeURIComponent(status)}`;
}

function jobRedirect(id, status) {
  return statusRedirect(`/jobs/${id}`, status);
}

function bookmarkRedirect(id, from, status) {
  return statusRedirect(from === 'saved' ? '/jobs/saved' : `/jobs/${id}`, status);
}

function jobFormValues(body = {}) {
  return {
    title: trimmed(body.title, 255),
    description: trimmed(body.description, 20000),
    type: allowed(body.type, JOB_TYPES, 'volunteer'),
    commitment: allowed(body.commitment, JOB_COMMITMENTS, 'flexible'),
    category: trimmed(body.category, 255),
    location: trimmed(body.location, 255),
    is_remote: checkedOne(body.is_remote),
    skills_required: trimmed(body.skills_required, 2000),
    hours_per_week: trimmed(body.hours_per_week, 100),
    time_credits: trimmed(body.time_credits, 100),
    deadline: trimmed(body.deadline, 20),
    salary_min: trimmed(body.salary_min, 100),
    salary_max: trimmed(body.salary_max, 100),
    salary_currency: trimmed(body.salary_currency, 10),
    salary_type: allowed(body.salary_type, JOB_SALARY_TYPES, ''),
    salary_negotiable: checkedOne(body.salary_negotiable),
    contact_email: trimmed(body.contact_email, 255),
    status: allowed(body.status, JOB_STATUSES, 'open')
  };
}

function jobFormPayload(body) {
  const values = jobFormValues(body);
  return values.title === '' ? null : values;
}

function rememberJobForm(req, body, errors = []) {
  if (typeof req.flash !== 'function') return;
  req.flash('jobFormValues', jobFormValues(body));
  if (errors.length > 0) req.flash('jobFormErrors', errors);
}

function recalledJobForm(req) {
  if (typeof req.flash !== 'function') return {};
  const values = req.flash('jobFormValues');
  return values.length > 0 && values[0] && typeof values[0] === 'object' ? values[0] : {};
}

function recalledJobFormErrors(req) {
  if (typeof req.flash !== 'function') return [];
  const errors = req.flash('jobFormErrors');
  if (errors.length > 0 && Array.isArray(errors[0])) return errors[0];
  return errors.filter((error) => error && typeof error === 'object' && trimmed(error.text));
}

function rememberJobApplication(req, jobId, body) {
  if (typeof req.flash !== 'function') return;
  req.flash('jobApplicationValues', {
    jobId,
    cover_letter: trimmed(body && body.cover_letter, 5000)
  });
}

function recalledJobApplication(req, jobId) {
  if (typeof req.flash !== 'function') return {};
  const values = req.flash('jobApplicationValues');
  const value = values.length > 0 && values[0] && typeof values[0] === 'object' ? values[0] : {};
  return Number(value.jobId) === Number(jobId) ? value : {};
}

function jobCvErrorStatus(file) {
  if (!file) return '';
  if (Number(file.size) > JOB_CV_MAX_BYTES) return 'cv-too-large';
  const filename = trimmed(file.originalFilename || file.newFilename, 255).toLowerCase();
  const dot = filename.lastIndexOf('.');
  return JOB_CV_EXTENSIONS.has(dot >= 0 ? filename.slice(dot) : '') ? '' : 'cv-invalid';
}

function applicationStatusPayload(body) {
  return {
    status: allowed(body.app_status, APPLICATION_STATUSES, 'pending'),
    notes: trimmed(body.notes, 5000)
  };
}

function alertPayload(body) {
  return {
    keywords: trimmed(body.keywords, 255),
    categories: trimmed(body.categories, 1000),
    type: allowed(body.type, JOB_TYPES, ''),
    commitment: allowed(body.commitment, JOB_COMMITMENTS, ''),
    location: trimmed(body.location, 255),
    is_remote_only: checkedOne(body.is_remote_only)
  };
}

function notePayload(body) {
  return { notes: trimmed(body.note, 1000) };
}

router.get('/', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const filters = jobFilters(req.query);
  const params = jobsApiParams(filters);
  let result = null;

  try {
    result = await getJobs(token, params);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  const jobs = collectionItems(result).map(decorateJob);
  const jobsMeta = collectionMeta(result, filters);
  const nextOffset = jobsMeta.offset + jobsMeta.per_page;

  return res.render('jobs/index', {
    title: 'Jobs',
    titleKey: 'jobs.title',
    activeNav: 'explore',
    jobs,
    filters,
    jobsMeta,
    nextHref: jobsMeta.has_more ? jobsHref(filters, nextOffset) : '',
    status: req.query.status || '',
    successMessage: statusMessage(req, req.query.status)
  });
}));

router.get('/saved', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const cursor = trimmed(req.query.cursor, 500);
  let result = null;

  try {
    result = await callJob(token, 'GET', savedJobsPath(cursor));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  const jobs = collectionItems(result).map(decorateJob);
  const jobsMeta = collectionMeta(result, { offset: 0 });

  return res.render('jobs/saved', {
    title: 'Saved opportunities',
    titleKey: 'jobs_t2.saved_title',
    activeNav: 'explore',
    jobs,
    jobsMeta,
    nextHref: jobsMeta.has_more && jobsMeta.cursor ? savedJobsHref(jobsMeta.cursor) : '',
    status: req.query.status || '',
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.get('/applications', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const filters = applicationFilters(req.query);
  let result = null;

  try {
    result = await callJob(token, 'GET', applicationsPath(filters));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  const applications = collectionItems(result).map(decorateApplication);
  const jobsMeta = collectionMeta(result, { offset: 0 });

  return res.render('jobs/applications', {
    title: 'My applications',
    titleKey: 'jobs_t2.applications_title',
    activeNav: 'explore',
    applications,
    filters,
    statusOptions: JOB_APPLICATION_STATUSES.filter((status) => status !== 'shortlisted').map((status) => ({
      value: status,
      label: JOB_APPLICATION_LABELS[status] || status
    })),
    jobsMeta,
    nextHref: jobsMeta.has_more && jobsMeta.cursor ? applicationsHref(filters, jobsMeta.cursor) : '',
    status: req.query.status || '',
    successMessage: statusMessage(req, req.query.status),
    errorMessage: applicationErrorMessage(req, req.query.status),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.get('/applications/:appId(\\d+)/history', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const appId = Number(req.params.appId);
  let result = null;
  let applicationsResult = null;

  try {
    result = await callJob(token, 'GET', `/applications/${appId}/history`);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
      return res.status(404).render('errors/404', { title: 'Page not found' });
    }

    return res.status(503).render('errors/503', { title: 'Service unavailable' });
  }

  try {
    applicationsResult = await callJob(token, 'GET', '/my-applications?per_page=100');
  } catch {
    // History is still renderable with the tenant-name caption when the
    // secondary vacancy-title lookup is unavailable.
  }

  const application = collectionItems(applicationsResult)
    .find((row) => positiveInteger(row.id) === appId);

  return res.render('jobs/application-history', {
    title: 'Application timeline',
    titleKey: 'govuk_alpha_jobs.history.title',
    activeNav: 'explore',
    applicationId: appId,
    vacancyTitle: application ? vacancyTitle(application) : '',
    history: collectionItems(result).map((entry) => decorateApplicationHistory(entry, req))
  });
}));

router.get('/applications/:appId(\\d+)/cv', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const appId = Number(req.params.appId);
  let download;

  try {
    download = await callJobDownload(token, `/applications/${appId}/cv`);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && error.status === 403) {
      return res.status(403).render('errors/403', { title: 'Forbidden' });
    }
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: 'Page not found' });
    }
    if (error instanceof ApiError && error.status === 429) {
      return res.status(429).render('errors/429', { title: 'Too many requests' });
    }

    return res.status(503).render('errors/503', { title: 'Service unavailable' });
  }

  applyDownloadHeaders(res, download.headers);
  return res.send(Buffer.isBuffer(download.body) ? download.body : Buffer.from(download.body || ''));
}));

router.get('/mine', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const cursor = trimmed(req.query.cursor, 500);
  let result = null;

  try {
    result = await callJob(token, 'GET', myPostingsPath(cursor));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  const jobs = collectionItems(result).map(decorateJob);
  const jobsMeta = collectionMeta(result, { offset: 0 });

  return res.render('jobs/mine', {
    title: 'My postings',
    titleKey: 'jobs_t3.mine_title',
    activeNav: 'explore',
    jobs,
    jobsMeta,
    nextHref: jobsMeta.has_more && jobsMeta.cursor ? myPostingsHref(jobsMeta.cursor) : '',
    status: req.query.status || '',
    successMessage: statusMessage(req, req.query.status),
    errorMessage: statusErrorMessage(req, req.query.status),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.get('/create', (req, res) => {
  const rememberedErrors = recalledJobFormErrors(req);
  return res.render('jobs/form', {
    title: 'Post an opportunity',
    titleKey: 'jobs_t3.create_title',
    activeNav: 'explore',
    formMode: 'create',
    formAction: '/jobs',
    jobForm: recalledJobForm(req),
    jobFormErrors: rememberedErrors.length > 0 ? rememberedErrors : formErrors(req, req.query.status),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
});

router.get('/alerts', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  let result = null;
  let loadError = false;

  try {
    result = await callJob(token, 'GET', '/alerts');
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = true;
  }

  return res.render('jobs/alerts', {
    title: 'Job alerts',
    titleKey: 'jobs_t4.title',
    activeNav: 'explore',
    alerts: collectionItems(result).map(decorateAlert),
    status: req.query.status || '',
    successMessage: alertSuccessMessage(req, req.query.status),
    errorMessage: alertErrorMessage(req, req.query.status),
    loadError,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.get('/responses', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  let interviewsResult = null;
  let offersResult = null;
  let loadError = false;

  try {
    interviewsResult = await callJob(token, 'GET', '/my-interviews');
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = true;
  }

  try {
    offersResult = await callJob(token, 'GET', '/my-offers');
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = true;
  }

  return res.render('jobs/responses', {
    title: 'Interviews and offers',
    titleKey: 'govuk_alpha_jobs.responses.title',
    activeNav: 'explore',
    interviews: collectionItems(interviewsResult).map(interview => decorateInterview(interview, req)),
    offers: collectionItems(offersResult).map(offer => decorateOffer(offer, req)),
    status: req.query.status || '',
    successMessage: responseSuccessMessage(req, req.query.status),
    errorMessage: responseErrorMessage(req, req.query.status),
    loadError,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.get('/employer-onboarding', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  let postingsResult = null;
  let loadError = false;

  try {
    postingsResult = await callJob(token, 'GET', '/my-postings?per_page=1');
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && error.status === 403) {
      return res.status(403).render('errors/403', { title: 'Forbidden' });
    }
    if (error instanceof ApiError && error.status === 429) {
      return res.status(429).render('errors/429', { title: 'Too many requests' });
    }
    loadError = true;
  }

  return res.render('jobs/onboarding', {
    title: 'Post your first opportunity',
    titleKey: 'govuk_alpha_jobs.onboarding.title',
    activeNav: 'explore',
    hasPosted: onboardingHasPosted(postingsResult),
    loadError
  });
}));

router.get('/employers/:employerId(\\d+)', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const employerId = Number(req.params.employerId);
  let employerResult;

  try {
    employerResult = await getUserV2(token, employerId);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && error.status === 403) {
      return res.status(403).render('errors/403', { title: 'Forbidden' });
    }
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: 'Page not found' });
    }

    return res.status(503).render('errors/503', { title: 'Service unavailable' });
  }

  const employer = decorateEmployer(employerResult, employerId);
  if (!employer) {
    return res.status(404).render('errors/404', { title: 'Page not found' });
  }

  const jobParams = {
    user_id: employerId,
    status: 'open',
    limit: 50,
    sort: 'newest'
  };
  let jobsResult = null;
  let reviewsResult = null;
  let loadError = false;

  try {
    jobsResult = await getJobs(token, jobParams);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = true;
  }

  try {
    reviewsResult = await callJob(token, 'GET', `/employer-reviews/${employerId}`);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    loadError = true;
  }

  const openJobs = collectionItems(jobsResult).map(decorateJob);
  const employerReviews = reviewRowsFrom(reviewsResult);

  return res.render('jobs/employer-brand', {
    title: employer.name,
    activeNav: 'explore',
    employer,
    openJobs,
    openJobsMeta: employerOpenJobsMeta(jobsResult, openJobs),
    employerReviews,
    reviewStats: decorateReviewStats(reviewsResult, employerReviews),
    loadError
  });
}));

router.get('/bias-audit', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const filters = biasAuditFilters(req.query);
  let result;
  let jobsResult = null;

  try {
    result = await callAdminJob(token, 'GET', biasAuditPath(filters));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && error.status === 403) {
      return res.status(403).render('errors/403', { title: 'Forbidden' });
    }
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: 'Page not found' });
    }
    if (error instanceof ApiError && error.status === 429) {
      return res.status(429).render('errors/429', { title: 'Too many requests' });
    }

    return res.status(503).render('errors/503', { title: 'Service unavailable' });
  }

  try {
    jobsResult = await callAdminJob(token, 'GET', '/?limit=200');
  } catch {
    // The report remains useful when the optional filter choices cannot load.
  }

  const jobs = collectionItems(jobsResult)
    .map((job) => ({ id: positiveInteger(job.id), title: trimmed(job.title, 255) }))
    .filter((job) => job.id && job.title)
    .sort((left, right) => left.title.localeCompare(right.title, getRequestIntlLocale()));

  return res.render('jobs/bias-audit', {
    title: 'Hiring bias audit',
    titleKey: 'govuk_alpha_jobs.bias_audit.title',
    activeNav: 'admin',
    filters,
    jobs,
    report: decorateBiasReport(result, req)
  });
}));

router.get('/talent-search', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const filters = talentSearchFilters(req.query);
  let result;

  try {
    result = await callJob(token, 'GET', talentSearchPath(filters));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && error.status === 403) {
      return res.status(403).render('errors/403', { title: 'Forbidden' });
    }
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: 'Page not found' });
    }
    if (error instanceof ApiError && error.status === 429) {
      return res.status(429).render('errors/429', { title: 'Too many requests' });
    }

    return res.status(503).render('errors/503', { title: 'Service unavailable' });
  }

  const candidates = collectionItems(result).map((candidate) => decorateCandidate(candidate, req));
  const meta = talentSearchMeta(result, filters, candidates.length);

  return res.render('jobs/talent-search', {
    title: 'Find candidates',
    titleKey: 'govuk_alpha_jobs.talent.title',
    activeNav: 'explore',
    filters,
    candidates,
    meta,
    hasSearched: talentHasSearched(filters)
  });
}));

router.get('/talent-search/:candidateId(\\d+)', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const candidateId = Number(req.params.candidateId);
  let result;

  try {
    result = await callJob(token, 'GET', `/talent-search/${candidateId}`);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && error.status === 403) {
      return res.status(403).render('errors/403', { title: 'Forbidden' });
    }
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: 'Page not found' });
    }
    if (error instanceof ApiError && error.status === 429) {
      return res.status(429).render('errors/429', { title: 'Too many requests' });
    }

    return res.status(503).render('errors/503', { title: 'Service unavailable' });
  }

  const candidate = objectFrom(result);
  if (!candidate) {
    return res.status(404).render('errors/404', { title: 'Page not found' });
  }

  const authoredName = trimmed(candidate.name || candidate.display_name || candidate.full_name, 255);
  const decorated = decorateCandidate(candidate, req);
  return res.render('jobs/talent-profile', {
    title: authoredName || 'Candidate profile',
    titleKey: authoredName ? undefined : 'govuk_alpha_jobs.talent.profile_title',
    activeNav: 'explore',
    candidate: decorated
  });
}));

router.get('/:id(\\d+)/applications/export.csv', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  let csv;

  try {
    csv = await callJob(token, 'GET', `/${id}/applications/export-csv`);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, statusRedirect(`/jobs/${id}/applications`, 'export-failed'));
  }

  const filename = `job_${id}_applications_${timestampForFilename()}.csv`;

  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache'
  });

  return res.send(typeof csv === 'string' ? csv : String(csv || ''));
}));

router.get('/:id(\\d+)/analytics', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  let jobResult;
  let analyticsResult;
  let predictionsResult = null;

  try {
    jobResult = await getJob(token, id);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && error.status === 403) {
      return res.status(403).render('errors/403', { title: 'Forbidden' });
    }
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: 'Page not found' });
    }

    return res.status(503).render('errors/503', { title: 'Service unavailable' });
  }

  const job = dataFrom(jobResult);
  if (!job || typeof job !== 'object' || !job.id) {
    return res.status(404).render('errors/404', { title: 'Page not found' });
  }

  try {
    analyticsResult = await callJob(token, 'GET', `/${id}/analytics`);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && error.status === 403) {
      return res.status(403).render('errors/403', { title: 'Forbidden' });
    }
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: 'Page not found' });
    }
    if (error instanceof ApiError && error.status === 429) {
      return res.status(429).render('errors/429', { title: 'Too many requests' });
    }

    return res.status(503).render('errors/503', { title: 'Service unavailable' });
  }

  try {
    predictionsResult = await callJob(token, 'GET', `/${id}/predictions`);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  return res.render('jobs/analytics', {
    title: 'Opportunity analytics',
    titleKey: 'govuk_alpha_jobs.analytics.title',
    activeNav: 'explore',
    job: decorateJob(job),
    analytics: decorateAnalytics(analyticsResult, req),
    predictions: decoratePredictions(predictionsResult)
  });
}));

router.get('/:id(\\d+)/edit', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  let result;
  let profileResult;

  try {
    [result, profileResult] = await Promise.all([
      getJob(token, id),
      getRequestProfile(req, token)
    ]);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && error.status === 403) {
      return res.status(403).render('errors/403', { title: 'Forbidden' });
    }
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: 'Page not found' });
    }

    return res.status(503).render('errors/503', { title: 'Service unavailable' });
  }

  const job = dataFrom(result);
  if (!job || typeof job !== 'object' || !job.id) {
    return res.status(404).render('errors/404', { title: 'Page not found' });
  }

  if (jobOwnerId(job) !== profileUserId(profileResult)) {
    return res.status(403).render('errors/403', { title: 'Forbidden' });
  }

  const rememberedErrors = recalledJobFormErrors(req);
  return res.render('jobs/form', {
    title: 'Edit opportunity',
    titleKey: 'jobs_t3.edit_title',
    activeNav: 'explore',
    formMode: 'edit',
    formAction: `/jobs/${id}/update`,
    jobForm: { ...jobFormForEdit(job), ...recalledJobForm(req) },
    jobFormErrors: rememberedErrors.length > 0 ? rememberedErrors : formErrors(req, req.query.status),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.get('/:id(\\d+)/pipeline', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  let jobResult;
  let applicationsResult;

  try {
    jobResult = await getJob(token, id);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && error.status === 403) {
      return res.status(403).render('errors/403', { title: 'Forbidden' });
    }
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: 'Page not found' });
    }

    return res.status(503).render('errors/503', { title: 'Service unavailable' });
  }

  const job = dataFrom(jobResult);
  if (!job || typeof job !== 'object' || !job.id) {
    return res.status(404).render('errors/404', { title: 'Page not found' });
  }

  try {
    applicationsResult = await callJob(token, 'GET', `/${id}/applications`);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && error.status === 403) {
      return res.status(403).render('errors/403', { title: 'Forbidden' });
    }
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: 'Page not found' });
    }
    if (error instanceof ApiError && error.status === 429) {
      return res.status(429).render('errors/429', { title: 'Too many requests' });
    }

    return res.status(503).render('errors/503', { title: 'Service unavailable' });
  }

  const applications = collectionItems(applicationsResult).map((application) => decorateApplicant(application, req));

  return res.render('jobs/pipeline', {
    title: 'Application pipeline',
    titleKey: 'govuk_alpha_jobs.pipeline.title',
    activeNav: 'explore',
    job: decorateJob(job),
    pipelineColumns: groupPipeline(applications, req),
    hasApplications: applications.length > 0,
    status: req.query.status || '',
    successMessage: pipelineSuccessMessage(req, req.query.status),
    errorMessage: pipelineErrorMessage(req, req.query.status),
    statusOptions: JOB_PIPELINE_COLUMNS.map((status) => ({
      value: status,
      label: translateStatusMessage(
        req,
        `govuk_alpha_jobs.stage.${status}`,
        JOB_PIPELINE_LABELS[status] || status
      )
    })),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.get('/:id(\\d+)/applications', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  let jobResult;
  let applicationsResult = null;
  let analyticsResult = null;

  try {
    jobResult = await getJob(token, id);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && error.status === 403) {
      return res.status(403).render('errors/403', { title: 'Forbidden' });
    }
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: 'Page not found' });
    }

    return res.status(503).render('errors/503', { title: 'Service unavailable' });
  }

  const job = dataFrom(jobResult);
  if (!job || typeof job !== 'object' || !job.id) {
    return res.status(404).render('errors/404', { title: 'Page not found' });
  }

  try {
    applicationsResult = await callJob(token, 'GET', `/${id}/applications`);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && error.status === 403) {
      return res.status(403).render('errors/403', { title: 'Forbidden' });
    }
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: 'Page not found' });
    }
    return res.status(403).render('errors/403', { title: 'Forbidden' });
  }

  try {
    analyticsResult = await callJob(token, 'GET', `/${id}/analytics`);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
  }

  return res.render('jobs/applicants', {
    title: 'Applications',
    titleKey: 'jobs_t3.applicants_title',
    activeNav: 'explore',
    job: decorateJob(job),
    applications: collectionItems(applicationsResult).map((application) => decorateApplicant(
      application,
      req,
      'jobs_t3.applicant_anonymous'
    )),
    analytics: analyticsFrom(analyticsResult),
    status: req.query.status || '',
    successMessage: applicantSuccessMessage(req, req.query.status),
    errorMessage: applicantErrorMessage(req, req.query.status),
    statusOptions: JOB_APPLICANT_STAGE_OPTIONS.map((status) => ({
      value: status,
      label: translateStatusMessage(
        req,
        `jobs_t2.app_status_${status}`,
        JOB_APPLICATION_LABELS[status] || statusTitle(status)
      )
    })),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.get('/:id(\\d+)/qualified', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  let qualificationResult;

  try {
    qualificationResult = await callJob(token, 'GET', `/${id}/qualified`);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && error.status === 403) {
      return res.status(403).render('errors/403', { title: 'Forbidden' });
    }
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: 'Page not found' });
    }
    if (error instanceof ApiError && error.status === 429) {
      return res.status(429).render('errors/429', { title: 'Too many requests' });
    }

    return res.status(503).render('errors/503', { title: 'Service unavailable' });
  }

  const qualification = decorateQualification(qualificationResult, req);
  if (!qualification) {
    return res.status(404).render('errors/404', { title: 'Page not found' });
  }

  return res.render('jobs/qualification', {
    title: 'Am I qualified?',
    titleKey: 'govuk_alpha_jobs.qualification.title',
    activeNav: 'explore',
    qualification
  });
}));

router.get('/:id(\\d+)', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  let result;
  let profileResult = null;
  let matchResult = null;

  try {
    result = await getJob(token, req.params.id);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: 'Page not found' });
    }

    return res.status(503).render('errors/503', { title: 'Service unavailable' });
  }

  const job = dataFrom(result);
  if (!job || typeof job !== 'object' || !job.id) {
    return res.status(404).render('errors/404', { title: 'Page not found' });
  }

  try {
    profileResult = await getUserV2(token);
  } catch {
    // The detail remains usable if the secondary owner lookup is unavailable.
  }

  if (skillsFrom(job).length > 0) {
    try {
      matchResult = await callJob(token, 'GET', `/${job.id}/match`);
    } catch {
      // Skills matching is optional and may be disabled for the tenant.
    }
  }

  const decorated = {
    ...decorateJob(job),
    isOwner: checked(job.is_owner || job.isOwner)
      || (jobOwnerId(job) > 0 && jobOwnerId(job) === profileUserId(profileResult))
  };
  const applicationValues = recalledJobApplication(req, decorated.id);
  return res.render('jobs/detail', {
    title: decorated.title,
    activeNav: 'explore',
    job: decorated,
    jobMatch: dataFrom(matchResult),
    applicationValues,
    status: req.query.status || '',
    successMessage: statusMessage(req, req.query.status),
    errorMessage: actionErrorMessage(req, req.query.status),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.post('/', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const payload = jobFormPayload(req.body);
  if (payload === null) {
    rememberJobForm(req, req.body);
    return redirectTo(res, statusRedirect('/jobs/create', 'title-required'));
  }

  let result;
  try {
    result = await callJob(token, 'POST', '', payload);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    const fallback = fallbackTranslator('jobs_t3.error_generic');
    rememberJobForm(req, req.body, apiJobFormErrors(error, fallback));
    return redirectTo(res, statusRedirect('/jobs/create', 'create-failed'));
  }

  const id = resultId(result);
  return redirectTo(res, id ? jobRedirect(id, 'created') : statusRedirect('/jobs/mine', 'created'));
}));

router.post('/:id(\\d+)/update', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  const payload = jobFormPayload(req.body);
  if (payload === null) {
    rememberJobForm(req, req.body);
    return redirectTo(res, statusRedirect(`/jobs/${id}/edit`, 'title-required'));
  }

  try {
    await callJob(token, 'PUT', `/${id}`, payload);
    return redirectTo(res, jobRedirect(id, 'updated'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    const fallback = fallbackTranslator('jobs_t3.error_generic');
    rememberJobForm(req, req.body, apiJobFormErrors(error, fallback));
    return redirectTo(res, statusRedirect(`/jobs/${id}/edit`, 'update-failed'));
  }
}));

router.post('/:id(\\d+)/delete', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  try {
    await callJob(token, 'DELETE', `/${id}`);
    return redirectTo(res, statusRedirect('/jobs/mine', 'deleted'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, statusRedirect('/jobs/mine', 'delete-failed'));
  }
}));

router.post('/:id(\\d+)/renew', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  try {
    await callJob(token, 'POST', `/${id}/renew`, { days: 30 });
    return redirectTo(res, jobRedirect(id, 'renewed'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, jobRedirect(id, 'renew-failed'));
  }
}));

router.post('/:id(\\d+)/apply', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  const payload = { message: trimmed(req.body.cover_letter, 5000) };
  const file = uploadedFile(req, 'cv');
  const cvErrorStatus = jobCvErrorStatus(file);

  if (cvErrorStatus) {
    rememberJobApplication(req, id, req.body);
    await removeUploadedFile(file);
    return redirectTo(res, jobRedirect(id, cvErrorStatus));
  }

  try {
    if (file) {
      const buffer = await fs.readFile(file.filepath);
      await uploadJobApplication(token, id, {
        ...payload,
        file: {
          buffer,
          filename: file.originalFilename || file.newFilename || 'cv',
          contentType: file.mimetype || 'application/octet-stream',
          size: file.size
        }
      });
    } else {
      await callJob(token, 'POST', `/${id}/apply`, payload);
    }
    return redirectTo(res, jobRedirect(id, 'applied'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    rememberJobApplication(req, id, req.body);
    return redirectTo(res, jobRedirect(id, 'apply-failed'));
  } finally {
    await removeUploadedFile(file);
  }
}));

router.post('/:id(\\d+)/save', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  try {
    await callJob(token, 'POST', `/${id}/save`);
    return redirectTo(res, bookmarkRedirect(id, req.body.from, 'saved'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, bookmarkRedirect(id, req.body.from, 'save-failed'));
  }
}));

router.post('/:id(\\d+)/unsave', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  try {
    await callJob(token, 'DELETE', `/${id}/save`);
    return redirectTo(res, bookmarkRedirect(id, req.body.from, 'unsaved'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, bookmarkRedirect(id, req.body.from, 'save-failed'));
  }
}));

router.post('/:id(\\d+)/applications/:appId(\\d+)/status', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  const appId = Number(req.params.appId);
  try {
    await callJob(token, 'PUT', `/applications/${appId}`, applicationStatusPayload(req.body));
    return redirectTo(res, statusRedirect(`/jobs/${id}/applications`, 'status-updated'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, statusRedirect(`/jobs/${id}/applications`, 'status-failed'));
  }
}));

router.post('/applications/:appId(\\d+)/withdraw', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const appId = Number(req.params.appId);
  try {
    await callJob(token, 'PUT', `/applications/${appId}`, { status: 'withdrawn' });
    return redirectTo(res, statusRedirect('/jobs/applications', 'withdrawn'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, statusRedirect('/jobs/applications', 'withdraw-failed'));
  }
}));

router.post('/alerts', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  try {
    await callJob(token, 'POST', '/alerts', alertPayload(req.body));
    return redirectTo(res, statusRedirect('/jobs/alerts', 'alert-created'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, statusRedirect('/jobs/alerts', 'alert-failed'));
  }
}));

router.post('/alerts/:alertId(\\d+)/pause', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const alertId = Number(req.params.alertId);
  try {
    await callJob(token, 'PUT', `/alerts/${alertId}/unsubscribe`);
    return redirectTo(res, statusRedirect('/jobs/alerts', 'alert-paused'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, statusRedirect('/jobs/alerts', 'alert-failed'));
  }
}));

router.post('/alerts/:alertId(\\d+)/resume', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const alertId = Number(req.params.alertId);
  try {
    await callJob(token, 'PUT', `/alerts/${alertId}/resubscribe`);
    return redirectTo(res, statusRedirect('/jobs/alerts', 'alert-resumed'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, statusRedirect('/jobs/alerts', 'alert-failed'));
  }
}));

router.post('/alerts/:alertId(\\d+)/delete', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const alertId = Number(req.params.alertId);
  try {
    await callJob(token, 'DELETE', `/alerts/${alertId}`);
    return redirectTo(res, statusRedirect('/jobs/alerts', 'alert-deleted'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, statusRedirect('/jobs/alerts', 'alert-failed'));
  }
}));

router.post('/interviews/:interviewId(\\d+)/accept', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const interviewId = Number(req.params.interviewId);
  try {
    await callJob(token, 'PUT', `/interviews/${interviewId}/accept`, notePayload(req.body));
    return redirectTo(res, statusRedirect('/jobs/responses', 'interview-accepted'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, statusRedirect('/jobs/responses', 'interview-failed'));
  }
}));

router.post('/interviews/:interviewId(\\d+)/decline', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const interviewId = Number(req.params.interviewId);
  try {
    await callJob(token, 'PUT', `/interviews/${interviewId}/decline`, notePayload(req.body));
    return redirectTo(res, statusRedirect('/jobs/responses', 'interview-declined'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, statusRedirect('/jobs/responses', 'interview-failed'));
  }
}));

router.post('/offers/:offerId(\\d+)/accept', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const offerId = Number(req.params.offerId);
  try {
    await callJob(token, 'PUT', `/offers/${offerId}/accept`);
    return redirectTo(res, statusRedirect('/jobs/responses', 'offer-accepted'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, statusRedirect('/jobs/responses', 'offer-failed'));
  }
}));

router.post('/offers/:offerId(\\d+)/reject', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const offerId = Number(req.params.offerId);
  try {
    await callJob(token, 'PUT', `/offers/${offerId}/reject`);
    return redirectTo(res, statusRedirect('/jobs/responses', 'offer-rejected'));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, statusRedirect('/jobs/responses', 'offer-failed'));
  }
}));

module.exports = router;
