// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const toast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
};

vi.mock('@/lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  api: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/contexts', () => createMockContexts({ useToast: () => toast }));

import { api } from '@/lib/api';
import { SafeguardingTab, type MemberPreference } from './SafeguardingTab';

const mockedGet = api.get as ReturnType<typeof vi.fn>;
const mockedPost = api.post as ReturnType<typeof vi.fn>;

const preference: MemberPreference = {
  preference_id: 1,
  option_id: 10,
  option_key: 'supervised_matching',
  label: 'Supervised matching',
  description: 'Only matched with broker approval',
  selected_value: 'yes',
  consent_given_at: '2026-01-15T10:00:00Z',
  created_at: '2026-01-15T10:00:00Z',
  activations: {
    requires_broker_approval: true,
    restricts_messaging: false,
    restricts_matching: true,
    requires_vetted_interaction: false,
    vetting_type_required: null,
  },
};

const vettingStatus = {
  policy: {
    configured: true,
    contact_policy_available: true,
    jurisdiction: 'england_wales',
    label: 'England and Wales',
    attestation_code: 'dbs_enhanced',
    attestation_label: 'Enhanced DBS',
    purpose_code: 'safeguarded_member_contact',
  },
  decision: 'not_confirmed',
  review_status: null,
  confirmed_at: null,
  revoked_at: null,
};

const guardian = {
  id: 77,
  guardian_name: 'Grace Guardian',
  assigned_at: '2026-08-01T09:00:00Z',
  consent_given_at: null,
  consent_declined_at: null,
  consent_withdrawn_at: null,
  ward_response_reason: null,
  state: 'pending',
  consent_given: false,
  notes: 'Recorded during onboarding.',
};

function mockLoads(
  statusOverrides: Record<string, unknown> = {},
  preferences = [preference],
  guardians: Array<Record<string, unknown>> = [],
  wards: Array<Record<string, unknown>> = [],
) {
  mockedGet.mockImplementation((url: string) => {
    if (url === '/v2/safeguarding/my-preferences') {
      return Promise.resolve({ success: true, data: { preferences, count: preferences.length } });
    }
    if (url === '/v2/safeguarding/my-vetting-status') {
      return Promise.resolve({ success: true, data: { ...vettingStatus, ...statusOverrides } });
    }
    if (url === '/v2/safeguarding/my-guardians') {
      return Promise.resolve({
        success: true,
        data: { guardians, pending_count: guardians.filter((g) => g.state === 'pending').length },
      });
    }
    if (url === '/v2/safeguarding/my-wards') {
      return Promise.resolve({ success: true, data: { wards } });
    }
    return Promise.resolve({ success: false });
  });
}

