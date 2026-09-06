// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGet = jest.fn();
const mockGetDetail = jest.fn();
const mockPreview = jest.fn();
const mockCreate = jest.fn();
const mockRevise = jest.fn();
const mockSchedule = jest.fn();
const mockCancel = jest.fn();
const mockRetry = jest.fn();
const mockShowToast = jest.fn();

const mockConfirm = jest.fn();
const mockNavListeners: Record<string, (e: unknown) => void> = {};
const mockNavDispatch = jest.fn();
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({ confirm: (...args: unknown[]) => mockConfirm(...args), confirmDialog: null }),
}));
jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useNavigation: () => ({
    addListener: (event: string, handler: (e: unknown) => void) => {
      mockNavListeners[event] = handler;
      return () => { delete mockNavListeners[event]; };
    },
    dispatch: (...args: unknown[]) => mockNavDispatch(...args),
  }),
  useLocalSearchParams: () => ({ id: '42' }),
  router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn() },
}));
jest.mock('@/components/ui/AppTopBar', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ title }: { title: string }) => <Text>{title}</Text>;
});
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppToast', () => ({
  useAppToast: () => ({ show: mockShowToast }),
}));
jest.mock('@/lib/api/eventCommunications', () => ({
  getEventCommunications: (...args: unknown[]) => mockGet(...args),
  getEventCommunicationDetail: (...args: unknown[]) => mockGetDetail(...args),
  previewEventCommunication: (...args: unknown[]) => mockPreview(...args),
  createEventCommunication: (...args: unknown[]) => mockCreate(...args),
  reviseEventCommunication: (...args: unknown[]) => mockRevise(...args),
  scheduleEventCommunication: (...args: unknown[]) => mockSchedule(...args),
  cancelEventCommunication: (...args: unknown[]) => mockCancel(...args),
  retryEventCommunication: (...args: unknown[]) => mockRetry(...args),
}));
jest.mock('react-i18next', () => {
  const labels: Record<string, string> = {
    title: 'Organizer communications',
    privacy_title: 'Audience privacy is protected',
    privacy_description: 'Only aggregate delivery totals are shown.',
    new_message: 'New message',
    compose_title: 'Compose message',
    compose_description: 'Write a message for an exact audience.',
    compose_edit_title: 'Revise draft',
    compose_edit_description: 'Review the current draft before saving a new version.',
    variant_label: 'Message type',
    segments_label: 'Audience segments',
    segments_description: 'Canonical event audiences.',
    channels_label: 'Delivery channels',
    body_label: 'Message',
    preview_button: 'Preview audience',
    save_draft_button: 'Save draft',
    revise_draft_button: 'Save changes',
    preview_title: 'Exact audience preview',
    preview_summary: '{{recipients}} recipients, {{deliveries}} deliveries',
    schedule_title: 'Schedule message',
    schedule_description: 'Leave blank to send now.',
    schedule_label: 'Date and time',
    schedule_placeholder: '2030-08-01T10:00',
    confirm_schedule: 'Confirm schedule',
    cancel_title: 'Cancel message',
    cancel_description: 'Cancellation is available only before delivery starts.',
    cancel_reason_label: 'Cancellation reason',
    confirm_cancel: 'Confirm cancellation',
    status_title: 'Message status',
    loading: 'Loading communications',
    empty_title: 'No messages',
    empty_description: 'Create a message draft.',
    schedule_button: 'Schedule',
    cancel_button: 'Cancel',
    retry_button: 'Retry',
    history_button: 'Audit history',
    history_title: '{{type}} audit history',
    history_description: 'Append-only lifecycle evidence.',
    history_immutable_title: 'History cannot be changed',
    history_immutable_description: 'Every lifecycle transition remains available.',
    history_loading: 'Loading audit history',
    history_load_failed_title: 'Audit history unavailable',
    history_load_failed_description: 'Try again.',
    history_empty: 'No history entries.',
    history_entry_version: 'Version {{version}} on {{date}}',
    history_transition: '{{from}} to {{to}}',
    history_initial_status: 'Initial status: {{status}}',
    'history_actions.created': 'Draft created',
    'history_actions.revised': 'Draft revised',
    not_recorded: 'Not recorded',
    version: 'Version {{version}}',
    audience_summary: '{{count}} recipients across {{segments}}',
    channels_summary: 'Channels: {{channels}}',
    delivery_summary: '{{delivered}} of {{total}} delivered; {{suppressed}} suppressed; {{dead}} dead-lettered',
    scheduled_for: 'Scheduled: {{date}}',
    'variants.announcement': 'Announcement',
    'variants.follow_up': 'Post-event follow-up',
    'variants.review_request': 'Review request',
    'statuses.draft': 'Draft',
    'statuses.scheduled': 'Scheduled',
    'segments.registration_confirmed': 'Confirmed registrations',
    'segments.waitlist_active': 'Active waitlist',
    'segments.attendance_attended': 'Attended',
    'segments.attendance_no_show': 'Did not attend',
    'channels.email': 'Email',
    'channels.in_app': 'In-app notification',
    'channels.push': 'Push notification',
    'common:buttons.loadMore': 'Load more',
    'common:buttons.edit': 'Edit',
    'common:buttons.done': 'Done',
    unsaved_title: 'Discard this message?',
    unsaved_message: 'You have unsaved wording.',
    discard: 'Discard',
    schedule_invalid_title: 'Check the schedule',
    schedule_invalid_description: 'Enter a valid local date and time.',
  };
  return {
    useTranslation: () => ({
      t: (key: string, values?: Record<string, unknown>) => {
        let value = labels[key] ?? key;
        Object.entries(values ?? {}).forEach(([name, replacement]) => {
          value = value.replace(`{{${name}}}`, String(replacement));
        });
        return value;
      },
      i18n: { language: 'en' },
    }),
  };
});

