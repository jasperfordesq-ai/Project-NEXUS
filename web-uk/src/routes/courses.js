// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { ApiError, ApiOfflineError, callCourseApi, getMyCourses } = require('../lib/api');
const { sanitizeCmsHtml } = require('../lib/html-sanitizer');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');
const { asyncRoute } = require('../lib/routeHelpers');

const router = express.Router();

const COURSE_LEVELS = ['beginner', 'intermediate', 'advanced'];
const COURSE_VISIBILITIES = ['members', 'public'];
const COURSE_ENROLLMENT_TYPES = ['self_paced', 'cohort'];
const LESSON_CONTENT_TYPES = ['text', 'video', 'pdf', 'embed'];
const COURSE_LEVEL_LABELS = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced'
};
const COURSE_VISIBILITY_LABELS = {
  members: 'Members only',
  public: 'Anyone'
};
const COURSE_ENROLLMENT_LABELS = {
  self_paced: 'Self-paced',
  cohort: 'Scheduled cohort'
};
const LESSON_CONTENT_TYPE_LABELS = {
  text: 'Reading',
  video: 'Video lesson',
  pdf: 'Document',
  embed: 'Interactive content',
  quiz: 'Quiz'
};
const INSTRUCTOR_STATUS_LABELS = {
  published: 'Published',
  pending_review: 'Awaiting review',
  draft: 'Draft'
};
const INSTRUCTOR_STATUS_CLASSES = {
  published: 'govuk-tag--green',
  pending_review: 'govuk-tag--yellow',
  draft: 'govuk-tag--grey'
};
const COURSE_STATUS_MESSAGES = {
  enrolled: { type: 'success', message: 'You are now enrolled. Enjoy the course.' },
  'enrol-required': { type: 'error', message: 'Enrol on this course before opening the learning area.' },
  'review-saved': { type: 'success', message: 'Thank you - your review has been saved.' },
  'insufficient-credits': { type: 'error', message: 'You do not have enough time credits to enrol on this course.' },
  'enrol-failed': { type: 'error', message: 'We could not enrol you on this course. Please try again.' },
  'certificate-locked': { type: 'error', message: 'You can download your certificate once you have completed the course.' },
  'certificate-failed': { type: 'error', message: 'We could not produce your certificate. Please try again.' },
  'review-invalid': { type: 'error', message: 'Please choose a rating between 1 and 5 stars.' },
  'review-not-enrolled': { type: 'error', message: 'Only enrolled learners can review this course.' },
  'review-failed': { type: 'error', message: 'We could not save your review. Please try again.' }
};
const LEARN_STATUS_MESSAGES = {
  'lesson-completed': { type: 'success', message: 'Lesson marked as complete.' },
  'course-completed': { type: 'success', message: 'You have finished the course. Well done.' },
  'quiz-passed': { type: 'success', message: 'Well done - you passed the quiz.' },
  'quiz-pending-review': { type: 'success', message: 'Your answers were submitted and are awaiting instructor marking.' },
  'quiz-failed': { type: 'error', message: 'You did not reach the pass mark this time. Review the lesson and try again if you have attempts left.' },
  'quiz-no-attempts': { type: 'error', message: 'You have no attempts remaining for this quiz.' },
  'quiz-error': { type: 'error', message: 'Sorry, we could not record your quiz attempt. Please try again.' }
};
const INSTRUCTOR_STATUS_MESSAGES = {
  deleted: { type: 'success', message: 'Your course was deleted.' },
  'delete-failed': { type: 'error', message: 'Sorry, your course could not be deleted. Please try again.' }
};
const FORM_STATUS_MESSAGES = {
  created: { type: 'success', message: 'Your course was created. Add the details and publish when you are ready.' },
  'create-failed': { type: 'error', message: 'Enter a course title before creating the course.' },
  saved: { type: 'success', message: 'Your changes were saved.' },
  'save-failed': { type: 'error', message: 'Sorry, your changes could not be saved. Please try again.' },
  published: { type: 'success', message: 'Your course is published and visible to learners.' },
  'pending-review': { type: 'success', message: 'Your course was submitted and is awaiting review before it goes live.' },
  'publish-failed': { type: 'error', message: 'Sorry, your course could not be published. Please try again.' },
  unpublished: { type: 'success', message: 'Your course was unpublished and is now a draft.' },
  'unpublish-failed': { type: 'error', message: 'Sorry, your course could not be unpublished. Please try again.' },
  'section-added': { type: 'success', message: 'Your section was added.' },
  'section-saved': { type: 'success', message: 'Your section was renamed.' },
  'section-deleted': { type: 'success', message: 'Your section was deleted. Its lessons were kept and moved out of any section.' },
  'section-failed': { type: 'error', message: 'Sorry, that section action could not be completed. Please try again.' },
  'section-title-missing': { type: 'error', message: 'Enter a title for the section.' },
  'lesson-added': { type: 'success', message: 'Your lesson was added.' },
  'lesson-saved': { type: 'success', message: 'Your lesson was saved.' },
  'lesson-deleted': { type: 'success', message: 'Your lesson was deleted.' },
  'lesson-failed': { type: 'error', message: 'Sorry, that lesson action could not be completed. Please try again.' },
  'lesson-title-missing': { type: 'error', message: 'Enter a title for the lesson.' }
};
const GRADING_STATUS_MESSAGES = {
  graded: { type: 'success', message: 'The attempt has been graded.' },
  'grade-failed': { type: 'error', message: 'The attempt could not be graded. Please try again.' }
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
    res.status(404).render('errors/404', { title: 'Page not found' });
    return true;
  }

  if (error instanceof ApiOfflineError || error instanceof ApiError) {
    res.status(503).render('errors/503', { title: 'Service unavailable' });
    return true;
  }

  return false;
}

