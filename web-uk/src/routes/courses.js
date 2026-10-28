// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { ApiError, ApiOfflineError, callCourseApi, getMyCourses } = require('../lib/api');
const { sanitizeCmsHtml, htmlToPlainText } = require('../lib/html-sanitizer');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');
const { translateForRequest } = require('../lib/request-translator');
const { asyncRoute } = require('../lib/routeHelpers');
const { getRequestProfile } = require('../lib/request-profile');
const { readDate, splitDate } = require('../lib/date-input');

const router = express.Router();

// 🔴 Every id-like param in this file is a numeric database id that gets
// interpolated into an API path by callCourseApi. This was the ONLY route file
// that did so with neither a numeric route constraint nor encodeURIComponent, so a
// crafted value like `1%2f..%2f..%2fadmin%2fpurge` (Express decodes %2f to `/`,
// then fetch's URL normalisation collapses `..`) could redirect the member's OWN
// authenticated call to a different API endpoint. Reject anything non-numeric here,
// once, for the whole router — a 404 is the correct answer for a bad id.
for (const idParam of ['id', 'lessonId', 'sectionId', 'attemptId', 'commentId', 'questionId']) {
  router.param(idParam, (req, res, next, value) => {
    if (/^\d+$/.test(String(value))) return next();
    return res.status(404).render('errors/404', { title: res.locals.t ? res.locals.t('error_pages.404_title') : 'Not found' });
  });
}

const COURSE_LEVELS = ['beginner', 'intermediate', 'advanced'];
const COURSE_VISIBILITIES = ['members', 'public'];
const COURSE_ENROLLMENT_TYPES = ['self_paced', 'cohort'];
// 'quiz' joined the builder on 27 Oct 2026 with quiz authoring (React CourseBuilder).
const LESSON_CONTENT_TYPES = ['text', 'video', 'pdf', 'embed', 'quiz'];
// CourseLessonService::DRIP_TYPES.
const LESSON_DRIP_TYPES = ['none', 'days_after_enroll', 'fixed_date'];
// Question types the learner page can answer and the API can mark: three marked
// automatically (CourseQuizService::OBJECTIVE_TYPES) and a written answer the
// author marks from the grading queue.
const QUESTION_TYPES = ['mcq', 'multi', 'truefalse', 'short'];
const QUESTION_OPTION_LIMIT = 26;
// 🔴 These four maps held English words ('Beginner', 'Members only', 'Self-paced',
// 'Video lesson') and were rendered straight into the page in every language,
// while their translated twins already existed unused. Keys only from here on;
// an unknown enum value falls back to the raw slug rather than a fake-English
// capitalisation.
const COURSE_LEVEL_LABEL_KEYS = {
  beginner: 'govuk_alpha.courses.levels.beginner',
  intermediate: 'govuk_alpha.courses.levels.intermediate',
  advanced: 'govuk_alpha.courses.levels.advanced'
};
const COURSE_VISIBILITY_LABEL_KEYS = {
  members: 'govuk_alpha_commerce.instructor.visibility_members',
  public: 'govuk_alpha_commerce.instructor.visibility_public'
};
const COURSE_ENROLLMENT_LABEL_KEYS = {
  self_paced: 'govuk_alpha_commerce.instructor.enrollment_self_paced',
  cohort: 'govuk_alpha_commerce.instructor.enrollment_cohort'
};
// learn.content_type_* (not builder.*) because it carries the same English words
// these labels used to hardcode ('Video lesson', not builder's 'Video') and it
// includes 'quiz', which the builder set deliberately lacks.
const LESSON_CONTENT_TYPE_LABEL_KEYS = {
  text: 'govuk_alpha_commerce.learn.content_type_text',
  video: 'govuk_alpha_commerce.learn.content_type_video',
  pdf: 'govuk_alpha_commerce.learn.content_type_pdf',
  embed: 'govuk_alpha_commerce.learn.content_type_embed',
  quiz: 'govuk_alpha_commerce.learn.content_type_quiz'
};

function enumLabel(keys, value) {
  if (!value) return '';
  return keys[value] ? translateForRequest(keys[value]) : value;
}
// 🔴 These held the English words and were rendered straight into the page, so an
// instructor saw "Published" / "Awaiting review" / "Draft" whatever language they had
// chosen. The translated set was already written for exactly this list and simply never
// used. Keys, not words, from here on.
const INSTRUCTOR_STATUS_KEYS = {
  published: 'govuk_alpha_commerce.instructor.status_published',
  pending_review: 'govuk_alpha_commerce.instructor.status_pending_review',
  draft: 'govuk_alpha_commerce.instructor.status_draft'
};
const INSTRUCTOR_STATUS_CLASSES = {
  published: 'govuk-tag--green',
  pending_review: 'govuk-tag--yellow',
  draft: 'govuk-tag--grey'
};
// Route-level status messages. The message text lives in
// lang/*/govuk_alpha_courses.php under the `status` block; routeStatus resolves it
// per request via res.locals.t. The `key` is the status slug with hyphens
// normalised to underscores to match the PHP array keys.
const COURSE_STATUS_MESSAGES = {
  enrolled: { type: 'success', key: 'enrolled' },
  'enrol-required': { type: 'error', key: 'enrol_required' },
  'review-saved': { type: 'success', key: 'review_saved' },
  'insufficient-credits': { type: 'error', key: 'insufficient_credits' },
  'enrol-failed': { type: 'error', key: 'enrol_failed' },
  'certificate-locked': { type: 'error', key: 'certificate_locked' },
  'certificate-failed': { type: 'error', key: 'certificate_failed' },
  'review-invalid': { type: 'error', key: 'review_invalid' },
  'review-not-enrolled': { type: 'error', key: 'review_not_enrolled' },
  'review-failed': { type: 'error', key: 'review_failed' },
  'not-available': { type: 'error', key: 'not_available' },
  'prerequisites-not-met': { type: 'error', key: 'prerequisites_not_met' }
};
const LEARN_STATUS_MESSAGES = {
  'lesson-completed': { type: 'success', key: 'lesson_completed' },
  'course-completed': { type: 'success', key: 'course_completed' },
  'quiz-passed': { type: 'success', key: 'quiz_passed' },
  'quiz-pending-review': { type: 'success', key: 'quiz_pending_review' },
  'quiz-failed': { type: 'error', key: 'quiz_failed' },
  'quiz-no-attempts': { type: 'error', key: 'quiz_no_attempts' },
  'quiz-error': { type: 'error', key: 'quiz_error' },
  'comment-posted': { type: 'success', messageKey: 'govuk_alpha_courses.discussion.comment_posted' },
  'comment-deleted': { type: 'success', messageKey: 'govuk_alpha_courses.discussion.comment_deleted' },
  'comment-required': { type: 'error', messageKey: 'govuk_alpha_courses.discussion.comment_required' },
  'comment-failed': { type: 'error', messageKey: 'govuk_alpha_courses.discussion.comment_failed' },
  'comment-delete-failed': { type: 'error', messageKey: 'govuk_alpha_courses.discussion.comment_delete_failed' }
};
const INSTRUCTOR_STATUS_MESSAGES = {
  deleted: { type: 'success', key: 'deleted' },
  'delete-failed': { type: 'error', key: 'delete_failed' }
};
const FORM_STATUS_MESSAGES = {
  created: { type: 'success', key: 'created' },
  'create-failed': { type: 'error', key: 'create_failed' },
  saved: { type: 'success', key: 'saved' },
  'save-failed': { type: 'error', key: 'save_failed' },
  published: { type: 'success', key: 'published' },
  'pending-review': { type: 'success', key: 'pending_review' },
  'publish-failed': { type: 'error', key: 'publish_failed' },
  unpublished: { type: 'success', key: 'unpublished' },
  'unpublish-failed': { type: 'error', key: 'unpublish_failed' },
  'section-added': { type: 'success', key: 'section_added' },
  'section-saved': { type: 'success', key: 'section_saved' },
  'section-deleted': { type: 'success', key: 'section_deleted' },
  'section-failed': { type: 'error', key: 'section_failed' },
  'section-title-missing': { type: 'error', key: 'section_title_missing' },
  'lesson-added': { type: 'success', key: 'lesson_added' },
  'lesson-saved': { type: 'success', key: 'lesson_saved' },
  'lesson-deleted': { type: 'success', key: 'lesson_deleted' },
  'lesson-failed': { type: 'error', key: 'lesson_failed' },
  'lesson-title-missing': { type: 'error', key: 'lesson_title_missing' },
  'cohort-added': { type: 'success', key: 'cohort_added' },
  'cohort-failed': { type: 'error', key: 'cohort_failed' },
  'cohort-name-missing': { type: 'error', key: 'cohort_name_missing' },
  'order-saved': { type: 'success', messageKey: 'govuk_alpha_courses.lesson_editor.order_saved' },
  'order-changed': { type: 'error', messageKey: 'govuk_alpha_courses.lesson_editor.order_changed' },
  'order-failed': { type: 'error', messageKey: 'govuk_alpha_courses.lesson_editor.order_failed' }
};
// The single-lesson editor: release timing, free preview and quiz questions.
const LESSON_EDIT_STATUS_MESSAGES = {
  'lesson-added': { type: 'success', key: 'lesson_added' },
  'lesson-failed': { type: 'error', key: 'lesson_failed' },
  'lesson-quiz-failed': { type: 'error', messageKey: 'govuk_alpha_courses.lesson_editor.lesson_quiz_failed' },
  'question-added': { type: 'success', messageKey: 'govuk_alpha_courses.lesson_editor.question_added' },
  'question-deleted': { type: 'success', messageKey: 'govuk_alpha_courses.lesson_editor.question_deleted' },
  'question-failed': { type: 'error', messageKey: 'govuk_alpha_courses.lesson_editor.question_failed', href: '#question_prompt' },
  'question-prompt-missing': { type: 'error', messageKey: 'govuk_alpha_courses.lesson_editor.question_prompt_missing', href: '#question_prompt' },
  'question-options-missing': { type: 'error', messageKey: 'govuk_alpha_courses.lesson_editor.question_options_missing', href: '#question_options' },
  'question-correct-invalid': { type: 'error', messageKey: 'govuk_alpha_courses.lesson_editor.question_correct_invalid', href: '#question_correct' },
  'drip-days-invalid': { type: 'error', messageKey: 'govuk_alpha_courses.lesson_editor.drip_days_invalid', href: '#drip_offset_days' },
  'drip-date-invalid': { type: 'error', messageKey: 'govuk_alpha_courses.lesson_editor.drip_date_invalid', href: '#drip_date-day' },
  'lesson-title-missing': { type: 'error', key: 'lesson_title_missing', href: '#lesson_title' }
};
const GRADING_STATUS_MESSAGES = {
  graded: { type: 'success', key: 'graded' },
  'grade-failed': { type: 'error', key: 'grade_failed' }
};

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || req.token || '';
}