import EventCommunicationsScreen from './event-communications';

function broadcast(overrides: Record<string, unknown> = {}) {
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

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(mockNavListeners).forEach((key) => { delete mockNavListeners[key]; });
  mockGet.mockResolvedValue({
    data: [broadcast()],
    meta: { base_url: '', current_page: 1, per_page: 50, total: 1, total_pages: 1, has_more: false },
  });
  mockPreview.mockResolvedValue({
    contract_version: 1,
    event_id: 42,
    variant: 'announcement',
    segments: ['registration_confirmed'],
    channels: ['email', 'in_app'],
    recipient_count: 12,
    delivery_count: 24,
    segment_counts: { registration_confirmed: 12 },
    generated_at: '2026-07-11T10:00:00+00:00',
  });
  mockCreate.mockResolvedValue(broadcast({ body: '  Exact organizer prose.\n  ' }));
  mockGetDetail.mockResolvedValue({
    broadcast: broadcast({ body: 'Original draft body' }),
    history: [{
      id: 31,
      version: 1,
      action: 'created',
      from_status: null,
      to_status: 'draft',
      metadata: { recipient_count: 12 },
      created_at: '2026-07-11T10:00:00+00:00',
    }],
    history_meta: {
      current_page: 1,
      per_page: 50,
      total: 1,
      total_pages: 1,
      has_more: false,
    },
  });
  mockRevise.mockResolvedValue(broadcast({ body: 'Revised organizer prose.', version: 2 }));
  mockSchedule.mockResolvedValue(broadcast({
    status: 'scheduled',
    version: 2,
    capabilities: { edit: false, schedule: false, cancel: true, retry: false },
    scheduled_at: '2026-07-11T10:05:00+00:00',
  }));
  mockCancel.mockResolvedValue(broadcast({
    status: 'cancelled',
    version: 3,
    capabilities: { edit: false, schedule: false, cancel: false, retry: false },
  }));
});

