// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  eventRegistrationApi,
  type EventRegistrationOverview,
  type InvitationCampaign,
  type RegistrationForm,
} from '@/lib/event-registration-api';
import { renderEventRoute } from '@/test/events-test-harness';
import { EventRegistrationWorkspace } from './EventRegistrationWorkspace';

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));
const mockConfirm = vi.hoisted(() => vi.fn());
const mockAuth = vi.hoisted(() => ({
  user: null as null | { id: number; role: string; is_admin?: boolean },
}));

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => mockToast }));
vi.mock('@/components/ui/ConfirmDialog', () => ({ useConfirm: () => mockConfirm }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuthOptional: () => ({ user: mockAuth.user }),
}));

function formFixture(): RegistrationForm {
  return {
    id: 11,
    version_number: 2,
    revision: 3,
    status: 'draft',
    name: 'Attendee requirements',
    description: 'Information needed to run the event safely.',
    questions: [{
      id: 20,
      position: 1,
      stable_key: 'dietary_needs',
      question_type: 'dietary',
      prompt: 'Do you have any dietary requirements?',
      help_text: null,
      is_required: false,
      data_classification: 'confidential',
      purpose: 'Plan safe catering',
      retention_days: 30,
      choice_options: null,
      validation_rules: { max_length: 500 },
      visibility_rules: null,
      displayed_text: null,
      displayed_text_version: null,
    }],
  };
}

function campaignFixture(): InvitationCampaign {
  return {
    id: 31,
    campaign_type: 'member',
    status: 'previewed',
    revision: 1,
    preview_count: 3,
    valid_count: 2,
    error_count: 1,
    preview_errors: [{ row: 3, code: 'member_not_found' }],
    default_locale: 'en',
    delivery_counts: {},
    invitations_count: 0,
  };
}

function overviewFixture(): EventRegistrationOverview {
  return {
    settings: {
      id: 5,
      revision: 7,
      status: 'draft',
      approval_mode: 'manual',
      form_state: 'draft',
      published_form_version: null,
      per_member_limit: 1,
      guests_enabled: true,
      max_guests_per_registration: 2,
      guest_retention_days: 30,
    },
    forms: [formFixture()],
    submissions: [{
      id: 71,
      registration_id: 61,
      form_version_id: 11,
      user_id: 9,
      member_name: 'Alex Member',
      revision: 4,
      status: 'submitted',
      attempt_number: 2,
      effective_slot: 1,
      submitted_at: '2030-01-01T10:00:00Z',
    }],
    campaigns: [],
    guests: [{
      id: 81,
      registration_id: 61,
      guest_number: 1,
      revision: 1,
      status: 'captured',
      display_name: 'Sam Guest',
      notification_consent: false,
      attendance: null,
    }],
    pagination: {
      submissions: {
        page: 1,
        per_page: 50,
        total: 1,
        last_page: 1,
        page_count: 1,
        from: 1,
        to: 1,
        has_more: false,
        previous_page: null,
        next_page: null,
      },
      campaigns: {
        page: 1,
        per_page: 50,
        total: 0,
        last_page: 1,
        page_count: 0,
        from: null,
        to: null,
        has_more: false,
        previous_page: null,
        next_page: null,
      },
      guests: {
        page: 1,
        per_page: 50,
        total: 1,
        last_page: 1,
        page_count: 1,
        from: 1,
        to: 1,
        has_more: false,
        previous_page: null,
        next_page: null,
      },
    },
    summary: {
      submissions_total: 1,
      campaigns_total: 0,
      guests_total: 1,
    },
    permissions: {
      view_roster: true,
      view_sensitive_answers: false,
      export_answers: true,
      manage_retention: true,
      manage_attendance: true,
    },
  };
}