function loginRedirect() {
  return '/login?status=auth-required';
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function trimmed(value, limit = null) {
  const text = String(value || '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function optionalText(value, limit = null) {
  const text = trimmed(value, limit);
  return text === '' ? null : text;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function boundedNumber(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(maximum, Math.max(minimum, number));
}

function checked(value) {
  return value === true || ['1', 'true', 'on', 'yes'].includes(String(value || '').toLowerCase());
}

function allowed(value, choices, fallback) {
  const text = trimmed(value);
  return choices.includes(text) ? text : fallback;
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

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined
    ? result.data
    : result;
}

function listFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (result && Array.isArray(result.items)) return result.items;
  return [];
}

function objectFrom(result) {
  const data = dataFrom(result);
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

function resultId(result) {
  const data = dataFrom(result);
  if (!data || typeof data !== 'object') return null;
  return positiveInteger(data.id) || positiveInteger(data.course && data.course.id);
}

function errorCode(error) {
  if (!(error instanceof ApiError) || !error.data || typeof error.data !== 'object') {
    return '';
  }

  const nested = error.data.error && typeof error.data.error === 'object'
    ? error.data.error.code
    : error.data.error;
  return String(nested || error.data.code || '').toUpperCase();
}

async function callCourse(token, method, path, data = undefined) {
  if (data === undefined) {
    return callCourseApi(token, method, path);
  }

  return callCourseApi(token, method, path, data);
}

function requireToken(req, res) {
  const token = tokenFrom(req);
  if (!token) {
    redirectTo(res, loginRedirect());
    return null;
  }

  return token;
}

function handleCourseGetError(error, res) {
  if (redirectOnAuthError(error, res)) return true;

  if (error instanceof ApiError && error.status === 404) {
    res.status(404).render('errors/404', { title: (res.locals.t ? res.locals.t('govuk_alpha.error_pages.404_title') : 'Page not found') });
    return true;
  }

  if (error instanceof ApiOfflineError || error instanceof ApiError) {
    res.status(503).render('errors/503', { title: (res.locals.t ? res.locals.t('govuk_alpha.error_pages.503_title') : 'Service unavailable') });
    return true;
  }

  return false;
}

function routeStatus(query, map, t) {
  const key = typeof query.status === 'string' ? query.status : '';
  const entry = map[key];
  if (!entry) return null;
  return {
    key,
    type: entry.type,
    href: entry.href || '',
    message: t(entry.messageKey || `govuk_alpha_courses.status.${entry.key}`)
  };
}

function costMeta(course) {
  const cost = Number(course.credit_cost || 0);
  const normalized = Number.isFinite(cost) ? Math.max(0, cost) : 0;
  // Same translated price string the marketplace uses; 'Free' comes from the
  // courses catalogue's own translated key.
  const label = normalized > 0
    ? translateForRequest('govuk_alpha_commerce.common.credits_price', {
      credits: normalized.toLocaleString(getRequestIntlLocale(), { maximumFractionDigits: 2 })
    })
    : translateForRequest('govuk_alpha.courses.free');
  return {
    creditCost: normalized,
    costLabel: label,
    costTagClass: normalized > 0 ? 'govuk-tag--blue' : 'govuk-tag--green'
  };
}

function stripHtml(value) {
  return htmlToPlainText(value);
}

function limitText(value, limit = 160) {
  const text = stripHtml(value).trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function titleFrom(value, fallback = null) {
  // The default fallback is the translated catalogue title, not English 'Courses'.
  return trimmed(value) || (fallback === null ? translateForRequest('govuk_alpha.courses.title') : fallback);
}

function normalizeCourse(course) {
  const level = trimmed(course.level);
  const cost = costMeta(course);
  return {
    ...course,
    ...cost,
    id: positiveInteger(course.id) || 0,
    title: titleFrom(course.title),
    summary: trimmed(course.summary),
    description: trimmed(stripHtml(course.description)),
    excerpt: limitText(course.description || course.summary, 160),
    level,
    levelLabel: enumLabel(COURSE_LEVEL_LABEL_KEYS, level),
    categoryId: positiveInteger(course.category_id),
    visibility: allowed(course.visibility, COURSE_VISIBILITIES, 'members'),
    visibilityLabel: enumLabel(COURSE_VISIBILITY_LABEL_KEYS, allowed(course.visibility, COURSE_VISIBILITIES, 'members')),
    enrollmentType: allowed(course.enrollment_type, COURSE_ENROLLMENT_TYPES, 'self_paced'),
    enrollmentTypeLabel: enumLabel(COURSE_ENROLLMENT_LABEL_KEYS, allowed(course.enrollment_type, COURSE_ENROLLMENT_TYPES, 'self_paced')),
    authorName: trimmed(course.author && course.author.name) || trimmed(course.author_name),
    isEnrolled: !!course.is_enrolled,
    ratingAvg: Number(course.rating_avg || 0),
    ratingAvgLabel: Number(course.rating_avg || 0).toLocaleString(getRequestIntlLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    ratingStars: stars(course.rating_avg),
    ratingCount: Number(course.rating_count || 0),
    status: trimmed(course.status) || 'draft',
    moderationStatus: trimmed(course.moderation_status) || 'pending'
  };
}

function normalizeCategory(category) {
  return {
    id: positiveInteger(category.id) || 0,
    name: trimmed(category.name)
  };
}

const COURSES_PER_PAGE = 30;

function courseQueryPath(req) {
  const params = new URLSearchParams();
  params.set('per_page', String(COURSES_PER_PAGE));
  // GET /v2/courses is page-based (respondWithPaginatedCollection), so the
  // browse list follows ?page and meta.total_pages rather than stopping at one.
  const page = positiveInteger(req.query.page) || 1;
  if (page > 1) params.set('page', String(page));

  const q = trimmed(req.query.q);
  const categoryId = positiveInteger(req.query.category || req.query.category_id);
  const level = allowed(req.query.level, COURSE_LEVELS, '');

  if (q) params.set('q', q);
  if (categoryId !== null) params.set('category_id', String(categoryId));
  if (level) params.set('level', level);

  return {
    path: `?${params.toString()}`,
    q,
    categoryId,
    level,
    page
  };
}

// Previous / next links for the browse list, keeping the member's filters.
function coursePagination(query, meta) {
  const currentPage = positiveInteger(meta && meta.current_page) || query.page;
  const totalPages = positiveInteger(meta && meta.total_pages) || 0;
  const hasMore = meta && meta.has_more !== undefined ? !!meta.has_more : currentPage < totalPages;
  const hrefFor = (page) => {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.categoryId !== null) params.set('category', String(query.categoryId));
    if (query.level) params.set('level', query.level);
    params.set('page', String(page));
    return `/courses?${params.toString()}`;
  };
  return {
    currentPage,
    totalPages,
    previousHref: currentPage > 1 ? hrefFor(currentPage - 1) : '',
    nextHref: hasMore ? hrefFor(currentPage + 1) : ''
  };
}

function progressMaps(progressResult) {
  const data = objectFrom(progressResult);
  const lessonProgress = Array.isArray(data.lessons) ? data.lessons : [];
  const availability = Array.isArray(data.availability) ? data.availability : [];
  const completed = new Set();
  const available = new Map();
  const unlockAt = new Map();

  lessonProgress.forEach((row) => {
    const id = positiveInteger(row.lesson_id || row.id);
    if (id !== null && row.status === 'completed') completed.add(id);
  });

  availability.forEach((row) => {
    const id = positiveInteger(row.lesson_id || row.id);
    if (id !== null) available.set(id, row.available !== false);
    // Drip-fed lessons carry the instant they open (CourseLessonService::availability).
    if (id !== null && row.available === false && row.unlock_at) unlockAt.set(id, String(row.unlock_at));
  });

  return {
    enrollment: data.enrollment && typeof data.enrollment === 'object' ? data.enrollment : {},
    completed,
    available,
    unlockAt
  };
}

function normalizeLesson(lesson, progress = { completed: new Set(), available: new Map() }) {
  const id = positiveInteger(lesson.id) || 0;
  const contentType = trimmed(lesson.content_type) || 'text';
  return {
    ...lesson,
    id,
    title: titleFrom(lesson.title, 'Lesson'),
    contentType,
    contentTypeLabel: enumLabel(LESSON_CONTENT_TYPE_LABEL_KEYS, contentType),
    body: sanitizeCmsHtml(lesson.body),
    // Plain text, NOT sanitizeCmsHtml: a transcript is typed prose, so it is
    // escaped and line-broken at render (the podcast episode precedent) rather
    // than treated as authored HTML.
    transcript: trimmed(lesson.transcript),
    videoUrl: trimmed(lesson.video_url),
    embedUrl: trimmed(lesson.embed_url),
    attachmentUrl: trimmed(lesson.attachment_url),
    quizId: positiveInteger(lesson.quiz_id) || positiveInteger(lesson.quiz && lesson.quiz.id),
    isCompleted: progress.completed.has(id) || !!lesson.is_completed,
    available: progress.available.has(id) ? progress.available.get(id) : lesson.available !== false,
    unlockAtLabel: progress.unlockAt && progress.unlockAt.has(id) ? reviewDateLabel(progress.unlockAt.get(id)) : '',
    // Authoring view of the release settings (CourseLessonService drip fields).
    ...lessonReleaseSettings(lesson)
  };
}

function lessonReleaseSettings(lesson) {
  const dripType = allowed(lesson.drip_type, LESSON_DRIP_TYPES, 'none');
  const days = Number(lesson.drip_offset_days);
  const dripDate = /^\d{4}-\d{2}-\d{2}/.test(trimmed(lesson.drip_date)) ? trimmed(lesson.drip_date).slice(0, 10) : '';
  return {
    dripType,
    dripOffsetDays: Number.isInteger(days) && days >= 0 ? days : null,
    dripDate,
    dripDateLabel: dripDate
      ? new Intl.DateTimeFormat(getRequestIntlLocale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
        .format(new Date(`${dripDate}T00:00:00Z`))
      : '',
    isPreview: checked(lesson.is_preview)
  };
}

function normalizeSections(course, progress) {
  const sections = Array.isArray(course.sections) ? course.sections : [];
  return sections.map((section) => ({
    id: positiveInteger(section.id) || 0,
    title: trimmed(section.title),
    lessons: (Array.isArray(section.lessons) ? section.lessons : []).map((lesson) => normalizeLesson(lesson, progress))
  }));
}

function firstAvailableLesson(sections, requestedLessonId = null) {
  let first = null;

  for (const section of sections) {
    for (const lesson of section.lessons) {
      if (!lesson.available) continue;
      if (first === null && !lesson.isCompleted) first = lesson;
      if (requestedLessonId !== null && lesson.id === requestedLessonId) return lesson;
    }
  }

  if (first !== null) return first;

  for (const section of sections) {
    for (const lesson of section.lessons) {
      if (lesson.available) return lesson;
    }
  }

  return null;
}

function stars(rating) {
  const count = Math.max(0, Math.min(5, Math.round(Number(rating || 0))));
  return `${'★'.repeat(count)}${'☆'.repeat(5 - count)}`;
}

function reviewDateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(getRequestIntlLocale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

function normalizeReview(review) {
  const user = review.user && typeof review.user === 'object' ? review.user : {};
  return {
    rating: Math.max(0, Math.min(5, Number(review.rating || 0))),
    stars: stars(review.rating),
    body: trimmed(review.body),
    name: trimmed(review.name) || trimmed(user.name) || 'A learner',
    createdAt: trimmed(review.created_at),
    createdAtLabel: reviewDateLabel(review.created_at)
  };
}

function normalizeEnrollment(enrollment) {
  const course = enrollment.course && typeof enrollment.course === 'object' ? enrollment.course : {};
  const percent = Math.round(Number(enrollment.progress_percent || 0));
  return {
    ...enrollment,
    course: normalizeCourse(course),
    percent,
    completed: enrollment.status === 'completed',
    // 🔴 Was the literal 'Completed' / 'In progress', rendered on My learning in every
    // language. Both strings already existed, translated, under my_learning.
    statusLabel: translateForRequest(
      enrollment.status === 'completed'
        ? 'govuk_alpha_commerce.my_learning.status_completed'
        : 'govuk_alpha_commerce.my_learning.status_in_progress'
    )
  };
}

function instructorStatus(course) {
  const status = trimmed(course.status) || 'draft';
  const moderation = trimmed(course.moderation_status) || 'pending';
  if (status === 'published' && moderation === 'approved') return 'published';
  if (status !== 'draft' && moderation === 'pending') return 'pending_review';
  return 'draft';
}

function normalizeInstructorCourse(course) {
  const normalized = normalizeCourse(course);
  const status = instructorStatus(course);
  return {
    ...normalized,
    enrollmentCount: Number(course.enrollment_count || 0),
    completionCount: Number(course.completion_count || 0),
    instructorStatus: status,
    instructorStatusLabel: INSTRUCTOR_STATUS_KEYS[status]
      ? translateForRequest(INSTRUCTOR_STATUS_KEYS[status])
      : status,
    instructorStatusClass: INSTRUCTOR_STATUS_CLASSES[status]
  };
}

// Intl's percent style owns the digits AND the sign placement — the tiles
// previously appended a literal '%', which is wrong for Arabic and Japanese
// (mirrors the matches.js stats approach). Values arrive as 0–100 percentages.
function percentTileLabel(value) {
  const number = Number(value);
  return new Intl.NumberFormat(getRequestIntlLocale(), {
    style: 'percent',
    maximumFractionDigits: 1
  }).format((Number.isFinite(number) ? number : 0) / 100);
}

function normalizeAnalytics(result, t) {
  const data = objectFrom(result);
  const enrollments = data.enrollments && typeof data.enrollments === 'object' ? data.enrollments : {};
  const analytics = {
    total: Number(enrollments.total || data.total || 0),
    active: Number(enrollments.active || data.active || 0),
    completed: Number(enrollments.completed || data.completed || 0),
    dropped: Number(enrollments.dropped || data.dropped || 0),
    completionRate: Number(data.completion_rate || 0),
    avgProgress: Number(data.avg_progress || 0),
    avgQuizScore: Number(data.avg_quiz_score || 0),
    quizAttempts: Number(data.quiz_attempts || 0)
  };
  const perLesson = Array.isArray(data.per_lesson) ? data.per_lesson : [];

  return {
    course: normalizeCourse(data.course || {}),
    analytics,
    stats: [
      { label: t('govuk_alpha_courses.analytics.total'), value: analytics.total },
      { label: t('govuk_alpha_courses.analytics.active'), value: analytics.active },
      { label: t('govuk_alpha_courses.analytics.completed'), value: analytics.completed },
      { label: t('govuk_alpha_courses.analytics.dropped'), value: analytics.dropped },
      { label: t('govuk_alpha_courses.analytics.completion_rate'), value: percentTileLabel(analytics.completionRate) },
      { label: t('govuk_alpha_courses.analytics.avg_progress'), value: percentTileLabel(analytics.avgProgress) },
      { label: t('govuk_alpha_courses.analytics.avg_quiz_score'), value: percentTileLabel(analytics.avgQuizScore) },
      { label: t('govuk_alpha_courses.analytics.quiz_attempts'), value: analytics.quizAttempts }
    ],
    perLesson: perLesson.map((row) => ({
      lessonId: positiveInteger(row.lesson_id) || 0,
      title: titleFrom(row.title, 'Courses'),
      completed: Number(row.completed || 0)
    })),
    maxLessonCompleted: Math.max(1, ...perLesson.map((row) => Number(row.completed || 0)))
  };
}

function answerToText(value) {
  if (Array.isArray(value)) {
    return value.map((item) => answerToText(item)).filter(Boolean).join(', ');
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return trimmed(value);
}

function normalizeAttempt(attempt) {
  const quiz = attempt.quiz && typeof attempt.quiz === 'object' ? attempt.quiz : {};
  const user = attempt.user && typeof attempt.user === 'object' ? attempt.user : {};
  const rawAnswers = attempt.answers && typeof attempt.answers === 'object' ? attempt.answers : {};
  const questions = Array.isArray(quiz.questions) ? quiz.questions : [];

  return {
    id: positiveInteger(attempt.id) || 0,
    learnerName: trimmed(user.name) || `#${positiveInteger(attempt.user_id) || 0}`,
    quizTitle: trimmed(quiz.title),
    submittedAt: trimmed(attempt.submitted_at) || 'Not set',
    scorePercent: Math.round(Number(attempt.score_percent || 0)),
    passed: !!attempt.passed,
    feedback: trimmed(attempt.feedback),
    questions: questions.map((question) => {
      const id = String(question.id || '');
      return {
        id,
        prompt: trimmed(question.prompt) || 'Question',
        answerText: answerToText(rawAnswers[id]) || 'The learner did not provide any answers.'
      };
    })
  };
}

async function courseCategories(token) {
  return listFrom(await callCourse(token, 'GET', '/categories')).map(normalizeCategory).filter((category) => category.id > 0 && category.name);
}

// Prerequisite choices for the course form (React CreateCoursePage takes course
// ids). The API keeps only ids the author may see: their own courses and
// published, approved community courses, so offer exactly those, plus whatever
// is already set, and never the course itself.
async function prerequisiteChoices(token, courseId, currentIds = [], currentTitles = []) {
  const [mine, community] = await Promise.all([
    callCourse(token, 'GET', '/mine').catch(() => ({ data: [] })),
    callCourse(token, 'GET', '?per_page=50').catch(() => ({ data: [] }))
  ]);
  const selected = new Set(currentIds.map(Number));
  const choices = new Map();
  [...listFrom(mine), ...listFrom(community), ...currentTitles].forEach((row) => {
    const id = positiveInteger(row && row.id);
    const title = trimmed(row && row.title);
    if (!id || id === Number(courseId) || !title || choices.has(id)) return;
    choices.set(id, { id, title, checked: selected.has(id) });
  });
  return [...choices.values()].sort((left, right) => left.title.localeCompare(right.title, getRequestIntlLocale()));
}

function prerequisiteIdsFrom(body, courseId = null) {
  const raw = Array.isArray(body.prerequisites) ? body.prerequisites : (body.prerequisites === undefined ? [] : [body.prerequisites]);
  const ids = raw.map((value) => positiveInteger(String(value).trim())).filter((id) => id && id !== Number(courseId));
  return [...new Set(ids)];
}

function normalizeCohort(cohort) {
  const start = trimmed(cohort && cohort.start_date);
  const startDate = start ? new Date(start) : null;
  return {
    id: positiveInteger(cohort && cohort.id) || 0,
    name: trimmed(cohort && cohort.name),
    startLabel: startDate && !Number.isNaN(startDate.getTime())
      ? startDate.toLocaleDateString(getRequestIntlLocale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
      : ''
  };
}

async function courseDetailPayload(token, id) {
  const [courseResult, prerequisitesResult, reviewsResult, progressResult] = await Promise.all([
    callCourse(token, 'GET', `/${encodeURIComponent(id)}`),
    callCourse(token, 'GET', `/${encodeURIComponent(id)}/prerequisites`).catch(() => ({ data: [] })),
    callCourse(token, 'GET', `/${encodeURIComponent(id)}/reviews`).catch(() => ({ data: [] })),
    callCourse(token, 'GET', `/${encodeURIComponent(id)}/progress`).catch((error) => {
      if (error instanceof ApiError || error instanceof ApiOfflineError) return { data: {} };
      throw error;
    })
  ]);
  const course = normalizeCourse(objectFrom(courseResult));
  const progress = progressMaps(progressResult);
  const enrollmentStatus = trimmed(progress.enrollment.status);
  const isCompleted = enrollmentStatus === 'completed';
  const canReview = ['active', 'completed'].includes(enrollmentStatus);
  const prerequisites = listFrom(prerequisitesResult).map((item) => ({
    id: positiveInteger(item.id) || 0,
    title: titleFrom(item.title, ''),
    completed: !!item.completed
  })).filter((item) => item.title);

  return {
    course,
    sections: normalizeSections(course, progress),
    prerequisites,
    // React disables enrolment while a listed prerequisite is incomplete. The
    // list omits courses the member cannot open (F-183), so the API can still
    // refuse with PREREQUISITES_NOT_MET; that refusal has its own message.
    hasUnmetPrerequisites: prerequisites.some((item) => !item.completed),
    reviews: listFrom(reviewsResult).map(normalizeReview),
    isEnrolled: course.isEnrolled || !!enrollmentStatus,
    isCompleted,
    canReview,
    progress
  };
}

async function requireCourseAction(req, res, failureRedirect, action) {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  try {
    return await action(token);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, typeof failureRedirect === 'function' ? failureRedirect(error) : failureRedirect);
  }
}

function courseRedirect(id, status, suffix = '') {
  return `/courses/${id}?status=${encodeURIComponent(status)}${suffix}`;
}

function learnRedirect(id, status, lessonId = null) {
  const lesson = lessonId === null ? '' : `lesson=${encodeURIComponent(lessonId)}&`;
  return `/courses/${id}/learn?${lesson}status=${encodeURIComponent(status)}`;
}

function instructorRedirect(status) {
  return `/courses/instructor?status=${encodeURIComponent(status)}`;
}

function instructorCreateRedirect(status) {
  return `/courses/instructor/new?status=${encodeURIComponent(status)}`;
}

function instructorEditRedirect(id, status) {
  return `/courses/instructor/${id}/edit?status=${encodeURIComponent(status)}`;
}

function instructorGradingRedirect(id, status) {
  return `/courses/instructor/${id}/grading?status=${encodeURIComponent(status)}`;
}

// Preserve a rejected instructor course-form submission so the re-render keeps
// what the member typed rather than reverting to an empty create form or the
// saved course. Consumed exactly once by the matching GET. `courseId` is 0 for a
// create and the numeric id for an update, so a create stash cannot seed an
// unrelated edit page and an edit stash cannot seed the create page.
const COURSE_FORM_FIELDS = ['title', 'summary', 'description', 'level', 'visibility', 'credit_cost', 'category_id', 'enrollment_type'];

function storeCourseForm(req, courseId) {
  if (!req.session) return;
  const values = {};
  for (const field of COURSE_FORM_FIELDS) {
    values[field] = String(req.body[field] ?? '');
  }
  req.session.courseForm = { courseId, values };
}

// Read (and always clear) a stashed submission. Returns the raw field values only
// when the stash was scoped to this exact page (create vs a specific edit id);
// on any mismatch it still deletes the stash and returns null so the form falls
// back to defaults.
function consumeCourseForm(req, courseId) {
  const stored = req.session && req.session.courseForm ? req.session.courseForm : null;
  if (req.session && req.session.courseForm) delete req.session.courseForm;
  if (!stored) return null;
  return String(stored.courseId) === String(courseId) ? stored.values : null;
}

// Overlay a stashed submission onto a course view-model object, keeping the shape
// normalizeCourse produces (the fields the form template reads). Callers pass the
// base object (empty create defaults or the fetched course) plus the stash.
function applyCourseFormValues(course, values) {
  const creditCost = Number(values.credit_cost);
  return {
    ...course,
    title: trimmed(values.title, 200),
    summary: trimmed(values.summary, 500),
    description: trimmed(values.description, 20000),
    level: allowed(values.level, COURSE_LEVELS, course.level),
    visibility: allowed(values.visibility, COURSE_VISIBILITIES, course.visibility),
    enrollmentType: allowed(values.enrollment_type, COURSE_ENROLLMENT_TYPES, course.enrollmentType),
    creditCost: Number.isFinite(creditCost) ? Math.max(0, creditCost) : course.creditCost,
    categoryId: positiveInteger(values.category_id)
  };
}

// ---------------------------------------------------------------------------
// Lesson discussions (React LessonDiscussion). Enrolled learners, the author and
// admins may read and post; a member deletes only their own comment.
// ---------------------------------------------------------------------------

function normalizeComment(comment, currentUserId) {
  const userId = positiveInteger(comment.user_id) || positiveInteger(comment.user && comment.user.id);
  return {
    id: positiveInteger(comment.id) || 0,
    body: trimmed(comment.body, 10000),
    authorName: trimmed(comment.user && comment.user.name),
    postedLabel: comment.created_at ? reviewDateLabel(comment.created_at) : '',
    isOwn: currentUserId !== null && userId === currentUserId,
    replies: (Array.isArray(comment.replies) ? comment.replies : [])
      .filter((reply) => reply && typeof reply === 'object')
      .map((reply) => normalizeComment({ ...reply, replies: [] }, currentUserId))
      .filter((reply) => reply.id > 0 && reply.body)
  };
}

async function lessonDiscussion(req, token, courseId, lessonId) {
  let currentUserId = null;
  try {
    const profile = objectFrom(await getRequestProfile(req, token));
    currentUserId = positiveInteger(profile.id || profile.user_id);
  } catch {
    // Without the member's id nothing is offered for deletion.
  }
  try {
    const rows = listFrom(await callCourse(token, 'GET', `/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/discussions`));
    return {
      available: true,
      comments: rows
        .filter((row) => row && typeof row === 'object')
        .map((row) => normalizeComment(row, currentUserId))
        .filter((row) => row.id > 0 && row.body)
    };
  } catch (error) {
    if (isAuthError(error)) throw error;
    return { available: false, comments: [] };
  }
}

function discussionRedirect(courseId, lessonId, status) {
  return `/courses/${courseId}/learn?lesson=${encodeURIComponent(lessonId)}&status=${encodeURIComponent(status)}#lesson-discussion`;
}

// ---------------------------------------------------------------------------
// Single-lesson editor: release timing, free preview and quiz questions.
// ---------------------------------------------------------------------------

function lessonEditRedirect(courseId, lessonId, status = '', fragment = '') {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return `/courses/instructor/${courseId}/lessons/${lessonId}/edit${query}${fragment}`;
}

function findLesson(course, lessonId) {
  const wanted = Number(lessonId);
  const pools = [
    ...(Array.isArray(course.sections) ? course.sections.map((section) => section.lessons) : []),
    course.unassigned_lessons
  ];
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue;
    const found = pool.find((lesson) => lesson && Number(lesson.id) === wanted);
    if (found) return found;
  }
  return null;
}

function nonNegativeWholeNumber(value) {
  const text = trimmed(value);
  return /^\d{1,4}$/.test(text) ? Number(text) : null;
}

// Release timing is only read when the lesson editor sent it (`release_fields`),
// so the builder's add form and older forms never reset a lesson's schedule.
function releasePayload(body) {
  if (!checked(Array.isArray(body.release_fields) ? body.release_fields.at(-1) : body.release_fields)) {
    return { payload: {}, error: null };
  }
  const dripType = allowed(body.drip_type, LESSON_DRIP_TYPES, 'none');
  const previewRaw = Array.isArray(body.is_preview) ? body.is_preview.at(-1) : body.is_preview;
  const payload = { drip_type: dripType, drip_offset_days: null, drip_date: null, is_preview: checked(previewRaw) };
  if (dripType === 'days_after_enroll') {
    const days = nonNegativeWholeNumber(body.drip_offset_days);
    if (days === null) return { payload, error: 'drip-days-invalid' };
    payload.drip_offset_days = days;
  }
  if (dripType === 'fixed_date') {
    const date = readDate(body, 'drip_date', { required: true });
    if (date.error || !date.value) return { payload, error: 'drip-date-invalid' };
    payload.drip_date = date.value;
  }
  return { payload, error: null };
}

const LESSON_FORM_FIELDS = ['lesson_title', 'content_type', 'body', 'media_url', 'transcript', 'drip_type', 'drip_offset_days',
  'drip_date-day', 'drip_date-month', 'drip_date-year', 'is_preview', 'quiz_pass_mark', 'quiz_max_attempts'];
const QUESTION_FORM_FIELDS = ['question_prompt', 'question_type', 'question_options', 'question_correct'];

function stashForm(req, slot, lessonId, fields) {
  if (!req.session) return;
  const values = {};
  fields.forEach((field) => {
    const raw = req.body[field];
    values[field] = String(Array.isArray(raw) ? raw.at(-1) : (raw ?? ''));
  });
  req.session[slot] = { lessonId: Number(lessonId), values };
}

function takeForm(req, slot, lessonId) {
  if (!req.session || !req.session[slot]) return null;
  const stash = req.session[slot];
  delete req.session[slot];
  return Number(stash.lessonId) === Number(lessonId) && stash.values ? stash.values : null;
}

function quizSettingsFrom(body) {
  const pass = nonNegativeWholeNumber(body.quiz_pass_mark);
  const attempts = nonNegativeWholeNumber(body.quiz_max_attempts);
  return {
    pass_mark_percent: pass === null ? 70 : Math.min(100, pass),
    max_attempts: attempts === null ? 0 : attempts
  };
}

// React CourseBuilder creates the quiz the first time a quiz lesson is saved.
async function createLessonQuiz(token, courseId, lessonId, title, body) {
  return callCourse(token, 'POST', `/${encodeURIComponent(courseId)}/quizzes`, {
    lesson_id: Number(lessonId),
    title,
    ...quizSettingsFrom(body)
  });
}

function questionLetter(index) {
  return String.fromCharCode(97 + index);
}

// The form a learner answers (learn.njk) reads options as {id, label} and the API
// marks by comparing option ids, so authored questions are built the same way
// React CourseBuilder builds them: option ids a, b, c... and `correct` as a list.
function questionPayload(body) {
  const prompt = trimmed(body.question_prompt, 2000);
  if (prompt === '') return { error: 'question-prompt-missing' };
  const type = allowed(body.question_type, QUESTION_TYPES, 'mcq');
  const position = nonNegativeWholeNumber(body.question_position);
  const base = { type, prompt };

  if (type === 'short') {
    return { payload: { ...base, points: 1, position: position === null ? 0 : position } };
  }

  let options;
  if (type === 'truefalse') {
    options = [
      { id: 'true', label: translateForRequest('govuk_alpha_courses.lesson_editor.true_label') },
      { id: 'false', label: translateForRequest('govuk_alpha_courses.lesson_editor.false_label') }
    ];
  } else {
    const labels = String(body.question_options || '').split(/\r?\n/)
      .map((line) => trimmed(line, 500))
      .filter(Boolean)
      .slice(0, QUESTION_OPTION_LIMIT);
    if (labels.length < 2) return { error: 'question-options-missing' };
    options = labels.map((label, index) => ({ id: questionLetter(index), label }));
  }

  const numbers = String(body.question_correct || '').split(/[\s,]+/).filter(Boolean);
  const picked = [...new Set(numbers.map((value) => (/^\d+$/.test(value) ? Number(value) : NaN)))];
  const valid = picked.length > 0 && picked.every((n) => Number.isInteger(n) && n >= 1 && n <= options.length);
  if (!valid || (type !== 'multi' && picked.length !== 1)) return { error: 'question-correct-invalid' };

  return {
    payload: {
      ...base,
      options,
      correct: picked.sort((a, b) => a - b).map((n) => options[n - 1].id),
      points: 1,
      position: position === null ? 0 : position
    }
  };
}

function normalizeQuestion(question) {
  const options = Array.isArray(question.options) ? question.options : [];
  return {
    id: positiveInteger(question.id) || 0,
    prompt: trimmed(question.prompt, 2000),
    type: allowed(question.type, [...QUESTION_TYPES, 'essay'], 'short'),
    options: options.map((option) => trimmed(option && typeof option === 'object' ? option.label : option, 500)).filter(Boolean)
  };
}

// Move one id up or down in the order the page showed. The API takes both lists
// and refuses (409) if the real order has changed since.
function movedOrder(orderText, itemId, direction) {
  const expected = String(orderText || '').split(',').map((value) => positiveInteger(value.trim())).filter(Boolean);
  if (new Set(expected).size !== expected.length) return null;
  const index = expected.indexOf(Number(itemId));
  if (index < 0) return null;
  const target = direction === 'up' ? index - 1 : (direction === 'down' ? index + 1 : -1);
  if (target < 0 || target >= expected.length) return { expected, ordered: null };
  const ordered = [...expected];
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  return { expected, ordered };
}

async function applyMove(req, res, apiPath, itemId) {
  const courseId = req.params.id;
  const builder = `/courses/instructor/${courseId}/edit`;
  const move = movedOrder(req.body.order, itemId, trimmed(req.body.direction));
  if (move === null) return redirectTo(res, `${builder}?status=order-failed#curriculum`);
  if (move.ordered === null) return redirectTo(res, `${builder}#curriculum`);

  return requireCourseAction(req, res, (error) => {
    const status = error instanceof ApiError && error.status === 409 ? 'order-changed' : 'order-failed';
    return `${builder}?status=${status}#curriculum`;
  }, async (token) => {
    await callCourse(token, 'PUT', apiPath, { expected_ids: move.expected, ordered_ids: move.ordered });
    return redirectTo(res, `${builder}?status=order-saved#curriculum`);
  });
}

router.get('/', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (token === null) return undefined;

  const query = courseQueryPath(req);

  try {
    const [coursesResult, categories] = await Promise.all([
      callCourse(token, 'GET', query.path),
      courseCategories(token)
    ]);

    return res.render('courses/index', {
      title: (res.locals.t ? res.locals.t('govuk_alpha.courses.title') : 'Courses'),
      activeNav: 'explore',
      courses: listFrom(coursesResult).map(normalizeCourse),
      pagination: coursePagination(query, coursesResult && coursesResult.meta),
      categories,
      coursesQuery: query.q,
      courseCategoryId: query.categoryId,
      courseLevel: query.level,
      levels: COURSE_LEVELS.map((level) => ({ value: level, label: enumLabel(COURSE_LEVEL_LABEL_KEYS, level) }))
    });
  } catch (error) {
    if (handleCourseGetError(error, res)) return undefined;
    throw error;
  }
}));

router.get('/mine', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (token === null) return undefined;

  try {
    const result = await getMyCourses(token);
    return res.render('courses/my-learning', {
      title: (res.locals.t ? res.locals.t('govuk_alpha_commerce.my_learning.title') : 'My learning'),
      activeNav: 'explore',
      enrollments: listFrom(result).map(normalizeEnrollment)
    });
  } catch (error) {
    if (handleCourseGetError(error, res)) return undefined;
    throw error;
  }
}));

router.get('/instructor', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (token === null) return undefined;

  try {
    const result = await callCourse(token, 'GET', '/mine');
    return res.render('courses/instructor', {
      title: (res.locals.t ? res.locals.t('govuk_alpha_commerce.instructor.title') : 'Courses you teach'),
      activeNav: 'explore',
      courses: listFrom(result).map(normalizeInstructorCourse),
      canAuthor: true,
      status: routeStatus(req.query, INSTRUCTOR_STATUS_MESSAGES, res.locals.t)
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return res.render('courses/instructor', {
        title: (res.locals.t ? res.locals.t('govuk_alpha_commerce.instructor.title') : 'Courses you teach'),
        activeNav: 'explore',
        courses: [],
        canAuthor: false,
        status: routeStatus(req.query, INSTRUCTOR_STATUS_MESSAGES, res.locals.t)
      });
    }
    if (handleCourseGetError(error, res)) return undefined;
    throw error;
  }
}));

router.get('/instructor/new', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (token === null) return undefined;

  try {
    // A rejected create submission is stashed in the session; consume it once and
    // echo the typed values back. `titlePrefilled` tells the template this is a
    // prefilled create (course.id is 0) so it renders the typed title instead of
    // hiding it. A fresh create has no stash and keeps the empty form.
    const stashedForm = consumeCourseForm(req, 0);
    const course = stashedForm
      ? { ...applyCourseFormValues(normalizeCourse({}), stashedForm), titlePrefilled: true }
      : normalizeCourse({});

    return res.render('courses/form', {
      title: (res.locals.t ? res.locals.t('govuk_alpha_commerce.instructor.title_create') : 'Create a course'),
      activeNav: 'explore',
      mode: 'create',
      course,
      formAction: '/courses/instructor/new',
      categories: await courseCategories(token),
      // The course form template translates each option label itself from the
      // option's value; the English `label` fields it never read are gone.
      levels: COURSE_LEVELS.map((value) => ({ value })),
      visibilities: COURSE_VISIBILITIES.map((value) => ({ value })),
      enrollmentTypes: COURSE_ENROLLMENT_TYPES.map((value) => ({ value })),
      contentTypes: LESSON_CONTENT_TYPES.map((value) => ({ value })),
      builderSections: [],
      builderUnsectioned: [],
      prerequisiteChoices: await prerequisiteChoices(token, 0),
      cohorts: [],
      status: routeStatus(req.query, FORM_STATUS_MESSAGES, res.locals.t)
    });
  } catch (error) {
    if (handleCourseGetError(error, res)) return undefined;
    throw error;
  }
}));

