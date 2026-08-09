// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { resolveOptions } = require('../../scripts/laravel-runtime-smoke');
const { callPodcastApi, login } = require('../../src/lib/api');

const smoke = resolveOptions({}, process.env);
const mountPath = `/${encodeURIComponent(smoke.tenant)}/accessible`;

function rowsFrom(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.data?.items)) return result.data.items;
  if (Array.isArray(result?.items)) return result.items;
  return [];
}

function makeWav() {
  const sampleRate = 8000;
  const samples = 800;
  const dataSize = samples * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);
  return wav;
}

async function authenticate(page) {
  await page.goto(`${mountPath}/login`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
  await page.locator('input[name="email"]').fill(smoke.email);
  await page.locator('input[name="password"]').fill(smoke.password);
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/login')
  ), { timeout: 300_000 });
  await page.locator('form:has(input[name="password"]) button[type="submit"]').click();
  expect((await responsePromise).status()).toBe(302);
  await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
}

async function submitPost(page, button, pathnameSuffix) {
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(pathnameSuffix)
  ), { timeout: 300_000 });
  await button.click();
  const response = await responsePromise;
  expect(response.status()).toBe(302);
  await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
}

async function findShow(token, title) {
  const result = await callPodcastApi(token, 'GET', '/mine');
  return rowsFrom(result).find((show) => show?.title === title) || null;
}

async function expectAccessibleReflow(page) {
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);
  const duplicateIds = await page.locator('[id]').evaluateAll((elements) => {
    const ids = elements.map(element => element.id).filter(Boolean);
    return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  });
  expect(duplicateIds).toEqual([]);
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
}

test('creates, edits, uploads audio to, and deletes a disposable podcast', async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const title = `Codex disposable podcast ${runId}`;
  const updatedTitle = `${title} updated`;
  const episodeTitle = `Disposable episode ${runId}`;
  const audio = makeWav();
  const auth = await login(smoke.email, smoke.password, smoke.tenant);
  const token = auth.access_token;
  let showId = null;
  let episodeId = null;
  let deleted = false;

  expect(token).toBeTruthy();
  console.log(`Disposable podcast fixture: ${title}`);

  try {
    await authenticate(page);
    await page.goto(`${mountPath}/podcasts/studio/new`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await page.locator('#title').fill(title);
    await page.locator('#summary').fill('Disposable podcast lifecycle fixture.');
    await page.locator('#description').fill('Created and removed by the Web UK Laravel smoke gate.');
    await page.locator('#category').fill('Community');
    await page.locator('#visibility-members').check();
    await submitPost(page, page.getByRole('button', { name: 'Create show', exact: true }), '/podcasts/studio/new');

    let show = await findShow(token, title);
    expect(show).toBeTruthy();
    showId = Number(show.id);
    expect(showId).toBeGreaterThan(0);
    await expect(page).toHaveURL(new RegExp(`/podcasts/studio/${showId}\\?status=show-created$`));

    await page.locator('#title').fill(updatedTitle);
    await page.locator('#summary').fill('Updated disposable podcast lifecycle fixture.');
    await page.locator('#visibility').check();
    await submitPost(page, page.getByRole('button', { name: 'Save changes', exact: true }), `/podcasts/studio/${showId}/update`);
    show = await findShow(token, updatedTitle);
    expect(show).toBeTruthy();
    expect(show.visibility).toBe('public');

    await page.locator('#episode_title').fill(episodeTitle);
    await page.locator('#episode_number').fill('1');
    await page.locator('#episode_summary').fill('Disposable hosted audio fixture.');
    await page.locator('#audio').setInputFiles({
      name: `codex-podcast-${runId}.wav`,
      mimeType: 'audio/wav',
      buffer: audio
    });
    await submitPost(page, page.getByRole('button', { name: 'Add episode', exact: true }), `/podcasts/studio/${showId}/episodes`);

    show = await findShow(token, updatedTitle);
    const episode = (show?.episodes || []).find((item) => item?.title === episodeTitle);
    expect(episode).toBeTruthy();
    episodeId = Number(episode.id);
    expect(episodeId).toBeGreaterThan(0);
    expect(String(episode.audio_url || '')).toContain(`/api/v2/podcasts/media/`);
    await expect(page.locator('li.nexus-alpha-card', { hasText: episodeTitle })).toHaveCount(1);

    const audioResponse = await page.request.get(String(episode.audio_url), {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tenant-Slug': smoke.tenant
      },
      timeout: 300_000
    });
    expect(audioResponse.status()).toBe(200);
    expect((await audioResponse.body()).equals(audio)).toBe(true);

    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`${mountPath}/podcasts/studio/${showId}`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await expectAccessibleReflow(page);

    const episodeDelete = page.locator(`form[action$="/podcasts/studio/${showId}/episodes/${episodeId}/delete"]`);
    await submitPost(page, episodeDelete.getByRole('button', { name: 'Delete', exact: true }), `/podcasts/studio/${showId}/episodes/${episodeId}/delete`);
    show = await findShow(token, updatedTitle);
    expect((show?.episodes || []).some((item) => Number(item.id) === episodeId)).toBe(false);

    await submitPost(page, page.getByRole('button', { name: 'Delete show', exact: true }), `/podcasts/studio/${showId}/delete`);
    expect(await findShow(token, updatedTitle)).toBeNull();
    deleted = true;
  } finally {
    if (!deleted) {
      const existing = showId ? { id: showId } : (await findShow(token, updatedTitle)) || (await findShow(token, title));
      if (existing?.id) {
        await callPodcastApi(token, 'DELETE', `/${existing.id}`).catch(() => undefined);
      }
    }
  }
});