describe('EventCommunicationsScreen', () => {
  it('shows aggregate status without participant identities', async () => {
    const screen = render(<EventCommunicationsScreen />);

    expect(await screen.findByText('Announcement')).toBeTruthy();
    expect(screen.getByText('Audience privacy is protected')).toBeTruthy();
    expect(screen.getByText('12 recipients across Confirmed registrations')).toBeTruthy();
    expect(screen.queryByText(/@/)).toBeNull();
  });

  it('requires an exact preview and preserves organizer wording when saving', async () => {
    const screen = render(<EventCommunicationsScreen />);
    await screen.findByText('Announcement');

    fireEvent.press(screen.getByText('New message'));
    fireEvent.changeText(screen.getByTestId('event-communication-body'), '  Exact organizer prose.\n  ');
    fireEvent.press(screen.getByText('Preview audience'));

    expect(await screen.findByText('12 recipients, 24 deliveries')).toBeTruthy();
    fireEvent.press(screen.getByText('Save draft'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ body: '  Exact organizer prose.\n  ' }),
      expect.any(String),
    ));
  });

  it('schedules immediately and cancels with optimistic versions', async () => {
    const screen = render(<EventCommunicationsScreen />);
    await screen.findByText('Announcement');

    fireEvent.press(screen.getByText('Schedule'));
    fireEvent.press(screen.getByText('Confirm schedule'));
    await waitFor(() => expect(mockSchedule).toHaveBeenCalledWith(8, 1, null, expect.any(String)));

    fireEvent.press(screen.getByText('Cancel'));
    fireEvent.changeText(screen.getByTestId('event-communication-cancel-reason'), 'Plan changed');
    fireEvent.press(screen.getByText('Confirm cancellation'));

    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith(8, 2, 'Plan changed', expect.any(String)));
  });

  /** 🔴 S4-04. The composer's Cancel (and Back) used to drop organiser wording silently. */
  it('asks before closing a composer that holds unsaved wording, and closes only on confirmation', async () => {
    const screen = render(<EventCommunicationsScreen />);
    await screen.findByText('Announcement');

    fireEvent.press(screen.getByText('New message'));
    // A pristine composer closes freely and no navigation guard is armed.
    expect(mockNavListeners.beforeRemove).toBeUndefined();
    fireEvent.changeText(screen.getByTestId('event-communication-body'), 'Half-written notice');
    expect(mockNavListeners.beforeRemove).toBeDefined();

    fireEvent.press(screen.getByText('common:buttons.cancel'));
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard this message?', variant: 'danger' }));
    // Still open, wording intact.
    expect(screen.getByDisplayValue('Half-written notice')).toBeTruthy();

    const options = mockConfirm.mock.calls[0][0] as { onConfirm: () => void };
    act(() => { options.onConfirm(); });
    expect(screen.queryByTestId('event-communication-body')).toBeNull();
  });

  /** S4-23. The label stays beside the spinner while a preview is in flight. */
  it('keeps the preview label visible while the preview request is pending', async () => {
    let resolvePreview: (value: unknown) => void = () => undefined;
    mockPreview.mockReturnValueOnce(new Promise((resolve) => { resolvePreview = resolve; }));
    const screen = render(<EventCommunicationsScreen />);
    await screen.findByText('Announcement');

    fireEvent.press(screen.getByText('New message'));
    fireEvent.changeText(screen.getByTestId('event-communication-body'), 'Notice');
    fireEvent.press(screen.getByText('Preview audience'));

    await waitFor(() => expect(mockPreview).toHaveBeenCalled());
    expect(screen.getByText('Preview audience')).toBeTruthy();
    await act(async () => { resolvePreview({ recipient_count: 12, delivery_count: 24 }); });
  });

  /** S4-25. The schedule field is a local wall-clock time; a mistyped one is refused, not sent as "now". */
  it('converts a typed local schedule to an instant and refuses one it cannot parse', async () => {
    const { eventLocalInputToIso, localEventTimeZone } = jest.requireActual('@/lib/utils/eventDateTime');
    const screen = render(<EventCommunicationsScreen />);
    await screen.findByText('Announcement');

    fireEvent.press(screen.getByText('Schedule'));
    fireEvent.changeText(screen.getByTestId('event-communication-scheduled-at'), 'tomorrow 10am');
    fireEvent.press(screen.getByText('Confirm schedule'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Check the schedule' })));
    expect(mockSchedule).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByTestId('event-communication-scheduled-at'), '2030-08-01T10:00');
    fireEvent.press(screen.getByText('Confirm schedule'));
    await waitFor(() => expect(mockSchedule).toHaveBeenCalledWith(
      8,
      1,
      eventLocalInputToIso('2030-08-01T10:00', localEventTimeZone()),
      expect.any(String),
    ));
  });

  it('loads the current draft and saves a revision with optimistic versioning', async () => {
    const screen = render(<EventCommunicationsScreen />);
    await screen.findByText('Announcement');

    fireEvent.press(screen.getByText('Edit'));
    const body = await screen.findByDisplayValue('Original draft body');
    fireEvent.changeText(body, 'Revised organizer prose.');
    fireEvent.press(screen.getByText('Preview audience'));
    await screen.findByText('12 recipients, 24 deliveries');
    fireEvent.press(screen.getByText('Save changes'));

    await waitFor(() => expect(mockRevise).toHaveBeenCalledWith(
      8,
      1,
      expect.objectContaining({ body: 'Revised organizer prose.' }),
      expect.any(String),
    ));
  });

  it('shows the privacy-filtered append-only communication audit ledger', async () => {
    const screen = render(<EventCommunicationsScreen />);
    await screen.findByText('Announcement');

    fireEvent.press(screen.getByText('Audit history'));

    expect(await screen.findByText('Announcement audit history')).toBeTruthy();
    expect(screen.getByText('History cannot be changed')).toBeTruthy();
    expect(screen.getByText('Draft created')).toBeTruthy();
    expect(screen.getByText('Initial status: Draft')).toBeTruthy();
    expect(mockGetDetail).toHaveBeenCalledWith(8, 1, 50);
    expect(screen.queryByText(/@/)).toBeNull();
  });

  it('loads every bounded page of an individual communication history', async () => {
    mockGetDetail
      .mockResolvedValueOnce({
        broadcast: broadcast({ body: 'Original draft body' }),
        history: [{
          id: 31,
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
          total: 51,
          total_pages: 2,
          has_more: true,
        },
      })
      .mockResolvedValueOnce({
        broadcast: broadcast({ body: 'Original draft body', version: 51 }),
        history: [{
          id: 81,
          version: 51,
          action: 'revised',
          from_status: 'draft',
          to_status: 'draft',
          metadata: {},
          created_at: '2026-07-12T10:00:00+00:00',
        }],
        history_meta: {
          current_page: 2,
          per_page: 50,
          total: 51,
          total_pages: 2,
          has_more: false,
        },
      });
    const screen = render(<EventCommunicationsScreen />);
    await screen.findByText('Announcement');

    fireEvent.press(screen.getByText('Audit history'));
    fireEvent.press(await screen.findByText('Load more'));

    await waitFor(() => expect(mockGetDetail).toHaveBeenLastCalledWith(8, 2, 50));
    expect(await screen.findByText('Draft revised')).toBeTruthy();
  });

  it('loads every page of the communication ledger', async () => {
    mockGet
      .mockResolvedValueOnce({
        data: [broadcast()],
        meta: { base_url: '', current_page: 1, per_page: 50, total: 51, total_pages: 2, has_more: true },
      })
      .mockResolvedValueOnce({
        data: [broadcast({ id: 9, audience: { segments: ['registration_confirmed'], recipient_count: 3 } })],
        meta: { base_url: '', current_page: 2, per_page: 50, total: 51, total_pages: 2, has_more: false },
      });
    const screen = render(<EventCommunicationsScreen />);

    await screen.findByText('Load more');
    fireEvent.press(screen.getByText('Load more'));

    await waitFor(() => expect(mockGet).toHaveBeenLastCalledWith(42, 2));
    expect(await screen.findByText('3 recipients across Confirmed registrations')).toBeTruthy();
  });
});
