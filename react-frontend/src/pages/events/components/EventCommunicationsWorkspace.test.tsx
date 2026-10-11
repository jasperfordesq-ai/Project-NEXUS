// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  eventCommunicationsApi,
  type EventBroadcast,
  type EventBroadcastDetail,
} from '@/lib/event-communications-api';
import { renderEventComponent } from '@/test/events-test-harness';
import { EventCommunicationsWorkspace } from './EventCommunicationsWorkspace';

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => mockToast }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('react-i18next', () => {
  const labels: Record<string, string> = {
    title: 'Organizer communications',
    description: 'Compose, schedule and audit messages.',
    new_message: 'New message',
    privacy_title: 'Audience privacy is protected',
    privacy_description: 'Only aggregate delivery totals are shown.',
    empty_title: 'No communications yet',
    empty_description: 'Create a draft.',
    loading: 'Loading communications',
    audience: 'Audience',
    channels: 'Channels',
    delivery: 'Delivery',
    scheduled_for: 'Scheduled for',
    not_recorded: 'Not recorded',
    view_history: 'View history',
    edit: 'Edit draft',
    schedule: 'Schedule',
    cancel: 'Cancel',
    retry_failed: 'Retry failed deliveries',
    composer_new_title: 'New message for {{title}}',
    composer_edit_title: 'Edit message draft',
    variant_label: 'Message type',
    segments_label: 'Audience segments',
    segments_description: 'Exact canonical audiences.',
    channels_label: 'Delivery channels',
    body_label: 'Message',
    body_description: 'Your wording is preserved exactly.',
    close: 'Close',
    preview_audience: 'Preview audience',
    save_draft: 'Save draft',
    preview_title: 'Exact audience preview',
    preview_summary: '{{recipients}} recipients and {{deliveries}} deliveries.',
    history_title: 'Message audit history',
    loading_history: 'Loading audit history',
    history_load_more: 'Load more history',
    history_entry_meta: 'Version {{version}} · {{date}}',
    load_history_error: 'The audit history could not be loaded.',
    create_success: 'Draft created.',
    'variants.announcement': 'Announcement',
    'statuses.draft': 'Draft',
    'segment_labels.registration_confirmed': 'Confirmed registrations',
    'segment_labels.waitlist_active': 'Active waitlist',
    'segment_labels.attendance_attended': 'Attended',
    'segment_labels.attendance_no_show': 'Did not attend',
    'channel_labels.email': 'Email',
    'channel_labels.in_app': 'In-app notification',
    'channel_labels.push': 'Push notification',
    'history_actions.created': 'Draft created',
    'history_actions.revised': 'Draft revised',
  };
  return {
    useTranslation: () => ({
      t: (key: string, values?: Record<string, unknown>) => {
        let value = labels[key] ?? key;
        Object.entries(values ?? {}).forEach(([name, replacement]) => {
          value = value.replace(`{{${name}}}`, String(replacement));
        });
        if (key === 'recipient_count') return `${String(values?.count ?? 0)} recipients`;
        if (key === 'delivery_progress') return `${String(values?.delivered ?? 0)} of ${String(values?.total ?? 0)} delivered`;
        if (key === 'version') return `Version ${String(values?.version ?? '')}`;
        return value;
      },
      i18n: { language: 'en' },
    }),
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

function broadcastFixture(overrides: Partial<EventBroadcast> = {}): EventBroadcast {
  return {
    contract_version: 1,
    id: 8,
    event_id: 42,
    variant: 'announcement',
    status: 'draft',
    version: 1,
    audience: { segments: ['registration_confirmed'], recipient_count: 12 },
    channels: ['email', 'in_app'],
    body: null,
    delivery: { total: 0, delivered: 0, suppressed: 0, dead_lettered: 0, failure_code: null },
    capabilities: { edit: true, schedule: true, cancel: true, retry: false },
    scheduled_at: null,
    cancelled_at: null,
    sent_at: null,
    failed_at: null,
    created_at: '2026-07-11T10:00:00+00:00',
    updated_at: '2026-07-11T10:00:00+00:00',
    ...overrides,
  };
}

function detailFixture(body = 'Exact organizer prose.'): EventBroadcastDetail {
  return {
    broadcast: broadcastFixture({ body }),
    history: [{
      id: 1,
      version: 1,
      action: 'created',
      from_status: null,
      to_status: 'draft',
      metadata: {},
      created_at: '2026-07-11T10:00:00+00:00',
    }],
    history_meta: {
      current_page: 1,
      per_page: 50,
      total: 1,
      total_pages: 1,
      has_more: false,
    },
  };
}

describe('EventCommunicationsWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(eventCommunicationsApi, 'list').mockResolvedValue({
      success: true,
      data: [broadcastFixture()],
      meta: { current_page: 1, per_page: 20, total: 1, total_pages: 1, has_more: false },
    });
  });

  it('renders only aggregate audience and delivery evidence', async () => {
    renderEventComponent(<EventCommunicationsWorkspace eventId={42} eventTitle="Community summit" />);

    expect(await screen.findByRole('heading', { name: 'Organizer communications' })).toBeInTheDocument();
    expect(screen.getByText('Audience privacy is protected')).toBeInTheDocument();
    expect(screen.getByText('12 recipients')).toBeInTheDocument();
    expect(screen.getByText('0 of 0 delivered')).toBeInTheDocument();
    expect(screen.queryByText(/@/)).not.toBeInTheDocument();
  });

  it('keeps the composer above fixed navigation and inside short viewport insets', async () => {
    const user = userEvent.setup();
    renderEventComponent(<EventCommunicationsWorkspace eventId={42} eventTitle="Community summit" />);

    await user.click(await screen.findByRole('button', { name: 'New message' }));
    const dialog = await screen.findByRole('dialog', { name: 'New message for Community summit' });
    const backdrop = dialog.closest<HTMLElement>('[data-slot="modal-backdrop"]');
    const container = dialog.closest<HTMLElement>('[data-slot="modal-container"]');

    expect(backdrop).toHaveClass('z-[var(--z-modal-backdrop)]');
    expect(container).toHaveClass(
      'z-[var(--z-modal)]',
      'pt-[calc(var(--safe-area-top)+1rem)]',
      'pb-[calc(var(--safe-area-bottom)+1rem)]',
      'sm:pt-[calc(var(--safe-area-top)+2.5rem)]',
      'sm:pb-[calc(var(--safe-area-bottom)+2.5rem)]',
    );
    expect(within(dialog).getByRole('button', { name: 'accessibility.close' })).toBeInTheDocument();
  });

  it('requires a fresh exact-audience preview before preserving a new draft', async () => {
    const user = userEvent.setup();
    vi.spyOn(eventCommunicationsApi, 'preview').mockResolvedValue({
      success: true,
      data: {
        contract_version: 1,
        event_id: 42,
        variant: 'announcement',
        segments: ['registration_confirmed'],
        channels: ['email', 'in_app'],
        recipient_count: 12,
        delivery_count: 24,
        segment_counts: { registration_confirmed: 12 },
        generated_at: '2026-07-11T10:00:00+00:00',
      },
    });
    const create = vi.spyOn(eventCommunicationsApi, 'create').mockResolvedValue({
      success: true,
      data: { ...detailFixture(), changed: true, idempotent_replay: false },
    });
    renderEventComponent(<EventCommunicationsWorkspace eventId={42} eventTitle="Community summit" />);

    await user.click(await screen.findByRole('button', { name: 'New message' }));
    const dialog = await screen.findByRole('dialog');
    const save = within(dialog).getByRole('button', { name: 'Save draft' });
    expect(save).toBeDisabled();

    await user.type(within(dialog).getByRole('textbox', { name: 'Message' }), 'Exact organizer prose.');
    await user.click(within(dialog).getByRole('button', { name: 'Preview audience' }));
    expect(await within(dialog).findByText('12 recipients and 24 deliveries.')).toBeInTheDocument();
    expect(save).toBeEnabled();

    await user.click(save);
    await waitFor(() => expect(create).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ body: 'Exact organizer prose.' }),
      expect.any(String),
    ));
  });

  it('loads append-only status history without recipient detail', async () => {
    const user = userEvent.setup();
    vi.spyOn(eventCommunicationsApi, 'get').mockResolvedValue({ success: true, data: detailFixture() });
    renderEventComponent(<EventCommunicationsWorkspace eventId={42} />);

    await user.click(await screen.findByRole('button', { name: 'View history' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByText('Draft created')).toBeInTheDocument();
    expect(within(dialog).getByText('Draft')).toBeInTheDocument();
    expect(within(dialog).queryByText('Exact organizer prose.')).not.toBeInTheDocument();
  });

  it('loads every bounded page of an individual communication history', async () => {
    const user = userEvent.setup();
    const first = detailFixture();
    first.history_meta = {
      current_page: 1,
      per_page: 50,
      total: 51,
      total_pages: 2,
      has_more: true,
    };
    const second = detailFixture();
    second.history = [{
      id: 51,
      version: 51,
      action: 'revised',
      from_status: 'draft',
      to_status: 'draft',
      metadata: {},
      created_at: '2026-07-12T10:00:00+00:00',
    }];
    second.history_meta = {
      current_page: 2,
      per_page: 50,
      total: 51,
      total_pages: 2,
      has_more: false,
    };
    const get = vi.spyOn(eventCommunicationsApi, 'get')
      .mockResolvedValueOnce({ success: true, data: first })
      .mockResolvedValueOnce({ success: true, data: second });
    renderEventComponent(<EventCommunicationsWorkspace eventId={42} />);

    await user.click(await screen.findByRole('button', { name: 'View history' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Load more history' }));

    await waitFor(() => expect(get).toHaveBeenLastCalledWith(8, 2, 50));
    expect(within(dialog).getByText('Draft revised')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Load more history' })).not.toBeInTheDocument();
  });

  it('pages through the complete communication ledger', async () => {
    const user = userEvent.setup();
    const list = vi.spyOn(eventCommunicationsApi, 'list')
      .mockResolvedValueOnce({
        success: true,
        data: [broadcastFixture()],
        meta: { current_page: 1, per_page: 20, total: 21, total_pages: 2, has_more: true },
      })
      .mockResolvedValueOnce({
        success: true,
        data: [broadcastFixture({ id: 9, audience: { segments: ['registration_confirmed'], recipient_count: 2 } })],
        meta: { current_page: 2, per_page: 20, total: 21, total_pages: 2, has_more: false },
      });
    renderEventComponent(<EventCommunicationsWorkspace eventId={42} />);

    await user.click(await screen.findByText('2'));

    await waitFor(() => expect(list).toHaveBeenLastCalledWith(42, 2));
    expect(await screen.findByText('2 recipients')).toBeInTheDocument();
  });

  it("shows the server's explanation when scheduling is refused (E-102)", async () => {
    const user = userEvent.setup();
    const explanation = 'Nobody would receive this message. Choose an audience that includes at least one person.';
    vi.spyOn(eventCommunicationsApi, 'schedule').mockResolvedValue({
      success: false,
      code: 'EVENT_BROADCAST_VALIDATION_FAILED',
      errors: [{
        code: 'EVENT_BROADCAST_VALIDATION_FAILED',
        message: explanation,
        field: 'segments',
        reason: 'event_broadcast_audience_empty',
      }],
    });
    renderEventComponent(<EventCommunicationsWorkspace eventId={42} eventTitle="Community summit" />);

    await user.click(await screen.findByRole('button', { name: 'Schedule' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'confirm_schedule' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(explanation));
  });

  it('keeps its own wording when a scheduling refusal carries no explanation', async () => {
    const user = userEvent.setup();
    vi.spyOn(eventCommunicationsApi, 'schedule').mockResolvedValue({
      success: false,
      code: 'EVENT_BROADCAST_VALIDATION_FAILED',
      errors: [{ code: 'EVENT_BROADCAST_VALIDATION_FAILED', message: 'Validation failed', field: 'variant' }],
    });
    renderEventComponent(<EventCommunicationsWorkspace eventId={42} eventTitle="Community summit" />);

    await user.click(await screen.findByRole('button', { name: 'Schedule' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'confirm_schedule' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('schedule_error'));
  });
});
