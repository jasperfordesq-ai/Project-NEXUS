// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Replacing an episode's audio file is a multipart request. Its field builder
 * dropped null values, so an edit that cleared the schedule or an episode number
 * while replacing the audio sent nothing for them and the old values stayed.
 * null is now sent as an empty field, which the API reads as null.
 */

const { updatePodcastEpisode } = require('../src/lib/api');

describe('multipart episode update', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('sends cleared fields as empty values instead of leaving them out', async () => {
    let body = null;
    globalThis.fetch = jest.fn(async (_url, options) => {
      body = options.body;
      return new Response(JSON.stringify({ data: { id: 9 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    await updatePodcastEpisode('token', 5, 9, {
      title: 'Episode',
      scheduled_for: null,
      episode_number: null,
      file: { buffer: Buffer.from('audio'), filename: 'a.mp3', contentType: 'audio/mpeg' }
    });

    expect(body.get('scheduled_for')).toBe('');
    expect(body.get('episode_number')).toBe('');
    expect(body.get('title')).toBe('Episode');
    expect(body.has('season_number')).toBe(false);
  });
});
