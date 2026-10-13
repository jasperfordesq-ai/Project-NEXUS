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
import { EventSafetyWorkspace } from './EventSafetyWorkspace';

vi.mock('@/components/ui/ConfirmDialog', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

function safetyFixture(mode: EventSafety['rollout']['mode'] = 'enforce'): EventSafety {
  return {
    contract_version: 1,
    event_id: 42,
    rollout: {
      mode,
      source: 'global',
      configuration_valid: true,
      enforcement_active: mode === 'enforce',
    },
    requirements: {
      status: 'draft',
      revision: 3,
      current_version: 2,
      published_version: null,
      version: {
        number: 2,
        minimum_age: 18,
        guardian_consent_required: false,
        minor_age_threshold: null,
        code_of_conduct: {
          required: false,
          text: null,
          text_version: null,
          text_hash: null,
        },
        published_at: null,
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
        status: 'not_required',
        acknowledgement_id: null,
        text_version: null,
        acknowledged_at: null,
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
      manage_requirements: true,
      review_participation: true,
      acknowledge_code_of_conduct: false,
      withdraw_code_of_conduct: false,
      request_guardian_consent: false,
      withdraw_guardian_consent: false,
    },
    privacy: {
      guardian_identity_redacted: true,
      guardian_token_redacted: true,
      safeguarding_policy_evidence_redacted: true,
      free_text_review_notes_supported: false,
    },
  } as EventSafety;
}

function reviewsFixture(page: number): EventSafetyReviews {
  return {
    items: [{
      denial: {
        id: 60 + page,
        decision: 'deny',
        reason_code: 'safety_review',
        status: 'active',
        decision_version: 1,
        effective_from: '2030-01-01T10:00:00Z',
        effective_until: null,
        reviewed_at: '2030-01-01T09:00:00Z',
      },
      member: { id: 7 + page, display_name: `Reviewed Member ${page}`, avatar_url: null },
      reviewer: { id: 8, display_name: 'Morgan Organiser' },
      history: [],
    }],
    total: 30,
    page,
    per_page: 25,
  };
}

describe('EventSafetyWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps unsaved requirement edits while paging through safety reviews (B11)', async () => {
    const user = userEvent.setup();
    const get = vi.spyOn(eventSafetyApi, 'get').mockResolvedValue({ success: true, data: safetyFixture() });
    const reviews = vi.spyOn(eventSafetyApi, 'reviews').mockImplementation(
      async (_eventId: number, page = 1) => ({ success: true, data: reviewsFixture(page) }),
    );
    renderEventComponent(<EventSafetyWorkspace eventId={42} />);

    const minimumAge = await screen.findByRole('spinbutton', { name: /Minimum age/ });
    expect(minimumAge).toHaveValue(18);
    await user.clear(minimumAge);
    await user.type(minimumAge, '21');
    expect(await screen.findByText('Reviewed Member 1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '2' }));

    expect(await screen.findByText('Reviewed Member 2')).toBeInTheDocument();
    await waitFor(() => expect(reviews).toHaveBeenLastCalledWith(42, 2, 25));
    expect(get).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('spinbutton', { name: /Minimum age/ })).toHaveValue(21);
  });

  it('explains that enforcement is off and keeps the editor out of the way until asked (B9)', async () => {
    const user = userEvent.setup();
    vi.spyOn(eventSafetyApi, 'get').mockResolvedValue({ success: true, data: safetyFixture('off') });
    vi.spyOn(eventSafetyApi, 'reviews').mockResolvedValue({ success: true, data: reviewsFixture(1) });
    renderEventComponent(<EventSafetyWorkspace eventId={42} />);

    expect(await screen.findByText('Safety enforcement is switched off')).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: /Minimum age/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Prepare requirements anyway' }));

    expect(await screen.findByRole('spinbutton', { name: /Minimum age/ })).toBeInTheDocument();
    expect(screen.getByText('Safety enforcement is switched off')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Prepare requirements anyway' })).not.toBeInTheDocument();
  });

  it('shows the editor directly when enforcement is active', async () => {
    vi.spyOn(eventSafetyApi, 'get').mockResolvedValue({ success: true, data: safetyFixture('enforce') });
    vi.spyOn(eventSafetyApi, 'reviews').mockResolvedValue({ success: true, data: reviewsFixture(1) });
    renderEventComponent(<EventSafetyWorkspace eventId={42} />);

    expect(await screen.findByRole('spinbutton', { name: /Minimum age/ })).toBeInTheDocument();
    expect(screen.queryByText('Safety enforcement is switched off')).not.toBeInTheDocument();
  });
});