describe('EventRegistrationWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.user = { id: 5, role: 'member' };
    mockConfirm.mockResolvedValue(true);
    vi.spyOn(eventRegistrationApi, 'organizerOverview').mockResolvedValue({
      success: true,
      data: overviewFixture(),
    });
  });

  it('saves and publishes the bounded registration policy', async () => {
    const user = userEvent.setup();
    const savedSettings = { ...overviewFixture().settings!, revision: 8 };
    const save = vi.spyOn(eventRegistrationApi, 'saveSettings').mockResolvedValue({
      success: true,
      data: { value: savedSettings, changed: true, idempotent_replay: false },
    });
    const publish = vi.spyOn(eventRegistrationApi, 'publishSettings').mockResolvedValue({
      success: true,
      data: { value: { ...savedSettings, status: 'published', revision: 9 }, changed: true, idempotent_replay: false },
    });
    renderEventRoute(<EventRegistrationWorkspace eventId={42} />, {
      path: '/events/42/manage/registration',
      route: '/events/42/manage/registration',
    });

    const memberLimit = await screen.findByRole('spinbutton', { name: 'Registrations per member' });
    await user.clear(memberLimit);
    await user.type(memberLimit, '3');
    await user.click(screen.getByRole('button', { name: 'Save policy' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(42, expect.objectContaining({
      approval_mode: 'manual',
      per_member_limit: 3,
      guests_enabled: true,
      max_guests_per_registration: 2,
      guest_retention_days: 30,
      expected_revision: 7,
    })));

    await user.click(screen.getByRole('button', { name: 'Publish policy' }));
    await waitFor(() => expect(publish).toHaveBeenCalledWith(42, 7));
  });

  it('edits a versioned form without sending database-only question fields', async () => {
    const user = userEvent.setup();
    const update = vi.spyOn(eventRegistrationApi, 'updateForm').mockResolvedValue({
      success: true,
      data: { value: formFixture(), changed: true, idempotent_replay: false },
    });
    renderEventRoute(<EventRegistrationWorkspace eventId={42} />, {
      path: '/events/42/manage/registration',
      route: '/events/42/manage/registration',
    });

    expect(await screen.findByRole('heading', { name: 'Attendee requirements' })).toBeInTheDocument();
    expect(screen.getByText('Privacy controls are enforced')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit draft' }));
    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByRole('textbox', { name: 'Form name' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Form name' }), 'Updated requirements');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(update).toHaveBeenCalledWith(
      42,
      11,
      expect.objectContaining({
        name: 'Updated requirements',
        expected_form_revision: 3,
        expected_settings_revision: 7,
      }),
    ));
  });

  it('requires purpose evidence and keeps sensitive answers unavailable without permission', async () => {
    const user = userEvent.setup();
    const review = vi.spyOn(eventRegistrationApi, 'reviewAnswers').mockResolvedValue({
      success: true,
      data: {
        answers: {
          dietary_needs: {
            question_id: 20,
            value: 'No peanuts',
            purged: false,
            classification: 'confidential',
          },
        },
      },
    });
    renderEventRoute(<EventRegistrationWorkspace eventId={42} />, {
      path: '/events/42/manage/registration',
      route: '/events/42/manage/registration',
    });

    await user.click(await screen.findByRole('tab', { name: 'Submissions' }));
    await user.click(await screen.findByRole('button', { name: 'Review answers' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Include sensitive answers')).not.toBeInTheDocument();
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason for accessing these answers' }), 'Catering safety review');
    await user.click(within(dialog).getByRole('button', { name: 'Open answers' }));

    expect(await within(dialog).findByText('"No peanuts"')).toBeInTheDocument();
    expect(review).toHaveBeenCalledWith(42, 71, expect.objectContaining({
      purpose: 'Catering safety review',
      include_sensitive: false,
    }));
  });

  it('previews a frozen campaign snapshot and performs guest check-in through the authoritative APIs', async () => {
    const user = userEvent.setup();
    const preview = vi.spyOn(eventRegistrationApi, 'previewCampaign').mockResolvedValue({
      success: true,
      data: { value: campaignFixture(), changed: true, idempotent_replay: false },
    });
    const attendance = vi.spyOn(eventRegistrationApi, 'transitionGuestAttendance').mockResolvedValue({
      success: true,
      data: { changed: true },
    });
    renderEventRoute(<EventRegistrationWorkspace eventId={42} />, {
      path: '/events/42/manage/registration',
      route: '/events/42/manage/registration',
    });

    await user.click(await screen.findByRole('tab', { name: 'Invitations' }));
    await user.type(await screen.findByRole('textbox', { name: 'Member IDs' }), '7, 8, 999');
    await user.click(screen.getByRole('button', { name: 'Preview recipients' }));
    expect(await screen.findByText('This exact valid-recipient snapshot will be used at send time, even if group membership later changes.')).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith(42, 'member', { member_ids: [7, 8, 999] }, 'en');

    await user.click(screen.getByRole('tab', { name: 'Guests' }));
    await user.click(await screen.findByRole('button', { name: 'Check in' }));
    await waitFor(() => expect(attendance).toHaveBeenCalledWith(42, 81, 'check_in', 0));
  });

  it('loads every paginated registration collection without discarding earlier records', async () => {
    const user = userEvent.setup();
    const initial = overviewFixture();
    initial.campaigns = [campaignFixture()];
    initial.pagination = {
      submissions: { ...initial.pagination!.submissions, per_page: 1, total: 2, last_page: 2, has_more: true, next_page: 2 },
      campaigns: { ...initial.pagination!.campaigns, per_page: 1, total: 2, last_page: 2, page_count: 1, from: 1, to: 1, has_more: true, next_page: 2 },
      guests: { ...initial.pagination!.guests, per_page: 1, total: 2, last_page: 2, has_more: true, next_page: 2 },
    };
    initial.summary = { submissions_total: 2, campaigns_total: 2, guests_total: 2 };
    const secondSubmission = {
      ...initial.submissions[0],
      id: 72,
      member_name: 'Jamie Member',
    };
    const secondCampaign = { ...campaignFixture(), id: 32 };
    const secondGuest = { ...initial.guests[0], id: 82, display_name: 'Taylor Guest' };
    const pageTwo = (collection: 'submissions' | 'campaigns' | 'guests'): EventRegistrationOverview => ({
      ...initial,
      submissions: collection === 'submissions' ? [secondSubmission] : initial.submissions,
      campaigns: collection === 'campaigns' ? [secondCampaign] : initial.campaigns,
      guests: collection === 'guests' ? [secondGuest] : initial.guests,
      pagination: {
        ...initial.pagination!,
        [collection]: {
          ...initial.pagination![collection],
          page: 2,
          from: 2,
          to: 2,
          has_more: false,
          previous_page: 1,
          next_page: null,
        },
      },
    });
    vi.mocked(eventRegistrationApi.organizerOverview)
      .mockResolvedValueOnce({ success: true, data: initial })
      .mockResolvedValueOnce({ success: true, data: pageTwo('submissions') })
      .mockResolvedValueOnce({ success: true, data: pageTwo('campaigns') })
      .mockResolvedValueOnce({ success: true, data: pageTwo('guests') });
    renderEventRoute(<EventRegistrationWorkspace eventId={42} />, {
      path: '/events/42/manage/registration',
      route: '/events/42/manage/registration',
    });

    await user.click(await screen.findByRole('tab', { name: 'Submissions' }));
    await user.click(await screen.findByRole('button', { name: 'Load more (1 remaining)' }));
    expect(await screen.findByText('Jamie Member')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Invitations' }));
    await user.click(await screen.findByRole('button', { name: 'Load more (1 remaining)' }));
    expect(await screen.findAllByRole('button', { name: 'Cancel campaign' })).toHaveLength(2);

    await user.click(screen.getByRole('tab', { name: 'Guests' }));
    await user.click(await screen.findByRole('button', { name: 'Load more (1 remaining)' }));
    expect(await screen.findByText('Taylor Guest')).toBeInTheDocument();

    expect(eventRegistrationApi.organizerOverview).toHaveBeenNthCalledWith(2, 42, {
      submissions_page: 2,
      submissions_per_page: 1,
    });
    expect(eventRegistrationApi.organizerOverview).toHaveBeenNthCalledWith(3, 42, {
      campaigns_page: 2,
      campaigns_per_page: 1,
    });
    expect(eventRegistrationApi.organizerOverview).toHaveBeenNthCalledWith(4, 42, {
      guests_page: 2,
      guests_per_page: 1,
    });
  });

  it('keeps a frozen retention preview until irreversible anonymisation is confirmed', async () => {
    const user = userEvent.setup();
    const run = {
      id: 501,
      mode: 'dry_run' as const,
      dry_run_id: null,
      as_of_utc: '2030-01-31T23:59:59Z',
      eligible_count: 4,
      affected_count: 0,
      completed_at: '2030-02-01T00:00:00Z',
    };
    vi.spyOn(eventRegistrationApi, 'retentionDryRun').mockResolvedValue({
      success: true,
      data: { value: run, changed: true, idempotent_replay: false },
    });
    const apply = vi.spyOn(eventRegistrationApi, 'retentionApply').mockResolvedValue({
      success: true,
      data: {
        value: { ...run, mode: 'apply', dry_run_id: run.id, affected_count: 4 },
        changed: true,
        idempotent_replay: false,
      },
    });
    mockConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderEventRoute(<EventRegistrationWorkspace eventId={42} />, {
      path: '/events/42/manage/registration',
      route: '/events/42/manage/registration',
    });

    await user.click(await screen.findByRole('tab', { name: 'Retention' }));
    await user.click(await screen.findByRole('button', { name: 'Run preview' }));
    const applyButton = await screen.findByRole('button', { name: 'Apply anonymisation' });

    await user.click(applyButton);
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByText('4')).toBeInTheDocument();

    await user.click(applyButton);
    await waitFor(() => expect(apply).toHaveBeenCalledWith(42, 501));
    expect(mockConfirm).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'danger',
      confirmLabel: 'Apply anonymisation',
    }));
  });

  describe('F-161: bulk invitation types are for community admins', () => {
    async function openCampaignTypes(user: ReturnType<typeof userEvent.setup>) {
      renderEventRoute(<EventRegistrationWorkspace eventId={42} />, {
        path: '/events/42/manage/registration',
        route: '/events/42/manage/registration',
      });
      await user.click(await screen.findByRole('tab', { name: 'Invitations' }));
      const label = await screen.findByText('Audience source');
      const selectRoot = label.closest('[data-slot="select"]');
      expect(selectRoot).not.toBeNull();
      await user.click(within(selectRoot as HTMLElement).getByRole('button'));
      await screen.findByRole('option', { name: 'Selected members' });
    }

    it('offers an ordinary organiser only the member picker and group invitations', async () => {
      const user = userEvent.setup();
      await openCampaignTypes(user);

      expect(screen.getByRole('option', { name: 'Group members' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Email addresses' })).not.toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Audience segment' })).not.toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'CSV upload' })).not.toBeInTheDocument();
    });

    it('keeps every campaign type for a community admin', async () => {
      mockAuth.user = { id: 1, role: 'admin', is_admin: true };
      const user = userEvent.setup();
      await openCampaignTypes(user);

      expect(screen.getByRole('option', { name: 'Email addresses' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Audience segment' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'CSV upload' })).toBeInTheDocument();
    });
  });
});