function routeStatus(query, map) {
  const key = typeof query.status === 'string' ? query.status : '';
  return map[key] ? { key, ...map[key] } : null;
}

function costMeta(course) {
  const cost = Number(course.credit_cost || 0);
  const normalized = Number.isFinite(cost) ? Math.max(0, cost) : 0;
  const label = normalized > 0
    ? `${String(normalized.toFixed(2)).replace(/\.?0+$/, '')} time credits`
    : 'Free';
  return {
    creditCost: normalized,
    costLabel: label,
    costTagClass: normalized > 0 ? 'govuk-tag--blue' : 'govuk-tag--green'
  };
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, '');
}

function limitText(value, limit = 160) {
  const text = stripHtml(value).trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function titleFrom(value, fallback = 'Courses') {
  return trimmed(value) || fallback;
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
    levelLabel: COURSE_LEVEL_LABELS[level] || (level ? `${level.charAt(0).toUpperCase()}${level.slice(1)}` : ''),
    categoryId: positiveInteger(course.category_id),
    visibility: allowed(course.visibility, COURSE_VISIBILITIES, 'members'),
    visibilityLabel: COURSE_VISIBILITY_LABELS[allowed(course.visibility, COURSE_VISIBILITIES, 'members')],
    enrollmentType: allowed(course.enrollment_type, COURSE_ENROLLMENT_TYPES, 'self_paced'),
    enrollmentTypeLabel: COURSE_ENROLLMENT_LABELS[allowed(course.enrollment_type, COURSE_ENROLLMENT_TYPES, 'self_paced')],
    authorName: trimmed(course.author && course.author.name) || trimmed(course.author_name),
    isEnrolled: !!course.is_enrolled,
    ratingAvg: Number(course.rating_avg || 0),
    ratingAvgLabel: Number(course.rating_avg || 0).toFixed(1),
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

function courseQueryPath(req) {
  const params = new URLSearchParams();
  params.set('per_page', '30');

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
    level
  };
}

function progressMaps(progressResult) {
  const data = objectFrom(progressResult);
  const lessonProgress = Array.isArray(data.lessons) ? data.lessons : [];
  const availability = Array.isArray(data.availability) ? data.availability : [];
  const completed = new Set();
  const available = new Map();

  lessonProgress.forEach((row) => {
    const id = positiveInteger(row.lesson_id || row.id);
    if (id !== null && row.status === 'completed') completed.add(id);
  });

  availability.forEach((row) => {
    const id = positiveInteger(row.lesson_id || row.id);
    if (id !== null) available.set(id, row.available !== false);
  });

  return {
    enrollment: data.enrollment && typeof data.enrollment === 'object' ? data.enrollment : {},
    completed,
    available
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
    contentTypeLabel: LESSON_CONTENT_TYPE_LABELS[contentType] || contentType,
    body: sanitizeCmsHtml(lesson.body),
    videoUrl: trimmed(lesson.video_url),
    embedUrl: trimmed(lesson.embed_url),
    attachmentUrl: trimmed(lesson.attachment_url),
    quizId: positiveInteger(lesson.quiz_id) || positiveInteger(lesson.quiz && lesson.quiz.id),
    isCompleted: progress.completed.has(id) || !!lesson.is_completed,
    available: progress.available.has(id) ? progress.available.get(id) : lesson.available !== false
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
    statusLabel: enrollment.status === 'completed' ? 'Completed' : 'In progress'
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
    instructorStatusLabel: INSTRUCTOR_STATUS_LABELS[status],
    instructorStatusClass: INSTRUCTOR_STATUS_CLASSES[status]
  };
}

function normalizeAnalytics(result) {
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
      { label: 'Total enrolments', value: analytics.total },
      { label: 'Active', value: analytics.active },
      { label: 'Completed', value: analytics.completed },
      { label: 'Dropped out', value: analytics.dropped },
      { label: 'Completion rate', value: `${analytics.completionRate}%` },
      { label: 'Average progress', value: `${analytics.avgProgress}%` },
      { label: 'Average quiz score', value: `${analytics.avgQuizScore}%` },
      { label: 'Quiz attempts', value: analytics.quizAttempts }
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

async function courseDetailPayload(token, id) {
  const [courseResult, prerequisitesResult, reviewsResult, progressResult] = await Promise.all([
    callCourse(token, 'GET', `/${id}`),
    callCourse(token, 'GET', `/${id}/prerequisites`).catch(() => ({ data: [] })),
    callCourse(token, 'GET', `/${id}/reviews`).catch(() => ({ data: [] })),
    callCourse(token, 'GET', `/${id}/progress`).catch((error) => {
      if (error instanceof ApiError || error instanceof ApiOfflineError) return { data: {} };
      throw error;
    })
  ]);
  const course = normalizeCourse(objectFrom(courseResult));
  const progress = progressMaps(progressResult);
  const enrollmentStatus = trimmed(progress.enrollment.status);
  const isCompleted = enrollmentStatus === 'completed';
  const canReview = ['active', 'completed'].includes(enrollmentStatus);

  return {
    course,
    sections: normalizeSections(course, progress),
    prerequisites: listFrom(prerequisitesResult).map((item) => ({
      id: positiveInteger(item.id) || 0,
      title: titleFrom(item.title, ''),
      completed: !!item.completed
    })).filter((item) => item.title),
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
      title: 'Courses',
      activeNav: 'explore',
      courses: listFrom(coursesResult).map(normalizeCourse),
      categories,
      coursesQuery: query.q,
      courseCategoryId: query.categoryId,
      courseLevel: query.level,
      levels: COURSE_LEVELS.map((level) => ({ value: level, label: COURSE_LEVEL_LABELS[level] }))
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
      title: 'My learning',
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
      title: 'Courses you teach',
      activeNav: 'explore',
      courses: listFrom(result).map(normalizeInstructorCourse),
      canAuthor: true,
      status: routeStatus(req.query, INSTRUCTOR_STATUS_MESSAGES)
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return res.render('courses/instructor', {
        title: 'Courses you teach',
        activeNav: 'explore',
        courses: [],
        canAuthor: false,
        status: routeStatus(req.query, INSTRUCTOR_STATUS_MESSAGES)
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
    return res.render('courses/form', {
      title: 'Create a course',
      activeNav: 'explore',
      mode: 'create',
      course: normalizeCourse({}),
      formAction: '/courses/instructor/new',
      categories: await courseCategories(token),
      levels: COURSE_LEVELS.map((level) => ({ value: level, label: COURSE_LEVEL_LABELS[level] })),
      visibilities: COURSE_VISIBILITIES.map((value) => ({ value, label: COURSE_VISIBILITY_LABELS[value] })),
      enrollmentTypes: COURSE_ENROLLMENT_TYPES.map((value) => ({ value, label: COURSE_ENROLLMENT_LABELS[value] })),
      contentTypes: LESSON_CONTENT_TYPES.map((value) => ({ value, label: LESSON_CONTENT_TYPE_LABELS[value] })),
      builderSections: [],
      builderUnsectioned: [],
      status: routeStatus(req.query, FORM_STATUS_MESSAGES)
    });
  } catch (error) {
    if (handleCourseGetError(error, res)) return undefined;
    throw error;
  }
}));

router.get('/instructor/:id/edit', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (token === null) return undefined;

  try {
    const [payload, categories] = await Promise.all([
      courseDetailPayload(token, req.params.id),
      courseCategories(token)
    ]);

    return res.render('courses/form', {
      title: 'Edit your course',
      activeNav: 'explore',
      mode: 'edit',
      course: payload.course,
      formAction: `/courses/instructor/${req.params.id}/update`,
      categories,
      levels: COURSE_LEVELS.map((level) => ({ value: level, label: COURSE_LEVEL_LABELS[level] })),
      visibilities: COURSE_VISIBILITIES.map((value) => ({ value, label: COURSE_VISIBILITY_LABELS[value] })),
      enrollmentTypes: COURSE_ENROLLMENT_TYPES.map((value) => ({ value, label: COURSE_ENROLLMENT_LABELS[value] })),
      contentTypes: LESSON_CONTENT_TYPES.map((value) => ({ value, label: LESSON_CONTENT_TYPE_LABELS[value] })),
      builderSections: payload.sections,
      builderUnsectioned: [],
      status: routeStatus(req.query, FORM_STATUS_MESSAGES)
    });
  } catch (error) {
    if (handleCourseGetError(error, res)) return undefined;
    throw error;
  }
}));