router.get('/instructor/:id(\\d+)/edit', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (token === null) return undefined;

  try {
    const [payload, categories] = await Promise.all([
      courseDetailPayload(token, req.params.id),
      courseCategories(token)
    ]);

    // A rejected save for THIS course is stashed in the session; consume it once
    // and overlay the typed values onto the fetched course, keeping the fetched
    // id and status so the builder/publish sections stay correct. A stash scoped
    // to a different id (or to a create) is discarded by consumeCourseForm.
    const stashedForm = consumeCourseForm(req, req.params.id);
    const course = stashedForm
      ? applyCourseFormValues(payload.course, stashedForm)
      : payload.course;
    const currentPrerequisiteIds = Array.isArray(payload.course.prerequisites)
      ? payload.course.prerequisites
      : payload.prerequisites.map((item) => item.id);
    const [choices, cohortsResult] = await Promise.all([
      prerequisiteChoices(token, req.params.id, currentPrerequisiteIds, payload.prerequisites),
      payload.course.enrollmentType === 'cohort'
        ? callCourse(token, 'GET', `/${encodeURIComponent(req.params.id)}/cohorts`).catch(() => ({ data: [] }))
        : Promise.resolve(null)
    ]);

    return res.render('courses/form', {
      title: (res.locals.t ? res.locals.t('govuk_alpha_commerce.instructor.title_edit') : 'Edit your course'),
      activeNav: 'explore',
      mode: 'edit',
      course,
      formAction: `/courses/instructor/${req.params.id}/update`,
      categories,
      // The course form template translates each option label itself from the
      // option's value; the English `label` fields it never read are gone.
      levels: COURSE_LEVELS.map((value) => ({ value })),
      visibilities: COURSE_VISIBILITIES.map((value) => ({ value })),
      enrollmentTypes: COURSE_ENROLLMENT_TYPES.map((value) => ({ value })),
      contentTypes: LESSON_CONTENT_TYPES.map((value) => ({ value })),
      // Move up / move down send the order the page showed (the API checks it).
      builderSections: payload.sections.map((section) => ({ ...section, lessonOrder: section.lessons.map((lesson) => lesson.id).join(',') })),
      sectionOrder: payload.sections.map((section) => section.id).join(','),
      builderUnsectioned: [],
      prerequisiteChoices: choices,
      showCohorts: payload.course.enrollmentType === 'cohort',
      cohorts: listFrom(cohortsResult).map(normalizeCohort).filter((cohort) => cohort.name),
      status: routeStatus(req.query, FORM_STATUS_MESSAGES, res.locals.t)
    });
  } catch (error) {
    if (handleCourseGetError(error, res)) return undefined;
    throw error;
  }
}));

