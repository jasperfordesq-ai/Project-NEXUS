// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { resolveOptions } = require('../../scripts/laravel-runtime-smoke');
const { callJobApi, getJobs, login } = require('../../src/lib/api');

const smoke = resolveOptions({}, process.env);
const mountPath = `/${encodeURIComponent(smoke.tenant)}/accessible`;

function rowsFrom(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.data?.data)) return result.data.data;
  if (Array.isArray(result?.data?.items)) return result.data.items;
  if (Array.isArray(result?.items)) return result.items;
  return [];
}

function objectFrom(result) {
  const data = result?.data ?? result;
  return data?.job && typeof data.job === 'object' ? data.job : data;
}

async function authenticate(page, email = smoke.email, password = smoke.password) {
  await page.goto(`${mountPath}/login`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/login'), { timeout: 300_000 });
  await page.locator('form:has(input[name="password"]) button[type="submit"]').click();
  expect((await responsePromise).status()).toBe(302);
  await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
}

async function submit(page, pathnameSuffix, button) {
  const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(pathnameSuffix), { timeout: 300_000 });
  await button.click();
  return responsePromise;
}

async function submitWithoutConstraintValidation(page, pathnameSuffix, form) {
  const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(pathnameSuffix), { timeout: 300_000 });
  const navigationPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 300_000 });
  await form.evaluate(element => element.submit());
  const response = await responsePromise;
  await navigationPromise;
  return response;
}

async function findByTitle(token, title) {
  const result = await callJobApi(token, 'GET', '/my-postings?per_page=100');
  return rowsFrom(result).find(job => job?.title === title) || null;
}

async function findAlert(token, keywords) {
  const result = await callJobApi(token, 'GET', '/alerts');
  return rowsFrom(result).find(alert => alert?.keywords === keywords) || null;
}

async function findApplication(token, jobId) {
  const result = await callJobApi(token, 'GET', '/my-applications?per_page=100');
  return rowsFrom(result).find(application => Number(application?.job_id ?? application?.vacancy_id) === Number(jobId)) || null;
}

async function expectAccessibleReflow(page) {
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);
  const duplicateIds = await page.locator('[id]').evaluateAll(elements => {
    const ids = elements.map(element => element.id).filter(Boolean);
    return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  });
  expect(duplicateIds).toEqual([]);
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
}

test('replays safe CV validation errors without creating a Laravel application', async ({ page }) => {
  const auth = await login(smoke.email, smoke.password, smoke.tenant);
  const token = auth.access_token;
  const result = await getJobs(token, { limit: 20, status: 'open' });
  const job = rowsFrom(result).find(row => !row?.is_owner && !row?.has_applied);
  expect(job).toBeTruthy();

  await page.setViewportSize({ width: 320, height: 640 });
  await authenticate(page);
  await page.goto(`${mountPath}/jobs/${job.id}`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
  await page.locator('#cover_letter').fill('Preserve this browser validation statement.');
  await page.locator('#cv').setInputFiles({ name: 'not-a-cv.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid CV fixture') });
  const response = await submit(page, `/jobs/${job.id}/apply`, page.locator(`form[action$="/jobs/${job.id}/apply"] button[type="submit"]`));
  expect(response.status()).toBe(302);
  await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });

  const errorLink = page.locator('.govuk-error-summary a[href="#cv"]');
  await expect(errorLink).toHaveText('Your CV must be a PDF, DOC or DOCX file. Your application was not submitted.');
  await expect(page.locator('#cv')).toHaveAttribute('aria-describedby', 'cv-hint cv-error');
  await expect(page.locator('#cover_letter')).toHaveValue('Preserve this browser validation statement.');
  await expectAccessibleReflow(page);

  const applications = rowsFrom(await callJobApi(token, 'GET', '/my-applications?limit=200'));
  expect(applications.some(application => Number(application?.job_id ?? application?.vacancy_id) === Number(job.id))).toBe(false);
});