router.get('/instructor/:id/analytics', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (token === null) return undefined;

  try {
    const payload = normalizeAnalytics(await callCourse(token, 'GET', `/${req.params.id}/analytics`));
    return res.render('courses/analytics', {
      title: 'Course analytics',
      activeNav: 'explore',
      ...payload
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return res.status(403).render('errors/403', { title: 'Forbidden' });
    }
    if (handleCourseGetError(error, res)) return undefined;
    throw error;
  }
}));

router.get('/instructor/:id/grading', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (token === null) return undefined;

  try {
    const [courseResult, attemptsResult] = await Promise.all([
      callCourse(token, 'GET', `/${req.params.id}`),
      callCourse(token, 'GET', `/${req.params.id}/grading`)
    ]);
    const course = normalizeCourse(objectFrom(courseResult));

    return res.render('courses/grading', {
      title: 'Grading queue',
      activeNav: 'explore',
      courseId: req.params.id,
      course,
      attempts: listFrom(attemptsResult).map(normalizeAttempt),
      status: routeStatus(req.query, GRADING_STATUS_MESSAGES)
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return res.status(403).render('errors/403', { title: 'Forbidden' });
    }
    if (handleCourseGetError(error, res)) return undefined;
    throw error;
  }
}));

router.get('/:id/certificate', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (token === null) return undefined;

  try {
    const result = await callCourse(token, 'GET', `/${req.params.id}/certificate`);
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

router.get('/:id/learn', asyncRoute(async (req, res) => {
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
        currentLesson.quiz = objectFrom(await callCourse(token, 'GET', `/quizzes/${currentLesson.quizId}`));
      } catch (error) {
        if (!(error instanceof ApiError && [403, 404].includes(error.status))) {
          throw error;
        }
        currentLesson.quiz = null;
      }
    }

    return res.render('courses/learn', {
      title: payload.course.title,
      activeNav: 'explore',
      course: payload.course,
      sections: payload.sections,
      currentLesson,
      progressPercent: Math.round(Number(payload.progress.enrollment.progress_percent || 0)),
      isCompleted: payload.isCompleted,
      status: routeStatus(req.query, LEARN_STATUS_MESSAGES)
    });
  } catch (error) {
    if (handleCourseGetError(error, res)) return undefined;
    throw error;
  }
}));