router.get('/instructor/:id(\\d+)/analytics', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (token === null) return undefined;

  try {
    const payload = normalizeAnalytics(await callCourse(token, 'GET', `/${encodeURIComponent(req.params.id)}/analytics`), res.locals.t);
    return res.render('courses/analytics', {
      title: (res.locals.t ? res.locals.t('govuk_alpha_commerce.analytics.title') : 'Course analytics'),
      activeNav: 'explore',
      ...payload
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return res.status(403).render('errors/403', { title: (res.locals.t ? res.locals.t('govuk_alpha.error_pages.403_title') : 'Forbidden') });
    }
    if (handleCourseGetError(error, res)) return undefined;
    throw error;
  }
}));

router.get('/instructor/:id(\\d+)/grading', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (token === null) return undefined;

  try {
    const [courseResult, attemptsResult] = await Promise.all([
      callCourse(token, 'GET', `/${encodeURIComponent(req.params.id)}`),
      callCourse(token, 'GET', `/${encodeURIComponent(req.params.id)}/grading`)
    ]);
    const course = normalizeCourse(objectFrom(courseResult));

    return res.render('courses/grading', {
      title: (res.locals.t ? res.locals.t('govuk_alpha_commerce.grading.title') : 'Grading queue'),
      activeNav: 'explore',
      courseId: req.params.id,
      course,
      attempts: listFrom(attemptsResult).map(normalizeAttempt),
      status: routeStatus(req.query, GRADING_STATUS_MESSAGES, res.locals.t)
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return res.status(403).render('errors/403', { title: (res.locals.t ? res.locals.t('govuk_alpha.error_pages.403_title') : 'Forbidden') });
    }
    if (handleCourseGetError(error, res)) return undefined;
    throw error;
  }
}));

