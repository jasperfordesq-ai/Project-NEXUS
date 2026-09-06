// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetTemplates = jest.fn();
const mockGetHistory = jest.fn();
const mockPreview = jest.fn();
const mockMaterialize = jest.fn();
const mockReplace = jest.fn();
const mockShowToast = jest.fn();

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: {
    canGoBack: () => true,
    back: jest.fn(),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
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
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ text: '#111111', textMuted: '#777777' }),
}));
jest.mock('react-i18next', () => {
  const labels: Record<string, string> = {
    'templates.mobile.safetyTitle': 'Templates copy configuration only',
    'templates.mobile.useTemplate': 'Use template',
    'templates.mobile.auditButton': 'Audit history',
    'templates.mobile.auditTitle': 'Audit: {{title}}',
    'templates.mobile.auditDescription': 'Append-only operational history.',
    'templates.mobile.auditImmutableTitle': 'History cannot be changed',
    'templates.mobile.auditImmutableDescription': 'Every template lifecycle record is retained.',
    'templates.mobile.auditLoading': 'Loading template audit history',
    'templates.mobile.auditLoadFailedTitle': 'Audit history unavailable',
    'templates.mobile.auditLoadFailedDescription': 'Try again.',
    'templates.mobile.auditEmpty': 'No audit entries.',
    'templates.mobile.auditEntry': 'Version {{version}} on {{date}}',
    'templates.mobile.auditMaterializedEvent': 'Created event #{{id}}',
    'templates.mobile.notRecorded': 'Not recorded',
    'templates.mobile.auditActions.materialized': 'Draft materialized',
    'templates.mobile.auditActions.revised': 'Template revised',
    'templates.mobile.scheduleTitle': 'Schedule draft',
    'templates.mobile.eventTitle': 'Event title',
    'templates.mobile.start': 'Start',
    'templates.mobile.end': 'End',
    'templates.mobile.review': 'Review draft',
    'templates.mobile.readyTitle': 'Ready to create a draft',
    'templates.mobile.createDraft': 'Create draft',
    'templates.mobile.validationTitle': 'Check the schedule',
    'templates.mobile.validationDescription': 'Enter a title, time zone and valid future schedule.',
    'templates.mobile.validationDateFormat': 'Enter the start and end as YYYY-MM-DDTHH:mm.',
    'common:buttons.loadMore': 'Load more',
    'common:buttons.done': 'Done',
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
jest.mock('@/lib/api/eventTemplates', () => ({
  getEventTemplates: (...args: unknown[]) => mockGetTemplates(...args),
  getEventTemplateHistory: (...args: unknown[]) => mockGetHistory(...args),
  previewEventTemplate: (...args: unknown[]) => mockPreview(...args),
  materializeEventTemplate: (...args: unknown[]) => mockMaterialize(...args),
}));

import EventTemplatesScreen from './event-templates';

const template = {
  id: 4,
  status: 'active',
  current_version: 1,
  source_event: { id: 9, title: 'Source event' },
  version: {
    number: 1,
    configuration: {
      title: 'Reusable event',
      description: 'Reusable description',
      location: 'Community hall',
      max_attendees: 30,
      timezone: 'UTC',
      all_day: false,
      is_online: false,
      allow_remote_attendance: false,
    },
    snapshot: { immutable: true },
    copied_fields: ['title'],
    skipped_fields: ['related.registrations'],
  },
  usage: { materialization_count: 2, audit_entry_count: 3 },
  capabilities: { materialize: true, view_audit: true },
};

const secondTemplate = {
  ...template,
  id: 5,
  source_event: { id: 10, title: 'Second source event' },
  version: {
    ...template.version,
    configuration: { ...template.version.configuration, title: 'Second reusable event' },
  },
};

function auditEntry(id: number, materializedEventId: number) {
  return {
    id,
    action: 'materialized',
    template_version: 1,
    source_event_id: 9,
    materialized_event_id: materializedEventId,
    evidence: {},
    created_at: '2026-07-11T10:00:00+00:00',
    immutable: true,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetTemplates.mockResolvedValue({
    data: [template],
    meta: { per_page: 20, next_cursor: null, has_more: false },
  });
  mockPreview.mockResolvedValue({
    kind: 'materialization',
    template_id: 4,
    template_version: 1,
    configuration: { ...template.version.configuration, title: 'Fresh mobile draft' },
    schedule: {
      start_at: '2030-08-01T10:00:00Z',
      end_at: '2030-08-01T12:00:00Z',
      timezone: 'UTC',
      all_day: false,
    },
    override_fields: ['title'],
    checklist: [{ code: 'event_template_check_federation_none', passed: true }],
    will_create: {
      publication_status: 'draft',
      publish: false,
      submit_for_review: false,
      register: false,
      notify: false,
      federate: false,
    },
  });
  mockMaterialize.mockResolvedValue({
    created_event: {
      id: 21,
      title: 'Fresh mobile draft',
      publication_status: 'draft',
      operational_status: 'scheduled',
    },
    workflow: {
      fresh_draft: true,
      published: false,
      registrations_copied: false,
      notifications_sent: false,
      federated: false,
    },
    changed: true,
    idempotent_replay: false,
  });
  mockGetHistory.mockResolvedValue({
    data: [{
      id: 18,
      action: 'materialized',
      template_version: 1,
      source_event_id: 9,
      materialized_event_id: 21,
      evidence: { federation_normalized: true },
      created_at: '2026-07-11T10:00:00+00:00',
      immutable: true,
    }],
    meta: { per_page: 50, next_cursor: null, has_more: false },
  });
});

describe('EventTemplatesScreen', () => {
  it('keeps mobile bounded to selecting a template and creating a reviewed draft', async () => {
    const screen = render(<EventTemplatesScreen />);

    expect(await screen.findByText('Reusable event')).toBeTruthy();
    expect(screen.getByText('Templates copy configuration only')).toBeTruthy();
    fireEvent.press(screen.getByText('Use template'));

    fireEvent.changeText(screen.getByDisplayValue('Reusable event'), 'Fresh mobile draft');
    fireEvent.changeText(screen.getByTestId('event-template-start'), '2030-08-01T10:00');
    fireEvent.changeText(screen.getByTestId('event-template-end'), '2030-08-01T12:00');
    fireEvent.press(screen.getByText('Review draft'));

    expect(await screen.findByText('Ready to create a draft')).toBeTruthy();
    expect(mockMaterialize).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('Create draft'));

    await waitFor(() => {
      expect(mockMaterialize).toHaveBeenCalledWith(
        4,
        expect.objectContaining({
          template_version: 1,
          start_time: '2030-08-01T10:00',
          end_time: '2030-08-01T12:00',
          overrides: { title: 'Fresh mobile draft' },
        }),
        expect.any(String),
      );
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/(modals)/edit-event',
        params: { id: '21' },
      });
    });
  });
  /**
   * 🔴 S4-12. The suggested start was built from `toISOString()` — UTC — and then labelled
   * with the template's zone, so it read an hour (or more) off. It must be tomorrow on the
   * hour IN THAT ZONE.
   */
  it('proposes the default start in the template time zone, not UTC', async () => {
    const { eventIsoToLocalInput } = jest.requireActual('@/lib/utils/eventDateTime');
    const now = new Date('2030-07-31T22:30:00Z').getTime();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    mockGetTemplates.mockResolvedValue({
      data: [{ ...template, version: { ...template.version, configuration: { ...template.version.configuration, timezone: 'Pacific/Auckland' } } }],
      meta: { per_page: 20, next_cursor: null, has_more: false },
    });

    const screen = render(<EventTemplatesScreen />);
    await screen.findByText('Reusable event');
    fireEvent.press(screen.getByText('Use template'));

    const expected = `${eventIsoToLocalInput(new Date(now + 24 * 60 * 60 * 1000).toISOString(), 'Pacific/Auckland').slice(0, 13)}:00`;
    expect(expected).toBe('2030-08-02T10:00'); // 22:30Z + 24h is 10:30 the day after in Auckland (UTC+12)
    expect(screen.getByTestId('event-template-start').props.value).toBe(expected);
    nowSpy.mockRestore();
  });

  /** S4-25. A mistyped start is a format problem, not a missing field. */
  it('reports a mistyped start as an invalid format', async () => {
    const screen = render(<EventTemplatesScreen />);
    await screen.findByText('Reusable event');
    fireEvent.press(screen.getByText('Use template'));
    fireEvent.changeText(screen.getByTestId('event-template-start'), 'tomorrow 10am');
    fireEvent.press(screen.getByText('Review draft'));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Enter the start and end as YYYY-MM-DDTHH:mm.',
    })));
    expect(mockPreview).not.toHaveBeenCalled();
  });

  /** S4-23. The label stays beside the spinner while the preview is pending. */
  it('keeps the review label visible while the preview request is pending', async () => {
    const pending = deferred<unknown>();
    mockPreview.mockReturnValueOnce(pending.promise);
    const screen = render(<EventTemplatesScreen />);
    await screen.findByText('Reusable event');
    fireEvent.press(screen.getByText('Use template'));
    fireEvent.changeText(screen.getByTestId('event-template-start'), '2030-08-01T10:00');
    fireEvent.press(screen.getByText('Review draft'));

    await waitFor(() => expect(mockPreview).toHaveBeenCalled());
    expect(screen.getByText('Review draft')).toBeTruthy();
    await act(async () => { pending.resolve({ configuration: { title: 'x' }, checklist: [] }); });
  });

  it('loads every cursor page in the template library', async () => {
    mockGetTemplates
      .mockResolvedValueOnce({
        data: [template],
        meta: { per_page: 20, next_cursor: 'template-cursor-4', has_more: true },
      })
      .mockResolvedValueOnce({
        data: [{
          ...template,
          id: 5,
          source_event: { id: 10, title: 'Second source event' },
          version: {
            ...template.version,
            configuration: { ...template.version.configuration, title: 'Second reusable event' },
          },
        }],
        meta: { per_page: 20, next_cursor: null, has_more: false },
      });
    const screen = render(<EventTemplatesScreen />);

    await screen.findByText('Load more');
    fireEvent.press(screen.getByText('Load more'));

    await waitFor(() => expect(mockGetTemplates).toHaveBeenLastCalledWith('template-cursor-4'));
    expect(await screen.findByText('Second reusable event')).toBeTruthy();
  });

  it('shows privacy-filtered immutable template audit history', async () => {
    const screen = render(<EventTemplatesScreen />);
    await screen.findByText('Reusable event');

    fireEvent.press(screen.getByText('Audit history'));

    expect(await screen.findByText('Audit: Reusable event')).toBeTruthy();
    expect(screen.getByText('History cannot be changed')).toBeTruthy();
    expect(screen.getByText('Draft materialized')).toBeTruthy();
    expect(screen.getByText('Created event #21')).toBeTruthy();
    expect(mockGetHistory).toHaveBeenCalledWith(4);
  });

  it('loads every opaque cursor page in template audit history', async () => {
    mockGetHistory
      .mockResolvedValueOnce({
        data: [{
          id: 18,
          action: 'materialized',
          template_version: 1,
          source_event_id: 9,
          materialized_event_id: 21,
          evidence: {},
          created_at: '2026-07-11T10:00:00+00:00',
          immutable: true,
        }],
        meta: { per_page: 50, next_cursor: 'audit-cursor-18', has_more: true },
      })
      .mockResolvedValueOnce({
        data: [{
          id: 17,
          action: 'revised',
          template_version: 1,
          source_event_id: 9,
          materialized_event_id: null,
          evidence: {},
          created_at: '2026-07-10T10:00:00+00:00',
          immutable: true,
        }],
        meta: { per_page: 50, next_cursor: null, has_more: false },
      });
    const screen = render(<EventTemplatesScreen />);
    await screen.findByText('Reusable event');

    fireEvent.press(screen.getByText('Audit history'));
    await screen.findByText('Draft materialized');
    fireEvent.press(screen.getByText('Load more'));

    await waitFor(() => expect(mockGetHistory).toHaveBeenLastCalledWith(4, 'audit-cursor-18'));
    expect(await screen.findByText('Template revised')).toBeTruthy();
  });

  it('ignores an older template audit response after another template is opened', async () => {
    const first = deferred<{
      data: ReturnType<typeof auditEntry>[];
      meta: { per_page: number; next_cursor: null; has_more: false };
    }>();
    const second = deferred<{
      data: ReturnType<typeof auditEntry>[];
      meta: { per_page: number; next_cursor: null; has_more: false };
    }>();
    mockGetTemplates.mockResolvedValue({
      data: [template, secondTemplate],
      meta: { per_page: 20, next_cursor: null, has_more: false },
    });
    mockGetHistory.mockReset()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const screen = render(<EventTemplatesScreen />);
    await screen.findByText('Second reusable event');

    fireEvent.press(screen.getByTestId('event-template-audit-button-4'));
    expect(await screen.findByText('Audit: Reusable event')).toBeTruthy();
    fireEvent.press(screen.getByTestId('event-template-audit-button-5'));
    expect(await screen.findByText('Audit: Second reusable event')).toBeTruthy();

    await act(async () => {
      second.resolve({
        data: [auditEntry(28, 202)],
        meta: { per_page: 50, next_cursor: null, has_more: false },
      });
    });
    expect(await screen.findByText('Created event #202')).toBeTruthy();

    await act(async () => {
      first.resolve({
        data: [auditEntry(18, 101)],
        meta: { per_page: 50, next_cursor: null, has_more: false },
      });
    });
    await waitFor(() => {
      expect(screen.queryByText('Created event #101')).toBeNull();
      expect(screen.getByText('Created event #202')).toBeTruthy();
    });
  });

  it('does not append a prior template load-more response after switching audits', async () => {
    const olderPage = deferred<{
      data: ReturnType<typeof auditEntry>[];
      meta: { per_page: number; next_cursor: null; has_more: false };
    }>();
    mockGetTemplates.mockResolvedValue({
      data: [template, secondTemplate],
      meta: { per_page: 20, next_cursor: null, has_more: false },
    });
    mockGetHistory.mockReset()
      .mockResolvedValueOnce({
        data: [auditEntry(18, 101)],
        meta: { per_page: 50, next_cursor: 'older-audit-page', has_more: true },
      })
      .mockReturnValueOnce(olderPage.promise)
      .mockResolvedValueOnce({
        data: [auditEntry(28, 202)],
        meta: { per_page: 50, next_cursor: null, has_more: false },
      });
    const screen = render(<EventTemplatesScreen />);
    await screen.findByText('Second reusable event');

    fireEvent.press(screen.getByTestId('event-template-audit-button-4'));
    await screen.findByText('Created event #101');
    fireEvent.press(screen.getByText('Load more'));
    await waitFor(() => expect(mockGetHistory).toHaveBeenCalledWith(4, 'older-audit-page'));
    fireEvent.press(screen.getByTestId('event-template-audit-button-5'));
    expect(await screen.findByText('Created event #202')).toBeTruthy();

    await act(async () => {
      olderPage.resolve({
        data: [auditEntry(17, 303)],
        meta: { per_page: 50, next_cursor: null, has_more: false },
      });
    });
    await waitFor(() => {
      expect(screen.queryByText('Created event #303')).toBeNull();
      expect(screen.getByText('Created event #202')).toBeTruthy();
    });
  });

  it('invalidates an audit request when the history panel is closed', async () => {
    const pending = deferred<{
      data: ReturnType<typeof auditEntry>[];
      meta: { per_page: number; next_cursor: null; has_more: false };
    }>();
    mockGetHistory.mockReset().mockReturnValue(pending.promise);
    const screen = render(<EventTemplatesScreen />);
    await screen.findByText('Reusable event');

    fireEvent.press(screen.getByText('Audit history'));
    expect(await screen.findByText('Audit: Reusable event')).toBeTruthy();
    fireEvent.press(screen.getByText('Done'));
    expect(screen.queryByText('Audit: Reusable event')).toBeNull();

    await act(async () => {
      pending.resolve({
        data: [auditEntry(18, 101)],
        meta: { per_page: 50, next_cursor: null, has_more: false },
      });
    });
    await waitFor(() => {
      expect(screen.queryByText('Created event #101')).toBeNull();
      expect(screen.queryByText('Audit: Reusable event')).toBeNull();
    });
  });
});