router.get('/:id', asyncRoute(async (req, res) => {
  const token = requireToken(req, res);
  if (token === null) return undefined;

  try {
    const payload = await courseDetailPayload(token, req.params.id);
    return res.render('courses/detail', {
      title: payload.course.title,
      activeNav: 'explore',
      ...payload,
      status: routeStatus(req.query, COURSE_STATUS_MESSAGES)
    });
  } catch (error) {
    if (handleCourseGetError(error, res)) return undefined;
    throw error;
  }
}));

function coursePayload(body) {
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
  const code = errorCode(error);
  if (code === 'INSUFFICIENT_CREDITS') return 'insufficient-credits';
  return 'enrol-failed';
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

router.post('/:id/enrol', asyncRoute(async (req, res) => {
  return requireCourseAction(req, res, (error) => courseRedirect(req.params.id, enrolFailureStatus(error)), async (token) => {
    await callCourse(token, 'POST', `/${req.params.id}/enroll`);
    return redirectTo(res, courseRedirect(req.params.id, 'enrolled'));
  });
}));

router.post('/:id/lessons/:lessonId/complete', asyncRoute(async (req, res) => {
  return requireCourseAction(req, res, learnRedirect(req.params.id, 'lesson-completed'), async (token) => {
    const result = await callCourse(token, 'POST', `/${req.params.id}/lessons/${req.params.lessonId}/complete`, completionPayload(req.body));
    const data = dataFrom(result);
    const status = data && typeof data === 'object' && data.course_completed
      ? 'course-completed'
      : 'lesson-completed';
    return redirectTo(res, learnRedirect(req.params.id, status));
  });
}));

router.post('/:id/lessons/:lessonId/quiz', asyncRoute(async (req, res) => {
  return requireCourseAction(req, res, learnRedirect(req.params.id, 'quiz-error', req.params.lessonId), async (token) => {
    const quizId = positiveInteger(req.body.quiz_id || req.body.quizId);
    if (quizId === null) {
      return redirectTo(res, learnRedirect(req.params.id, 'quiz-error', req.params.lessonId));
    }

    try {
      const result = await callCourse(token, 'POST', `/quizzes/${quizId}/attempt`, {
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

router.post('/:id/reviews', asyncRoute(async (req, res) => {
  const payload = reviewPayload(req.body);
  if (payload === null) {
    return redirectTo(res, courseRedirect(req.params.id, 'review-invalid', '#reviews'));
  }

  return requireCourseAction(req, res, (error) => courseRedirect(req.params.id, reviewFailureStatus(error), '#reviews'), async (token) => {
    await callCourse(token, 'POST', `/${req.params.id}/reviews`, payload);
    return redirectTo(res, courseRedirect(req.params.id, 'review-saved', '#reviews'));
  });
}));

router.post('/instructor/new', asyncRoute(async (req, res) => {
  const payload = coursePayload(req.body);
  if (payload === null) {
    return redirectTo(res, instructorCreateRedirect('create-failed'));
  }

  return requireCourseAction(req, res, instructorCreateRedirect('create-failed'), async (token) => {
    const result = await callCourse(token, 'POST', '', payload);
    const id = resultId(result);
    return redirectTo(res, id === null
      ? instructorCreateRedirect('create-failed')
      : instructorEditRedirect(id, 'created'));
  });
}));

router.post('/instructor/:id/update', asyncRoute(async (req, res) => {
  const payload = coursePayload(req.body);
  if (payload === null) {
    return redirectTo(res, instructorEditRedirect(req.params.id, 'save-failed'));
  }

  return requireCourseAction(req, res, instructorEditRedirect(req.params.id, 'save-failed'), async (token) => {
    await callCourse(token, 'PUT', `/${req.params.id}`, payload);
    return redirectTo(res, instructorEditRedirect(req.params.id, 'saved'));
  });
}));

router.post('/instructor/:id/publish', asyncRoute(async (req, res) => {
  return requireCourseAction(req, res, instructorEditRedirect(req.params.id, 'publish-failed'), async (token) => {
    const result = await callCourse(token, 'POST', `/${req.params.id}/publish`);
    const data = dataFrom(result);
    const status = data && typeof data === 'object' && data.moderation_status === 'approved'
      ? 'published'
      : 'pending-review';
    return redirectTo(res, instructorEditRedirect(req.params.id, status));
  });
}));

router.post('/instructor/:id/unpublish', asyncRoute(async (req, res) => {
  return requireCourseAction(req, res, instructorEditRedirect(req.params.id, 'unpublish-failed'), async (token) => {
    await callCourse(token, 'POST', `/${req.params.id}/unpublish`);
    return redirectTo(res, instructorEditRedirect(req.params.id, 'unpublished'));
  });
}));

router.post('/instructor/:id/delete', asyncRoute(async (req, res) => {
  return requireCourseAction(req, res, instructorRedirect('delete-failed'), async (token) => {
    await callCourse(token, 'DELETE', `/${req.params.id}`);
    return redirectTo(res, instructorRedirect('deleted'));
  });
}));

router.post('/instructor/:id/grading/:attemptId', asyncRoute(async (req, res) => {
  return requireCourseAction(req, res, instructorGradingRedirect(req.params.id, 'grade-failed'), async (token) => {
    await callCourse(token, 'POST', `/attempts/${req.params.attemptId}/grade`, gradePayload(req.body));
    return redirectTo(res, instructorGradingRedirect(req.params.id, 'graded'));
  });
}));

router.post('/instructor/:id/sections', asyncRoute(async (req, res) => {
  const payload = sectionPayload(req.body);
  if (payload === null) {
    return redirectTo(res, instructorEditRedirect(req.params.id, 'section-title-missing'));
  }

  return requireCourseAction(req, res, instructorEditRedirect(req.params.id, 'section-failed'), async (token) => {
    await callCourse(token, 'POST', `/${req.params.id}/sections`, payload);
    return redirectTo(res, instructorEditRedirect(req.params.id, 'section-added'));
  });
}));

router.post('/instructor/:id/sections/:sectionId/update', asyncRoute(async (req, res) => {
  const payload = sectionPayload(req.body);
  if (payload === null) {
    return redirectTo(res, instructorEditRedirect(req.params.id, 'section-title-missing'));
  }

  return requireCourseAction(req, res, instructorEditRedirect(req.params.id, 'section-failed'), async (token) => {
    await callCourse(token, 'PUT', `/${req.params.id}/sections/${req.params.sectionId}`, payload);
    return redirectTo(res, instructorEditRedirect(req.params.id, 'section-saved'));
  });
}));

router.post('/instructor/:id/sections/:sectionId/delete', asyncRoute(async (req, res) => {
  return requireCourseAction(req, res, instructorEditRedirect(req.params.id, 'section-failed'), async (token) => {
    await callCourse(token, 'DELETE', `/${req.params.id}/sections/${req.params.sectionId}`);
    return redirectTo(res, instructorEditRedirect(req.params.id, 'section-deleted'));
  });
}));

router.post('/instructor/:id/lessons', asyncRoute(async (req, res) => {
  const payload = lessonPayload(req.body);
  if (payload === null) {
    return redirectTo(res, instructorEditRedirect(req.params.id, 'lesson-title-missing'));
  }

  return requireCourseAction(req, res, instructorEditRedirect(req.params.id, 'lesson-failed'), async (token) => {
    await callCourse(token, 'POST', `/${req.params.id}/lessons`, payload);
    return redirectTo(res, instructorEditRedirect(req.params.id, 'lesson-added'));
  });
}));

router.post('/instructor/:id/lessons/:lessonId/update', asyncRoute(async (req, res) => {
  const payload = lessonPayload(req.body);
  if (payload === null) {
    return redirectTo(res, instructorEditRedirect(req.params.id, 'lesson-title-missing'));
  }

  return requireCourseAction(req, res, instructorEditRedirect(req.params.id, 'lesson-failed'), async (token) => {
    await callCourse(token, 'PUT', `/${req.params.id}/lessons/${req.params.lessonId}`, payload);
    return redirectTo(res, instructorEditRedirect(req.params.id, 'lesson-saved'));
  });
}));

router.post('/instructor/:id/lessons/:lessonId/delete', asyncRoute(async (req, res) => {
  return requireCourseAction(req, res, instructorEditRedirect(req.params.id, 'lesson-failed'), async (token) => {
    await callCourse(token, 'DELETE', `/${req.params.id}/lessons/${req.params.lessonId}`);
    return redirectTo(res, instructorEditRedirect(req.params.id, 'lesson-deleted'));
  });
}));

module.exports = router;