router.get('/:id(\\d+)/certificate', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (token === null) return undefined;

  try {
    const result = await callCourse(token, 'GET', `/${encodeURIComponent(req.params.id)}/certificate`);
    const data = objectFrom(result);
    const html = typeof data.html === 'string' ? data.html : '';
    if (!html) {
      return redirectTo(res, courseRedirect(req.params.id, 'certificate-failed'));
    }
    return res.type('html').send(html);
  } catch (error) {
    if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
      const status = error.status === 403 ? 'certificate-locked' : 'certificate-failed';
      return redirectTo(res, courseRedirect(req.params.id, status));
    }
    if (handleCourseGetError(error, res)) return undefined;
    throw error;
  }
}));

router.get('/:id(\\d+)/learn', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (token === null) return undefined;

  try {
    const payload = await courseDetailPayload(token, req.params.id);
    if (!payload.isEnrolled) {
      return redirectTo(res, courseRedirect(req.params.id, 'enrol-required'));
    }

    const requestedLessonId = positiveInteger(req.query.lesson);
    const currentLesson = firstAvailableLesson(payload.sections, requestedLessonId);

    if (currentLesson && currentLesson.contentType === 'quiz' && currentLesson.quizId !== null) {
      try {
        currentLesson.quiz = objectFrom(await callCourse(token, 'GET', `/quizzes/${encodeURIComponent(currentLesson.quizId)}`));
      } catch (error) {
        if (!(error instanceof ApiError && [403, 404].includes(error.status))) {
          throw error;
        }
        currentLesson.quiz = null;
      }
    }

    const discussion = currentLesson ? await lessonDiscussion(req, token, req.params.id, currentLesson.id) : null;

    return res.render('courses/learn', {
      title: payload.course.title,
      activeNav: 'explore',
      course: payload.course,
      sections: payload.sections,
      currentLesson,
      discussion,
      progressPercent: Math.round(Number(payload.progress.enrollment.progress_percent || 0)),
      isCompleted: payload.isCompleted,
      status: routeStatus(req.query, LEARN_STATUS_MESSAGES, res.locals.t)
    });
  } catch (error) {
    if (handleCourseGetError(error, res)) return undefined;
    throw error;
  }
}));