test('certifies a disposable successful application and withdrawal through Web UK', async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const title = `Community support opportunity ${runId}`;
  const coverLetter = 'I can help with this disposable accessibility testing opportunity.';
  const ownerAuth = await login(smoke.email, smoke.password, smoke.tenant);
  const secondEmail = process.env.SMOKE_SECOND_EMAIL || process.env.E2E_SECOND_USER_EMAIL || 'e2e.user.b@project-nexus.local';
  const secondPassword = process.env.SMOKE_SECOND_PASSWORD || process.env.E2E_SECOND_USER_PASSWORD || smoke.password;
  const applicantAuth = await login(secondEmail, secondPassword, smoke.tenant);
  let jobId = null;
  let deleted = false;

  console.log(`Disposable job application fixture: ${title}`);

  try {
    const created = objectFrom(await callJobApi(ownerAuth.access_token, 'POST', '', {
      title,
      description: 'A safe disposable vacancy for the Web UK application lifecycle gate.',
      type: 'timebank',
      commitment: 'flexible',
      category: 'Community support',
      location: 'Hour Timebank',
      is_remote: true,
      skills_required: 'accessibility, testing',
      time_credits: 2,
      status: 'open'
    }));
    jobId = Number(created.id);
    expect(jobId).toBeGreaterThan(0);

    await page.context().clearCookies();
    await page.setViewportSize({ width: 320, height: 640 });
    await authenticate(page, secondEmail, secondPassword);
    await page.goto(`${mountPath}/jobs/${jobId}`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await expect(page.locator('h1')).toContainText(title);
    await page.locator('#cover_letter').fill(coverLetter);
    const applyResponse = await submit(page, `/jobs/${jobId}/apply`, page.locator(`form[action$="/jobs/${jobId}/apply"] button[type="submit"]`));
    expect(applyResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.getByText('Your application has been submitted.', { exact: true })).toHaveCount(1);
    await expectAccessibleReflow(page);

    let application = await findApplication(applicantAuth.access_token, jobId);
    expect(application).toBeTruthy();
    expect(application.status).toBe('pending');
    expect(application.message ?? application.cover_letter).toBe(coverLetter);

    await page.goto(`${mountPath}/jobs/applications`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    const applicationCard = page.locator('article', { hasText: title });
    await expect(applicationCard).toHaveCount(1);
    await expect(applicationCard).toContainText('Pending');
    const withdrawResponse = await submit(page, `/jobs/applications/${application.id}/withdraw`, applicationCard.locator('form[action$="/withdraw"] button[type="submit"]'));
    expect(withdrawResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.getByText('Your application has been withdrawn.', { exact: true })).toHaveCount(1);

    application = await findApplication(applicantAuth.access_token, jobId);
    expect(application).toBeTruthy();
    expect(application.status).toBe('withdrawn');

    await callJobApi(ownerAuth.access_token, 'DELETE', `/${jobId}`);
    deleted = true;
    expect(await findApplication(applicantAuth.access_token, jobId)).toBeNull();
  } finally {
    if (!deleted && jobId) await callJobApi(ownerAuth.access_token, 'DELETE', `/${jobId}`).catch(() => undefined);
  }
});

test('certifies disposable interview acceptance and offer rejection through Web UK', async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const title = `Community interview opportunity ${runId}`;
  const ownerAuth = await login(smoke.email, smoke.password, smoke.tenant);
  const secondEmail = process.env.SMOKE_SECOND_EMAIL || process.env.E2E_SECOND_USER_EMAIL || 'e2e.user.b@project-nexus.local';
  const secondPassword = process.env.SMOKE_SECOND_PASSWORD || process.env.E2E_SECOND_USER_PASSWORD || smoke.password;
  const applicantAuth = await login(secondEmail, secondPassword, smoke.tenant);
  let jobId = null;
  let applicationId = null;
  let interviewId = null;
  let offerId = null;
  let deleted = false;

  console.log(`Disposable job response fixture: ${title}`);

  try {
    const created = objectFrom(await callJobApi(ownerAuth.access_token, 'POST', '', {
      title,
      description: 'A safe disposable vacancy for the Web UK interview and offer response gate.',
      type: 'volunteer',
      commitment: 'flexible',
      category: 'Community support',
      location: 'Hour Timebank',
      is_remote: true,
      status: 'open'
    }));
    jobId = Number(created.id);
    expect(jobId).toBeGreaterThan(0);

    await callJobApi(applicantAuth.access_token, 'POST', `/${jobId}/apply`, {
      message: 'Disposable candidate application for response testing.'
    });
    const application = await findApplication(applicantAuth.access_token, jobId);
    expect(application).toBeTruthy();
    applicationId = Number(application.id);

    const interview = objectFrom(await callJobApi(ownerAuth.access_token, 'POST', `/applications/${applicationId}/interview`, {
      scheduled_at: '2099-07-01T14:30:00Z',
      interview_type: 'video',
      duration_mins: 45,
      location_notes: 'Disposable video interview link'
    }));
    interviewId = Number(interview.id);
    expect(interviewId).toBeGreaterThan(0);

    const offer = objectFrom(await callJobApi(ownerAuth.access_token, 'POST', `/applications/${applicationId}/offer`, {
      salary_offered: 20000,
      salary_currency: 'EUR',
      salary_type: 'annual',
      start_date: '2099-08-01',
      expires_at: '2099-08-05',
      message: 'Disposable offer for response testing.'
    }));
    offerId = Number(offer.id);
    expect(offerId).toBeGreaterThan(0);

    await page.context().clearCookies();
    await page.setViewportSize({ width: 320, height: 640 });
    await authenticate(page, secondEmail, secondPassword);
    await page.goto(`${mountPath}/jobs/responses`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await expect(page.locator('h1')).toHaveText('Interviews and offers');
    await expect(page.getByText(title, { exact: false })).toHaveCount(2);
    await expect(page.getByRole('link', { name: /Add to Google Calendar/ })).toHaveCount(1);
    await expectAccessibleReflow(page);

    const interviewForm = page.locator(`form[action$="/jobs/interviews/${interviewId}/accept"]`);
    await interviewForm.locator('input[name="note"]').fill('I confirm this disposable interview.');
    const acceptResponse = await submit(page, `/jobs/interviews/${interviewId}/accept`, interviewForm.locator('button[type="submit"]'));
    expect(acceptResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.getByText('You accepted the interview. The employer has been notified.', { exact: true })).toHaveCount(1);
    let interviews = rowsFrom(await callJobApi(applicantAuth.access_token, 'GET', '/my-interviews'));
    expect(interviews.find(row => Number(row.id) === interviewId)?.status).toBe('accepted');

    const rejectForm = page.locator(`form[action$="/jobs/offers/${offerId}/reject"]`);
    const rejectResponse = await submit(page, `/jobs/offers/${offerId}/reject`, rejectForm.locator('button[type="submit"]'));
    expect(rejectResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.getByText('You declined the offer. The employer has been notified.', { exact: true })).toHaveCount(1);
    let offers = rowsFrom(await callJobApi(applicantAuth.access_token, 'GET', '/my-offers'));
    expect(offers.find(row => Number(row.id) === offerId)?.status).toBe('rejected');
    await expectAccessibleReflow(page);

    await callJobApi(ownerAuth.access_token, 'DELETE', `/${jobId}`);
    deleted = true;
    interviews = rowsFrom(await callJobApi(applicantAuth.access_token, 'GET', '/my-interviews'));
    offers = rowsFrom(await callJobApi(applicantAuth.access_token, 'GET', '/my-offers'));
    expect(interviews.some(row => Number(row.id) === interviewId)).toBe(false);
    expect(offers.some(row => Number(row.id) === offerId)).toBe(false);
    expect(await findApplication(applicantAuth.access_token, jobId)).toBeNull();
  } finally {
    if (!deleted && jobId) await callJobApi(ownerAuth.access_token, 'DELETE', `/${jobId}`).catch(() => undefined);
  }
});

test('certifies a disposable job owner lifecycle through Web UK', async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const createdTitle = `Codex disposable opportunity ${runId}`;
  const updatedTitle = `${createdTitle} updated`;
  const auth = await login(smoke.email, smoke.password, smoke.tenant);
  const token = auth.access_token;
  let jobId = null;
  let deleted = false;

  expect(token).toBeTruthy();
  console.log(`Disposable job fixture: ${createdTitle}`);

  try {
    await page.setViewportSize({ width: 320, height: 640 });
    await authenticate(page);
    await page.goto(`${mountPath}/jobs/create`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await expect(page.locator('h1')).toHaveText('Post an opportunity');
    await expect(page.locator('.govuk-caption-xl')).toContainText('Hour Timebank');
    await page.locator('#description').fill('Disposable Laravel job mutation fixture created by the Web UK runtime gate.');
    await page.locator('#type').selectOption('timebank');
    await page.locator('#commitment').selectOption('flexible');
    await page.locator('#location').fill('Preserved validation location');
    await page.locator('#status-draft').check();
    const createValidationResponse = await submitWithoutConstraintValidation(page, '/jobs', page.locator('form:has(#title)'));
    expect(createValidationResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.locator('.govuk-error-summary a[href="#title"]')).toHaveText('Enter a title for the opportunity.');
    await expect(page.locator('#description')).toHaveValue('Disposable Laravel job mutation fixture created by the Web UK runtime gate.');
    await expect(page.locator('#type')).toHaveValue('timebank');
    await expect(page.locator('#location')).toHaveValue('Preserved validation location');
    await expect(page.locator('#status-draft')).toBeChecked();

    await page.locator('#title').fill(createdTitle);
    await page.locator('#category').fill('Community support');
    await page.locator('#location').fill('Disposable test location');
    await page.locator('#is_remote').check();
    await page.locator('#skills_required').fill('testing, accessibility');
    await page.locator('#time_credits').fill('2');
    await page.locator('#status-draft').check();
    const createResponse = await submit(page, '/jobs', page.locator('form:has(#title) button[type="submit"]'));
    expect(createResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });

    const created = await findByTitle(token, createdTitle);
    expect(created).toBeTruthy();
    jobId = Number(created.id);
    expect(jobId).toBeGreaterThan(0);
    await expect(page.locator('h1')).toContainText(createdTitle);
    await expectAccessibleReflow(page);

    await page.goto(`${mountPath}/jobs/${jobId}/edit`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await page.locator('#title').fill('');
    await page.locator('#location').fill('Preserved invalid edit location');
    const editValidationResponse = await submitWithoutConstraintValidation(page, `/jobs/${jobId}/update`, page.locator('form:has(#title)'));
    expect(editValidationResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.locator('.govuk-error-summary a[href="#title"]')).toHaveText('Enter a title for the opportunity.');
    await expect(page.locator('#location')).toHaveValue('Preserved invalid edit location');

    await page.locator('#title').fill(updatedTitle);
    await page.locator('#commitment').selectOption('part_time');
    await page.locator('#location').fill('Updated disposable location');
    const editResponse = await submit(page, `/jobs/${jobId}/update`, page.locator('form:has(#title) button[type="submit"]'));
    expect(editResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.locator('h1')).toContainText(updatedTitle);
    const updated = objectFrom(await callJobApi(token, 'GET', `/${jobId}`));
    expect(updated.title).toBe(updatedTitle);
    expect(updated.commitment).toBe('part_time');
    expect(updated.location).toBe('Updated disposable location');
    await expectAccessibleReflow(page);

    await page.goto(`${mountPath}/jobs/mine`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    const card = page.locator('article', { hasText: updatedTitle });
    await expect(card).toHaveCount(1);
    const deleteResponse = await submit(page, `/jobs/${jobId}/delete`, card.locator('form[action$="/delete"] button[type="submit"]'));
    expect(deleteResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    expect(await findByTitle(token, updatedTitle)).toBeNull();
    deleted = true;
  } finally {
    if (!deleted && jobId) await callJobApi(token, 'DELETE', `/${jobId}`);
  }
});

test('certifies a disposable job alert lifecycle through Web UK', async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const keywords = `Codex disposable alert ${runId}`;
  const auth = await login(smoke.email, smoke.password, smoke.tenant);
  const token = auth.access_token;
  let alertId = null;
  let deleted = false;

  expect(token).toBeTruthy();
  console.log(`Disposable job alert fixture: ${keywords}`);

  try {
    await page.setViewportSize({ width: 320, height: 640 });
    await authenticate(page);
    await page.goto(`${mountPath}/jobs/alerts`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await expect(page.locator('h1')).toHaveText('Job alerts');
    await expect(page.locator('.govuk-caption-xl')).toContainText('Hour Timebank');
    await page.locator('#keywords').fill(keywords);
    await page.locator('#categories').fill('Community support');
    await page.locator('#type').selectOption('timebank');
    await page.locator('#commitment').selectOption('flexible');
    await page.locator('#location').fill('Disposable test location');
    await page.locator('#is_remote_only').check();
    const createResponse = await submit(page, '/jobs/alerts', page.locator('form:has(#keywords) button[type="submit"]'));
    expect(createResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });

    let alert = await findAlert(token, keywords);
    expect(alert).toBeTruthy();
    alertId = Number(alert.id);
    expect(alertId).toBeGreaterThan(0);
    let card = page.locator('article', { hasText: keywords });
    await expect(card).toHaveCount(1);
    await expect(card.locator('.govuk-tag')).toHaveText('Active');
    await expectAccessibleReflow(page);

    const pauseResponse = await submit(page, `/jobs/alerts/${alertId}/pause`, card.locator('form[action$="/pause"] button'));
    expect(pauseResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    alert = await findAlert(token, keywords);
    expect(Boolean(alert.is_active ?? alert.isActive)).toBe(false);
    card = page.locator('article', { hasText: keywords });
    await expect(card.locator('.govuk-tag')).toHaveText('Paused');

    const resumeResponse = await submit(page, `/jobs/alerts/${alertId}/resume`, card.locator('form[action$="/resume"] button'));
    expect(resumeResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    alert = await findAlert(token, keywords);
    expect(Boolean(alert.is_active ?? alert.isActive)).toBe(true);
    card = page.locator('article', { hasText: keywords });
    const details = card.locator('details');
    await details.locator('summary').click();
    await expect(details).toContainText('Delete this alert?');
    const deleteResponse = await submit(page, `/jobs/alerts/${alertId}/delete`, details.locator('form[action$="/delete"] button'));
    expect(deleteResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    expect(await findAlert(token, keywords)).toBeNull();
    deleted = true;
  } finally {
    if (!deleted && alertId) await callJobApi(token, 'DELETE', `/alerts/${alertId}`);
  }
});