describe('SafeguardingTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoads();
  });

  it('loads private preferences and community vetting status', async () => {
    render(<SafeguardingTab />);

    await waitFor(() => expect(screen.getByText('Supervised matching')).toBeInTheDocument());
    expect(mockedGet).toHaveBeenCalledWith('/v2/safeguarding/my-preferences');
    expect(mockedGet).toHaveBeenCalledWith('/v2/safeguarding/my-vetting-status');
    expect(screen.getByText('Enhanced DBS')).toBeInTheDocument();
    expect(screen.getByText('Not confirmed')).toBeInTheDocument();
  });

  it('shows a confirmed private community decision', async () => {
    mockLoads({ decision: 'confirmed', confirmed_at: '2026-07-11T10:00:00Z' }, []);
    render(<SafeguardingTab />);

    await waitFor(() => expect(screen.getByText('Confirmed')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Request broker review' })).toBeNull();
  });

  it('requests broker review with a genuinely empty request body', async () => {
    mockedPost.mockResolvedValue({ success: true, data: { status: 'pending' } });
    render(<SafeguardingTab />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Request broker review' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Request broker review' }));

    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith('/v2/safeguarding/vetting-review-request'));
    expect(screen.getByRole('button', { name: 'Review requested' })).toBeDisabled();
  });

  it('does not offer document, attachment, reference, or notes inputs', async () => {
    const { container } = render(<SafeguardingTab />);
    await waitFor(() => expect(screen.getByText('Enhanced DBS')).toBeInTheDocument());

    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
    expect(screen.queryByText(/certificate number/i)).toBeNull();
    expect(screen.getByText(/Do not upload or send a DBS/i)).toBeInTheDocument();
  });

  it('does not offer review when the jurisdiction policy is unavailable', async () => {
    mockLoads({
      policy: { ...vettingStatus.policy, configured: false, contact_policy_available: false },
    });
    render(<SafeguardingTab />);

    await waitFor(() => expect(screen.getByText(/has not configured a supported safeguarding contact policy/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Request broker review' })).toBeNull();
  });

  /**
   * 🔴 Guardian arrangements. These exist because the backend half shipped
   * without a screen: `/v2/safeguarding/my-guardians` and
   * `/v2/safeguarding/consent-to-guardian` were added on 2026-08-05 and had NO
   * caller in either frontend, so a ward still could not see or agree to an
   * arrangement. That is the same defect the endpoints replaced — the column's
   * only writer, SafeguardingService::recordConsent(), had no callers either.
   * An API with no UI is not a fix. These tests are the guard.
   */
  describe('guardian arrangements', () => {
    it('fetches arrangements and tells the ward when there are none', async () => {
      render(<SafeguardingTab />);

      await waitFor(() =>
        expect(mockedGet).toHaveBeenCalledWith('/v2/safeguarding/my-guardians'),
      );
      expect(screen.getByText('Guardian arrangements')).toBeInTheDocument();
      expect(
        screen.getByText('No guardian arrangements have been recorded for you.'),
      ).toBeInTheDocument();
    });

    it('shows the ward who is responsible for them, and that it grants nothing', async () => {
      mockLoads({}, [preference], [guardian]);
      render(<SafeguardingTab />);

      await waitFor(() => expect(screen.getByText('Grace Guardian')).toBeInTheDocument());
      expect(screen.getByText('Recorded during onboarding.')).toBeInTheDocument();
      expect(screen.getByText('Waiting for your answer')).toBeInTheDocument();
      // The record confers no capability, and the screen must say so — no
      // authorisation path anywhere consults safeguarding_assignments.
      expect(screen.getByText(/does not allow them to create listings/i)).toBeInTheDocument();
    });

    it('records the ward’s agreement against the right arrangement', async () => {
      mockLoads({}, [preference], [guardian]);
      mockedPost.mockResolvedValue({ success: true, data: { consent_given: true, already_given: false } });
      render(<SafeguardingTab />);

      const agree = await screen.findByRole('button', { name: 'I agree to this arrangement' });
      fireEvent.click(agree);

      await waitFor(() =>
        expect(mockedPost).toHaveBeenCalledWith('/v2/safeguarding/consent-to-guardian', {
          assignment_id: 77,
        }),
      );
      expect(toast.success).toHaveBeenCalled();
    });

    it('offers withdraw, not agree, once consent is recorded', async () => {
      mockLoads({}, [preference], [
        { ...guardian, state: 'consented', consent_given: true, consent_given_at: '2026-08-02T09:00:00Z' },
      ]);
      render(<SafeguardingTab />);

      await waitFor(() => expect(screen.getByText('Grace Guardian')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: 'I agree to this arrangement' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Withdraw my agreement' })).toBeInTheDocument();
    });

    /**
     * 🔴 The core gap this work exists to close: a ward could ONLY agree. There
     * was no refusal endpoint and no column to hold the answer. A consent that
     * cannot be refused is not consent.
     */
    it('lets the ward refuse, as plainly as agreeing', async () => {
      mockLoads({}, [preference], [guardian]);
      mockedPost.mockResolvedValue({ success: true, data: { state: 'declined', already: false } });
      render(<SafeguardingTab />);

      fireEvent.click(await screen.findByRole('button', { name: 'I do not agree' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Yes, I do not agree' }));

      await waitFor(() =>
        expect(mockedPost).toHaveBeenCalledWith('/v2/safeguarding/decline-guardian', {
          assignment_id: 77,
        }),
      );
      expect(toast.success).toHaveBeenCalled();
    });

    it('sends an optional reason only when the ward actually gave one', async () => {
      mockLoads({}, [preference], [guardian]);
      mockedPost.mockResolvedValue({ success: true, data: { state: 'declined', already: false } });
      render(<SafeguardingTab />);

      fireEvent.click(await screen.findByRole('button', { name: 'I do not agree' }));
      fireEvent.change(await screen.findByLabelText(/Reason \(optional\)/i), {
        target: { value: '  I would rather not say much  ' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Yes, I do not agree' }));

      await waitFor(() =>
        expect(mockedPost).toHaveBeenCalledWith('/v2/safeguarding/decline-guardian', {
          assignment_id: 77,
          reason: 'I would rather not say much',
        }),
      );
    });

    it('lets the ward withdraw agreement they already gave', async () => {
      mockLoads({}, [preference], [
        { ...guardian, state: 'consented', consent_given: true, consent_given_at: '2026-08-02T09:00:00Z' },
      ]);
      mockedPost.mockResolvedValue({ success: true, data: { state: 'withdrawn', already: false } });
      render(<SafeguardingTab />);

      fireEvent.click(await screen.findByRole('button', { name: 'Withdraw my agreement' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Yes, withdraw it' }));

      await waitFor(() =>
        expect(mockedPost).toHaveBeenCalledWith('/v2/safeguarding/withdraw-guardian-consent', {
          assignment_id: 77,
        }),
      );
    });

    it('lets a ward who refused change their mind', async () => {
      mockLoads({}, [preference], [
        { ...guardian, state: 'declined', consent_declined_at: '2026-08-02T09:00:00Z' },
      ]);
      render(<SafeguardingTab />);

      // The chip carries the date alongside the state, so match loosely.
      await waitFor(() => expect(screen.getByText(/You did not agree/)).toBeInTheDocument());
      expect(screen.getByRole('button', { name: 'I agree after all' })).toBeInTheDocument();
    });

    it('shows the ward their own recorded reason back', async () => {
      mockLoads({}, [preference], [
        { ...guardian, state: 'declined', consent_declined_at: '2026-08-02T09:00:00Z', ward_response_reason: 'Not comfortable yet' },
      ]);
      render(<SafeguardingTab />);

      await waitFor(() => expect(screen.getByText(/Not comfortable yet/)).toBeInTheDocument());
    });

    /**
     * 🔴 Guards against the crash class that took down the Hours report: indexing
     * a lookup table with an unvalidated server value. `NEXT_ACTIONS[undefined]`
     * is undefined and `.includes()` on it throws, killing the whole tab.
     */
    it('does not crash when the server omits or mangles the state field', async () => {
      mockLoads({}, [preference], [
        { ...guardian, state: undefined },
        { ...guardian, id: 78, guardian_name: 'Odd State', state: 'something_new', consent_given_at: '2026-08-02T09:00:00Z' },
      ]);
      render(<SafeguardingTab />);

      await waitFor(() => expect(screen.getByText('Grace Guardian')).toBeInTheDocument());
      // Derived from the timestamps rather than trusted blindly.
      expect(screen.getByText('Odd State')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'I agree to this arrangement' })).toBeInTheDocument();
    });

    it('shows a guardian the people they support, and only when there are any', async () => {
      mockLoads({}, [preference], [], [
        { id: 90, ward_name: 'Wendy Ward', assigned_at: '2026-08-01T09:00:00Z', state: 'declined' },
      ]);
      render(<SafeguardingTab />);

      await waitFor(() => expect(screen.getByText('People you support')).toBeInTheDocument());
      expect(screen.getByText('Wendy Ward')).toBeInTheDocument();
      expect(screen.getByText('They did not agree')).toBeInTheDocument();
      // And it grants nothing — the copy must keep saying so.
      expect(screen.getByText(/does not let you act for them/i)).toBeInTheDocument();
    });

    it('hides the guardian section entirely when they support nobody', async () => {
      mockLoads({}, [preference], [guardian], []);
      render(<SafeguardingTab />);

      await waitFor(() => expect(screen.getByText('Grace Guardian')).toBeInTheDocument());
      expect(screen.queryByText('People you support')).toBeNull();
    });

    it('surfaces a failure instead of silently reporting success', async () => {
      mockLoads({}, [preference], [guardian]);
      mockedPost.mockResolvedValue({ success: false, error: 'nope' });
      render(<SafeguardingTab />);

      fireEvent.click(await screen.findByRole('button', { name: 'I agree to this arrangement' }));

      // api.ts never throws, so a missing `success` check would show success here.
      await waitFor(() => expect(toast.error).toHaveBeenCalled());
      expect(toast.success).not.toHaveBeenCalled();
    });
  });

  it('preserves member preference revocation', async () => {
    mockedPost.mockResolvedValue({ success: true });
    render(<SafeguardingTab />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, revoke' }));

    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith('/v2/safeguarding/revoke', { option_id: 10 }));
  });
});