router.get('/:id(\\d+)', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (token === null) return undefined;

  try {
    const [payload, profileResult] = await Promise.all([
      courseDetailPayload(token, req.params.id),
      getRequestProfile(req, token).catch(() => null)
    ]);
    const profile = objectFrom(profileResult);
    const viewerId = positiveInteger(profile.id);
    const authorId = positiveInteger(payload.course.author_user_id);
    return res.render('courses/detail', {
      title: payload.course.title,
      activeNav: 'explore',
      ...payload,
      // Same test React uses: the author manages the course instead of joining it.
      isOwner: viewerId !== null && viewerId === authorId,
      status: routeStatus(req.query, COURSE_STATUS_MESSAGES, res.locals.t)
    });
  } catch (error) {
    if (handleCourseGetError(error, res)) return undefined;
    throw error;
  }
}));

// Course slug links (React accepts /courses/{slug}). GET /v2/courses/{idOrSlug}
// resolves either, so a slug is looked up once and redirected to the numeric
// page every other route here is built on. The pattern only admits slug
// characters (no `*`: Express 4 turns it into `.*`), so an encoded path
// separator can never reach the API path.
router.get('/:slug([a-zA-Z0-9_-]+)', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (token === null) return undefined;

  try {
    const course = objectFrom(await callCourse(token, 'GET', `/${encodeURIComponent(req.params.slug)}`));
    const id = positiveInteger(course.id);
    if (id === null) {
      return res.status(404).render('errors/404', { title: (res.locals.t ? res.locals.t('govuk_alpha.error_pages.404_title') : 'Page not found') });
    }
    return redirectTo(res, `/courses/${id}`);
  } catch (error) {
    if (handleCourseGetError(error, res)) return undefined;
    throw error;
  }
}));

function coursePayload(body, courseId = null) {
  const title = trimmed(body.title, 200);
  if (title === '') {
    return null;
  }

  const payload = {
    title,
    summary: trimmed(body.summary, 500),
    description: trimmed(body.description, 20000),
    level: allowed(body.level, COURSE_LEVELS, 'beginner'),
    visibility: allowed(body.visibility, COURSE_VISIBILITIES, 'members'),
    enrollment_type: allowed(body.enrollment_type, COURSE_ENROLLMENT_TYPES, 'self_paced')
  };

  const creditCost = trimmed(body.credit_cost);
  if (creditCost !== '' && Number.isFinite(Number(creditCost))) {
    payload.credit_cost = Math.max(0, Number(creditCost));
  }

  payload.category_id = positiveInteger(body.category_id);
  // Only a form that rendered the prerequisite checkboxes may change them, so a
  // submission without the field never wipes prerequisites by accident.
  if (String(body.prerequisites_field || '') === '1') {
    payload.prerequisites = prerequisiteIdsFrom(body, courseId);
  }
  return payload;
}

function reviewPayload(body) {
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return null;
  }

  return {
    rating,
    body: trimmed(body.body, 2000)
  };
}

function sectionPayload(body) {
  const title = trimmed(body.section_title, 200);
  return title === '' ? null : { title };
}

function lessonPayload(body) {
  const title = trimmed(body.lesson_title, 200);
  if (title === '') {
    return null;
  }

  const contentType = allowed(body.content_type, LESSON_CONTENT_TYPES, 'text');
  const payload = {
    title,
    content_type: contentType,
    body: trimmed(body.body, 50000)
  };

  const sectionId = positiveInteger(body.section_id);
  if (sectionId !== null) {
    payload.section_id = sectionId;
  }

  const mediaUrl = trimmed(body.media_url);
  if (contentType === 'video') {
    payload.video_url = mediaUrl;
  } else if (contentType === 'pdf') {
    payload.attachment_url = mediaUrl;
  } else if (contentType === 'embed') {
    payload.embed_url = mediaUrl;
  }

  // Only meaningful for media a learner cannot read: sending it on a text
  // lesson would store a transcript of nothing.
  if (contentType === 'video' || contentType === 'embed') {
    payload.transcript = trimmed(body.transcript, 100000);
  }

  return payload;
}

function gradePayload(body) {
  return {
    score_percent: boundedNumber(body.score_percent, 0, 100) || 0,
    passed: checked(body.passed),
    feedback: optionalText(body.feedback, 5000)
  };
}

function completionPayload(body) {
  const watchPercent = boundedNumber(body.watch_percent, 0, 100);
  return watchPercent === null ? undefined : { watch_percent: watchPercent };
}

function quizAnswers(body) {
  if (body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)) {
    return body.answers;
  }

  const answers = {};
  Object.entries(body).forEach(([key, value]) => {
    const match = key.match(/^answers\[([^\]]+)\](?:\[\])?$/);
    if (match) {
      answers[match[1]] = value;
    }
  });

  return answers;
}

function enrolFailureStatus(error) {
  const code = errorCode(error) || firstErrorCode(error);
  if (code === 'INSUFFICIENT_CREDITS') return 'insufficient-credits';
  if (code === 'COURSE_NOT_AVAILABLE') return 'not-available';
  if (code === 'PREREQUISITES_NOT_MET') return 'prerequisites-not-met';
  return 'enrol-failed';
}

// respondWithError puts the code in errors[0].code, not error.code.
function firstErrorCode(error) {
  if (!(error instanceof ApiError) || !error.data || !Array.isArray(error.data.errors)) return '';
  const first = error.data.errors.find((entry) => entry && typeof entry === 'object' && entry.code);
  return first ? String(first.code).toUpperCase() : '';
}

function reviewFailureStatus(error) {
  const code = errorCode(error);
  if (code === 'NOT_ENROLLED') return 'review-not-enrolled';
  if (code === 'VALIDATION_FAILED') return 'review-invalid';
  return 'review-failed';
}

