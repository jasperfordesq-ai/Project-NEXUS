// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  eventSafetyApi,
  type EventSafety,
  type EventSafetyReviews,
} from '@/lib/event-safety-api';
import { renderEventComponent } from '@/test/events-test-harness';
import { EventSafetyAttendeeCard } from './EventSafetyAttendeeCard';
import { EventSafetyWorkspace } from './EventSafetyWorkspace';

const mockConfirm = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@/components/ui/ConfirmDialog', () => ({ useConfirm: () => mockConfirm }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => mockToast }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

function safetyFixture(reviewParticipation = false): EventSafety {
  return {
    contract_version: 1,
    event_id: 42,
    rollout: {
      mode: 'enforce',
      source: 'global',
      configuration_valid: true,
      enforcement_active: true,
    },
    requirements: {
      status: 'published',
      revision: 3,
      current_version: 2,
      published_version: 2,
      version: {
        number: 2,
        minimum_age: null,
        guardian_consent_required: false,
        minor_age_threshold: null,
        code_of_conduct: {
          required: true,
          text: 'Treat everyone with respect.',
          text_version: 'conduct-v2',
          text_hash: 'a'.repeat(64),
        },
        published_at: '2030-01-01T10:00:00Z',
      },
    },
    eligibility: {
      status: 'allow',
      reason_codes: [],
      required_actions: [],
      requirements_version: 2,
      age_at_event: 30,
      minor_at_event: false,
    },
    evidence: {
      code_of_conduct: {
        status: 'acknowledged',
        acknowledgement_id: 91,
        text_version: 'conduct-v2',
        acknowledged_at: '2030-01-02T10:00:00Z',
      },
      guardian_consent: {
        status: 'not_required',
        consent_id: null,
        consent_version: null,
        expires_at: null,
        granted_at: null,
      },
      active_denial: null,
    },
    permissions: {
      manage_requirements: reviewParticipation,
      review_participation: reviewParticipation,
      acknowledge_code_of_conduct: false,
      withdraw_code_of_conduct: !reviewParticipation,
      request_guardian_consent: false,
      withdraw_guardian_consent: false,
    },
    privacy: {
      guardian_identity_redacted: true,
      guardian_token_redacted: true,
      safeguarding_policy_evidence_redacted: true,
      free_text_review_notes_supported: false,
    },
  };
}

function reviewsFixture(): EventSafetyReviews {
  return {
    items: [{
      denial: {
        id: 61,
        decision: 'deny',
        reason_code: 'safety_review',
        status: 'active',
        decision_version: 4,
        effective_from: '2030-01-01T10:00:00Z',
        effective_until: null,
        reviewed_at: '2030-01-01T09:00:00Z',
      },
      member: { id: 7, display_name: 'Alex Member', avatar_url: null },
      reviewer: { id: 8, display_name: 'Morgan Organiser' },
      history: [],
    }],
    total: 1,
    page: 1,
    per_page: 25,
  };
}

describe('Event Safety destructive confirmations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not withdraw a code acknowledgement until the shared dialog resolves true', async () => {
    const user = userEvent.setup();
    const fixture = safetyFixture();
    vi.spyOn(eventSafetyApi, 'get').mockResolvedValue({ success: true, data: fixture });
    const withdraw = vi.spyOn(eventSafetyApi, 'withdrawCode').mockResolvedValue({ success: true, data: fixture });
    mockConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    renderEventComponent(<EventSafetyAttendeeCard eventId={42} />);
    const button = await screen.findByRole('button', { name: 'Withdraw acknowledgement' });
    await user.click(button);
    expect(withdraw).not.toHaveBeenCalled();

    await user.click(button);
    await waitFor(() => expect(withdraw).toHaveBeenCalledWith(
      42,
      91,
      expect.stringContaining('event-safety-code-withdraw-'),
    ));
    expect(mockConfirm).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'danger',
      confirmLabel: 'Withdraw acknowledgement',
    }));
  });

  it('identifies the affected member before withdrawing a participation review', async () => {
    const user = userEvent.setup();
    const safety = safetyFixture(true);
    const reviews = reviewsFixture();
    vi.spyOn(eventSafetyApi, 'get').mockResolvedValue({ success: true, data: safety });
    vi.spyOn(eventSafetyApi, 'reviews').mockResolvedValue({ success: true, data: reviews });
    const withdraw = vi.spyOn(eventSafetyApi, 'withdrawReview').mockResolvedValue({ success: true, data: reviews });
    mockConfirm.mockResolvedValue(true);

    renderEventComponent(<EventSafetyWorkspace eventId={42} />);
    await user.click(await screen.findByRole('button', { name: 'Withdraw decision' }));

    await waitFor(() => expect(withdraw).toHaveBeenCalledWith(
      42,
      61,
      4,
      expect.stringContaining('event-safety-review-withdraw-'),
    ));
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      body: 'This ends the active decision for Alex Member while preserving its audit history.',
      status: 'danger',
    }));
  });
});
