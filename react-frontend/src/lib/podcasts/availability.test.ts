// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import { episodeAvailability } from './availability';

const live = {
  status: 'published' as const,
  moderation_status: 'approved' as const,
  scheduled_for: null,
  hosted_audio: true,
  media_processing_status: 'complete',
  media_scan_status: 'clean',
};

describe('episodeAvailability', () => {
  it('is null for an episode listeners can hear', () => {
    expect(episodeAvailability(live, String)).toBeNull();
  });

  it('calls an unpublished episode a draft, whatever its moderation result', () => {
    // 🔴 The episode page used to show "Approved" for this exact episode (25 Oct 2026).
    expect(episodeAvailability({ ...live, status: 'draft' }, String)).toEqual({ key: 'status.draft', color: 'warning' });
  });

  it('names review, rejection, a future schedule and unready audio', () => {
    expect(episodeAvailability({ ...live, moderation_status: 'pending' }, String)?.key).toBe('moderation.pending');
    expect(episodeAvailability({ ...live, moderation_status: 'rejected' }, String)).toMatchObject({ key: 'moderation.rejected', color: 'danger' });
    expect(episodeAvailability({ ...live, scheduled_for: '2999-01-02T09:30:00Z' }, () => 'soon')).toEqual({
      key: 'studio.scheduled_for_chip', params: { date: 'soon' }, color: 'warning',
    });
    expect(episodeAvailability({ ...live, media_scan_status: 'pending' }, String)).toMatchObject({
      key: 'studio.media_processing_status', params: { status: 'pending' }, color: 'warning',
    });
    expect(episodeAvailability({ ...live, media_scan_status: 'infected' }, String)?.color).toBe('danger');
  });

  it('ignores media state for a linked (not uploaded) episode', () => {
    expect(episodeAvailability({ ...live, hosted_audio: false, media_scan_status: null, media_processing_status: null }, String)).toBeNull();
  });
});