function quizStatus(result) {
  const data = dataFrom(result);
  if (data && typeof data === 'object') {
    if (data.needs_review) return 'quiz-pending-review';
    if (data.passed) return 'quiz-passed';
  }

  return 'quiz-failed';
}

router.post('/:id(\\d+)/enrol', asyncRoute(async (req, res) => {
  return requireCourseAction(req, res, (error) => courseRedirect(req.params.id, enrolFailureStatus(error)), async (token) => {
    await callCourse(token, 'POST', `/${encodeURIComponent(req.params.id)}/enroll`);
    return redirectTo(res, courseRedirect(req.params.id, 'enrolled'));
  });
}));

router.post('/:id(\\d+)/lessons/:lessonId(\\d+)/complete', asyncRoute(async (req, res) => {
  return requireCourseAction(req, res, learnRedirect(req.params.id, 'lesson-completed'), async (token) => {
    const result = await callCourse(token, 'POST', `/${encodeURIComponent(req.params.id)}/lessons/${encodeURIComponent(req.params.lessonId)}/complete`, completionPayload(req.body));
    const data = dataFrom(result);
    const status = data && typeof data === 'object' && data.course_completed
      ? 'course-completed'
      : 'lesson-completed';
    return redirectTo(res, learnRedirect(req.params.id, status));
  });
}));

router.post('/:id(\\d+)/lessons/:lessonId(\\d+)/quiz', asyncRoute(async (req, res) => {
  return requireCourseAction(req, res, learnRedirect(req.params.id, 'quiz-error', req.params.lessonId), async (token) => {
    const quizId = positiveInteger(req.body.quiz_id || req.body.quizId);
    if (quizId === null) {
      return redirectTo(res, learnRedirect(req.params.id, 'quiz-error', req.params.lessonId));
    }

    try {
      const result = await callCourse(token, 'POST', `/quizzes/${encodeURIComponent(quizId)}/attempt`, {
        answers: quizAnswers(req.body)
      });
      return redirectTo(res, learnRedirect(req.params.id, quizStatus(result), req.params.lessonId));
    } catch (error) {
      if (redirectOnAuthError(error, res)) return undefined;
      const status = errorCode(error) === 'MAX_ATTEMPTS_REACHED' ? 'quiz-no-attempts' : 'quiz-error';
      return redirectTo(res, learnRedirect(req.params.id, status, req.params.lessonId));
    }
  });
}));

router.post('/:id(\\d+)/reviews', asyncRoute(async (req, res) => {
  const payload = reviewPayload(req.body);
  if (payload === null) {
    return redirectTo(res, courseRedirect(req.params.id, 'review-invalid', '#reviews'));
  }

  return requireCourseAction(req, res, (error) => courseRedirect(req.params.id, reviewFailureStatus(error), '#reviews'), async (token) => {
    await callCourse(token, 'POST', `/${encodeURIComponent(req.params.id)}/reviews`, payload);
    return redirectTo(res, courseRedirect(req.params.id, 'review-saved', '#reviews'));
  });
}));

router.post('/instructor/new', asyncRoute(async (req, res) => {
  const payload = coursePayload(req.body);
  if (payload === null) {
    storeCourseForm(req, 0);
    return redirectTo(res, instructorCreateRedirect('create-failed'));
  }

  return requireCourseAction(req, res, () => {
    storeCourseForm(req, 0);
    return instructorCreateRedirect('create-failed');
  }, async (token) => {
    const result = await callCourse(token, 'POST', '', payload);
    const id = resultId(result);
    if (id === null) {
      storeCourseForm(req, 0);
      return redirectTo(res, instructorCreateRedirect('create-failed'));
    }
    return redirectTo(res, instructorEditRedirect(id, 'created'));
  });
}));

router.post('/instructor/:id(\\d+)/update', asyncRoute(async (req, res) => {
  const payload = coursePayload(req.body, req.params.id);
  if (payload === null) {
    storeCourseForm(req, req.params.id);
    return redirectTo(res, instructorEditRedirect(req.params.id, 'save-failed'));
  }

  return requireCourseAction(req, res, () => {
    storeCourseForm(req, req.params.id);
    return instructorEditRedirect(req.params.id, 'save-failed');
  }, async (token) => {
    await callCourse(token, 'PUT', `/${encodeURIComponent(req.params.id)}`, payload);
    return redirectTo(res, instructorEditRedirect(req.params.id, 'saved'));
  });
}));

router.post('/instructor/:id(\\d+)/publish', asyncRoute(async (req, res) => {
  return requireCourseAction(req, res, instructorEditRedirect(req.params.id, 'publish-failed'), async (token) => {
    const result = await callCourse(token, 'POST', `/${encodeURIComponent(req.params.id)}/publish`);
    const data = dataFrom(result);
    const status = data && typeof data === 'object' && data.moderation_status === 'approved'
      ? 'published'
      : 'pending-review';
    return redirectTo(res, instructorEditRedirect(req.params.id, status));
  });
}));

router.post('/instructor/:id(\\d+)/unpublish', asyncRoute(async (req, res) => {
  return requireCourseAction(req, res, instructorEditRedirect(req.params.id, 'unpublish-failed'), async (token) => {
    await callCourse(token, 'POST', `/${encodeURIComponent(req.params.id)}/unpublish`);
    return redirectTo(res, instructorEditRedirect(req.params.id, 'unpublished'));
  });
}));

router.post('/instructor/:id(\\d+)/delete', asyncRoute(async (req, res) => {
  return requireCourseAction(req, res, instructorRedirect('delete-failed'), async (token) => {
    await callCourse(token, 'DELETE', `/${encodeURIComponent(req.params.id)}`);
    return redirectTo(res, instructorRedirect('deleted'));
  });
}));

router.post('/instructor/:id(\\d+)/grading/:attemptId(\\d+)', asyncRoute(async (req, res) => {
  // The score box is a text field (GOV.UK "ask for numbers"), so the browser no longer
  // refuses "abc" or 150. A typed score that is not a number from 0 to 100 is an error,
  // not a clamped or zeroed grade. A blank box keeps its old meaning.
  const scoreText = trimmed(req.body.score_percent);
  const score = Number(scoreText);
  if (scoreText !== '' && (!Number.isFinite(score) || score < 0 || score > 100)) {
    return redirectTo(res, instructorGradingRedirect(req.params.id, 'grade-failed'));
  }
  return requireCourseAction(req, res, instructorGradingRedirect(req.params.id, 'grade-failed'), async (token) => {
    await callCourse(token, 'POST', `/attempts/${encodeURIComponent(req.params.attemptId)}/grade`, gradePayload(req.body));
    return redirectTo(res, instructorGradingRedirect(req.params.id, 'graded'));
  });
}));

// Add a cohort (React CreateCoursePage). The API checks course ownership.
router.post('/instructor/:id(\\d+)/cohorts', asyncRoute(async (req, res) => {
  const name = trimmed(req.body.cohort_name, 200);
  if (name === '') {
    return redirectTo(res, instructorEditRedirect(req.params.id, 'cohort-name-missing'));
  }

  return requireCourseAction(req, res, instructorEditRedirect(req.params.id, 'cohort-failed'), async (token) => {
    await callCourse(token, 'POST', `/${encodeURIComponent(req.params.id)}/cohorts`, { name });
    return redirectTo(res, instructorEditRedirect(req.params.id, 'cohort-added'));
  });
}));

router.post('/instructor/:id(\\d+)/sections', asyncRoute(async (req, res) => {
  const payload = sectionPayload(req.body);
  if (payload === null) {
    return redirectTo(res, instructorEditRedirect(req.params.id, 'section-title-missing'));
  }

  return requireCourseAction(req, res, instructorEditRedirect(req.params.id, 'section-failed'), async (token) => {
    await callCourse(token, 'POST', `/${encodeURIComponent(req.params.id)}/sections`, payload);
    return redirectTo(res, instructorEditRedirect(req.params.id, 'section-added'));
  });
}));

router.post('/instructor/:id(\\d+)/sections/:sectionId(\\d+)/update', asyncRoute(async (req, res) => {
  const payload = sectionPayload(req.body);
  if (payload === null) {
    return redirectTo(res, instructorEditRedirect(req.params.id, 'section-title-missing'));
  }

  return requireCourseAction(req, res, instructorEditRedirect(req.params.id, 'section-failed'), async (token) => {
    await callCourse(token, 'PUT', `/${encodeURIComponent(req.params.id)}/sections/${encodeURIComponent(req.params.sectionId)}`, payload);
    return redirectTo(res, instructorEditRedirect(req.params.id, 'section-saved'));
  });
}));

router.post('/instructor/:id(\\d+)/sections/:sectionId(\\d+)/delete', asyncRoute(async (req, res) => {
  return requireCourseAction(req, res, instructorEditRedirect(req.params.id, 'section-failed'), async (token) => {
    await callCourse(token, 'DELETE', `/${encodeURIComponent(req.params.id)}/sections/${encodeURIComponent(req.params.sectionId)}`);
    return redirectTo(res, instructorEditRedirect(req.params.id, 'section-deleted'));
  });
}));

router.post('/instructor/:id(\\d+)/lessons', asyncRoute(async (req, res) => {
  const payload = lessonPayload(req.body);
  if (payload === null) {
    return redirectTo(res, instructorEditRedirect(req.params.id, 'lesson-title-missing'));
  }

  return requireCourseAction(req, res, instructorEditRedirect(req.params.id, 'lesson-failed'), async (token) => {
    const result = await callCourse(token, 'POST', `/${encodeURIComponent(req.params.id)}/lessons`, payload);
    if (payload.content_type !== 'quiz') {
      return redirectTo(res, instructorEditRedirect(req.params.id, 'lesson-added'));
    }
    // A quiz lesson needs its quiz before questions can be added; the author is
    // taken straight to the lesson to add them.
    const lessonId = resultId(result);
    if (lessonId === null) return redirectTo(res, instructorEditRedirect(req.params.id, 'lesson-added'));
    try {
      await createLessonQuiz(token, req.params.id, lessonId, payload.title, req.body);
    } catch (error) {
      if (redirectOnAuthError(error, res)) return undefined;
      return redirectTo(res, lessonEditRedirect(req.params.id, lessonId, 'lesson-quiz-failed'));
    }
    return redirectTo(res, lessonEditRedirect(req.params.id, lessonId, 'lesson-added'));
  });
}));

