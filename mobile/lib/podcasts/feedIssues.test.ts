// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { feedIssueKey } from './feedIssues';

describe('feedIssueKey', () => {
  it('collapses per-episode audio issues onto one translatable key each', () => {
    expect(feedIssueKey('episode_41_missing_audio_url')).toBe('episode_missing_audio_url');
    expect(feedIssueKey('episode_7_missing_audio_length')).toBe('episode_missing_audio_length');
    expect(feedIssueKey('episode_1203_missing_audio_mime')).toBe('episode_missing_audio_mime');
  });

  it('leaves show-level issues untouched so their own keys still resolve', () => {
    for (const issue of ['show_not_public', 'missing_owner_email', 'missing_artwork', 'missing_language']) {
      expect(feedIssueKey(issue)).toBe(issue);
    }
  });

  it('does not match a near-miss shape, so an unknown issue falls back to its raw text', () => {
    // No id, wrong id shape, and an unknown suffix must all pass straight through:
    // the studio renders the raw string rather than an invented translation key.
    expect(feedIssueKey('episode_missing_audio_url')).toBe('episode_missing_audio_url');
    expect(feedIssueKey('episode_x_missing_audio_url')).toBe('episode_x_missing_audio_url');
    expect(feedIssueKey('episode_9_missing_audio_bitrate')).toBe('episode_9_missing_audio_bitrate');
  });
});