router.post('/instructor/:id(\\d+)/lessons/:lessonId(\\d+)/update', asyncRoute(async (req, res) => {
  const payload = lessonPayload(req.body);
  if (payload === null) {
    return redirectTo(res, instructorEditRedirect(req.params.id, 'lesson-title-missing'));
  }
  const release = releasePayload(req.body);
  if (release.error) {
    stashForm(req, 'lessonForm', req.params.lessonId, LESSON_FORM_FIELDS);
    return redirectTo(res, lessonEditRedirect(req.params.id, req.params.lessonId, release.error));
  }

  return requireCourseAction(req, res, instructorEditRedirect(req.params.id, 'lesson-failed'), async (token) => {
    await callCourse(token, 'PUT', `/${encodeURIComponent(req.params.id)}/lessons/${encodeURIComponent(req.params.lessonId)}`, { ...payload, ...release.payload });
    if (payload.content_type === 'quiz') {
      // A lesson changed to a quiz gets its quiz now, unless it already has one.
      try {
        const course = objectFrom(await callCourse(token, 'GET', `/${encodeURIComponent(req.params.id)}`));
        const lesson = findLesson(course, req.params.lessonId);
        const hasQuiz = lesson && (positiveInteger(lesson.quiz_id) || positiveInteger(lesson.quiz && lesson.quiz.id));
        if (!hasQuiz) await createLessonQuiz(token, req.params.id, req.params.lessonId, payload.title, req.body);
      } catch (error) {
        if (redirectOnAuthError(error, res)) return undefined;
        return redirectTo(res, lessonEditRedirect(req.params.id, req.params.lessonId, 'lesson-quiz-failed'));
      }
    }
    return redirectTo(res, instructorEditRedirect(req.params.id, 'lesson-saved'));
  });
}));

router.get('/instructor/:id(\\d+)/lessons/:lessonId(\\d+)/edit', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (token === null) return undefined;

  try {
    const course = objectFrom(await callCourse(token, 'GET', `/${encodeURIComponent(req.params.id)}`));
    const rawLesson = findLesson(course, req.params.lessonId);
    if (!rawLesson) {
      return res.status(404).render('errors/404', { title: (res.locals.t ? res.locals.t('govuk_alpha.error_pages.404_title') : 'Page not found') });
    }
    const lesson = normalizeLesson(rawLesson);
    const sections = (Array.isArray(course.sections) ? course.sections : [])
      .map((section) => ({ id: positiveInteger(section.id) || 0, title: trimmed(section.title) }))
      .filter((section) => section.id > 0);

    // The author's view of a quiz's questions. GET /quizzes/{id} is the only
    // read the API offers and it requires an enrolment, so for an author who is
    // not enrolled the list cannot be shown; adding questions still works.
    let questions = [];
    let questionsAvailable = true;
    if (lesson.contentType === 'quiz' && lesson.quizId !== null) {
      try {
        const quiz = objectFrom(await callCourse(token, 'GET', `/quizzes/${encodeURIComponent(lesson.quizId)}`));
        questions = (Array.isArray(quiz.questions) ? quiz.questions : []).map(normalizeQuestion).filter((q) => q.id > 0);
      } catch (error) {
        if (isAuthError(error)) throw error;
        questionsAvailable = false;
      }
    }

    const lessonForm = takeForm(req, 'lessonForm', lesson.id);
    const questionForm = takeForm(req, 'questionForm', lesson.id) || {};
    const form = lessonForm ? {
      title: lessonForm.lesson_title,
      contentType: allowed(lessonForm.content_type, LESSON_CONTENT_TYPES, lesson.contentType),
      body: lessonForm.body,
      mediaUrl: lessonForm.media_url,
      transcript: lessonForm.transcript,
      dripType: allowed(lessonForm.drip_type, LESSON_DRIP_TYPES, 'none'),
      dripOffsetDays: lessonForm.drip_offset_days,
      dripDateParts: { day: lessonForm['drip_date-day'], month: lessonForm['drip_date-month'], year: lessonForm['drip_date-year'] },
      isPreview: checked(lessonForm.is_preview)
    } : {
      title: lesson.title,
      contentType: lesson.contentType,
      body: trimmed(rawLesson.body),
      mediaUrl: lesson.videoUrl || lesson.attachmentUrl || lesson.embedUrl,
      transcript: lesson.transcript,
      dripType: lesson.dripType,
      dripOffsetDays: lesson.dripOffsetDays === null ? '' : String(lesson.dripOffsetDays),
      dripDateParts: splitDate(lesson.dripDate),
      isPreview: lesson.isPreview
    };

    return res.render('courses/lesson-edit', {
      title: (res.locals.t ? res.locals.t('govuk_alpha_courses.lesson_editor.edit_title') : 'Edit lesson'),
      activeNav: 'explore',
      course: { id: positiveInteger(course.id) || Number(req.params.id), title: trimmed(course.title) },
      lesson,
      form,
      sections,
      contentTypes: LESSON_CONTENT_TYPES,
      questions,
      questionsAvailable,
      questionForm: { type: allowed(questionForm.question_type, QUESTION_TYPES, 'mcq'), ...questionForm },
      questionTypes: QUESTION_TYPES,
      status: routeStatus(req.query, LESSON_EDIT_STATUS_MESSAGES, res.locals.t)
    });
  } catch (error) {
    if (handleCourseGetError(error, res)) return undefined;
    throw error;
  }
}));

router.post('/instructor/:id(\\d+)/lessons/:lessonId(\\d+)/questions', asyncRoute(async (req, res) => {
  const { id, lessonId } = req.params;
  const quizId = positiveInteger(req.body.quiz_id);
  const built = questionPayload(req.body);
  if (quizId === null || built.error) {
    stashForm(req, 'questionForm', lessonId, QUESTION_FORM_FIELDS);
    return redirectTo(res, lessonEditRedirect(id, lessonId, built.error || 'question-failed', '#add-question'));
  }

  return requireCourseAction(req, res, () => {
    stashForm(req, 'questionForm', lessonId, QUESTION_FORM_FIELDS);
    return lessonEditRedirect(id, lessonId, 'question-failed', '#add-question');
  }, async (token) => {
    await callCourse(token, 'POST', `/${encodeURIComponent(id)}/quizzes/${encodeURIComponent(quizId)}/questions`, built.payload);
    return redirectTo(res, lessonEditRedirect(id, lessonId, 'question-added', '#quiz-questions'));
  });
}));

router.post('/instructor/:id(\\d+)/lessons/:lessonId(\\d+)/questions/:questionId(\\d+)/delete', asyncRoute(async (req, res) => {
  const { id, lessonId, questionId } = req.params;
  const quizId = positiveInteger(req.body.quiz_id);
  if (quizId === null) return redirectTo(res, lessonEditRedirect(id, lessonId, 'question-failed', '#quiz-questions'));

  return requireCourseAction(req, res, lessonEditRedirect(id, lessonId, 'question-failed', '#quiz-questions'), async (token) => {
    await callCourse(token, 'DELETE', `/${encodeURIComponent(id)}/quizzes/${encodeURIComponent(quizId)}/questions/${encodeURIComponent(questionId)}`);
    return redirectTo(res, lessonEditRedirect(id, lessonId, 'question-deleted', '#quiz-questions'));
  });
}));

router.post('/instructor/:id(\\d+)/sections/:sectionId(\\d+)/move', asyncRoute(async (req, res) => (
  applyMove(req, res, `/${encodeURIComponent(req.params.id)}/sections/reorder`, req.params.sectionId)
)));

router.post('/instructor/:id(\\d+)/lessons/:lessonId(\\d+)/move', asyncRoute(async (req, res) => {
  const sectionId = positiveInteger(req.body.section_id);
  if (sectionId === null) return redirectTo(res, `/courses/instructor/${req.params.id}/edit?status=order-failed#curriculum`);
  return applyMove(req, res, `/${encodeURIComponent(req.params.id)}/sections/${encodeURIComponent(sectionId)}/lessons/reorder`, req.params.lessonId);
}));

router.post('/:id(\\d+)/lessons/:lessonId(\\d+)/discussions', asyncRoute(async (req, res) => {
  const { id, lessonId } = req.params;
  const body = trimmed(req.body.body, 5000);
  if (body === '') return redirectTo(res, discussionRedirect(id, lessonId, 'comment-required'));
  const payload = { body };
  const parentId = positiveInteger(req.body.parent_id);
  if (parentId !== null) payload.parent_id = parentId;

  return requireCourseAction(req, res, discussionRedirect(id, lessonId, 'comment-failed'), async (token) => {
    await callCourse(token, 'POST', `/${encodeURIComponent(id)}/lessons/${encodeURIComponent(lessonId)}/discussions`, payload);
    return redirectTo(res, discussionRedirect(id, lessonId, 'comment-posted'));
  });
}));

router.post('/:id(\\d+)/lessons/:lessonId(\\d+)/discussions/:commentId(\\d+)/delete', asyncRoute(async (req, res) => {
  const { id, lessonId, commentId } = req.params;
  return requireCourseAction(req, res, discussionRedirect(id, lessonId, 'comment-delete-failed'), async (token) => {
    await callCourse(token, 'DELETE', `/discussions/${encodeURIComponent(commentId)}`);
    return redirectTo(res, discussionRedirect(id, lessonId, 'comment-deleted'));
  });
}));

router.post('/instructor/:id(\\d+)/lessons/:lessonId(\\d+)/delete', asyncRoute(async (req, res) => {
  return requireCourseAction(req, res, instructorEditRedirect(req.params.id, 'lesson-failed'), async (token) => {
    await callCourse(token, 'DELETE', `/${encodeURIComponent(req.params.id)}/lessons/${encodeURIComponent(req.params.lessonId)}`);
    return redirectTo(res, instructorEditRedirect(req.params.id, 'lesson-deleted'));
  });
}));

module.exports = router;
