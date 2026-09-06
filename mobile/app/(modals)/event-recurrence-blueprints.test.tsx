// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetEvent = jest.fn();
const mockGetCapabilities = jest.fn();
const mockGetHistory = jest.fn();
const mockPreview = jest.fn();
const mockCommit = jest.fn();
let mockEventId = '7';

jest.mock('@sentry/react-native', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));
jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => ({ id: mockEventId }),
  router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn() },
}));
jest.mock('@/components/ui/AppTopBar', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ title }: { title: string }) => <Text>{title}</Text>;
});
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ text: '#111111', textSecondary: '#555555', error: '#cc0000' }),
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#4f46e5' }));
jest.mock('@/lib/api/events', () => ({
  getEvent: (...args: unknown[]) => mockGetEvent(...args),
  getEventRecurrenceCapabilities: (...args: unknown[]) => mockGetCapabilities(...args),
  getEventRecurrenceDefinitionHistory: (...args: unknown[]) => mockGetHistory(...args),
  previewEventRecurrenceDefinitions: (...args: unknown[]) => mockPreview(...args),
  commitEventRecurrenceDefinitions: (...args: unknown[]) => mockCommit(...args),
}));
jest.mock('heroui-native', () => {
  const actual = jest.requireActual('heroui-native');
  const React = require('react');
  const { Text, View } = require('react-native');
  const Dialog: any = ({ isOpen, children }: { isOpen?: boolean; children: React.ReactNode }) => (
    isOpen ? <View>{children}</View> : null
  );
  Dialog.Portal = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Dialog.Overlay = () => <View />;
  Dialog.Content = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Dialog.Close = () => <View />;
  Dialog.Title = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  Dialog.Description = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  return { ...actual, Dialog };
});

import EventRecurrenceBlueprintsScreen from './event-recurrence-blueprints';

const capabilities = {
  contract_version: 1,
  engine: 'v2',
  structured_input: true,
  supported_frequencies: ['daily', 'weekly', 'monthly', 'yearly'],
  max_occurrences: 366,
  supported_end_types: ['after_count', 'on_date', 'never'],
  supports_rolling_never: true,
  supports_effective_revisions: true,
  supports_definition_blueprints: true,
  schema_ready: true,
  rollout_state: 'v2_rolling',
};

function event(
  id: number,
  recurrenceId: string,
  permissions: Partial<Record<string, boolean>> = {},
) {
  return {
    id,
    title: `Recurring event ${id}`,
    series: {
      recurrence: {
        parent_event_id: 1,
        root_event_id: 1,
        is_template: false,
        recurrence_id: recurrenceId,
        engine: 'sabre-vobject',
        engine_version: '2',
      },
    },
    permissions: {
      edit: true,
      manage_agenda: true,
      manage_finance: false,
      manage_registration: true,
      manage_staff: false,
      ...permissions,
    },
  };
}

const defaultSections = {
  agenda: true,
  ticket_types: false,
  registration: true,
  safety: true,
  staff: false,
};

function item(id: number, version: number) {
  return {
    blueprint_id: id,
    blueprint_version: version,
    schema_version: 1,
    effective_from_recurrence_id: '20300501T101500Z',
    source_event_id: 7,
    source_recurrence_id: '20300501T101500Z',
    selected_sections: defaultSections,
    counts: { sessions: version, registration_settings: 1 },
    manifest_hash: 'a'.repeat(64),
    captured_by_user_id: 42,
    created_at: '2030-04-01T08:00:00Z',
  };
}

function history(items: ReturnType<typeof item>[], next: number | null) {
  return { data: { items, next_before_version: next } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe('EventRecurrenceBlueprintsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEventId = '7';
    mockGetEvent.mockResolvedValue({ data: event(7, '20300501T101500Z') });
    mockGetCapabilities.mockResolvedValue({ data: capabilities });
    mockGetHistory.mockResolvedValue(history([], null));
  });

  it('loads immutable history with canonical before_version pagination and never renders private projection fields', async () => {
    mockGetHistory
      .mockResolvedValueOnce(history([item(3, 3), item(2, 2)], 2))
      .mockResolvedValueOnce(history([item(2, 2), item(1, 1)], null));

    const screen = render(<EventRecurrenceBlueprintsScreen />);
    expect(await screen.findByText('Version 3')).toBeTruthy();
    fireEvent.press(screen.getByText('Load more versions'));

    expect(await screen.findByText('Version 1')).toBeTruthy();
    expect(screen.getAllByText('Immutable')).toHaveLength(3);
    expect(mockGetHistory).toHaveBeenNthCalledWith(2, 7, 2);
    expect(screen.queryByText('42')).toBeNull();
    expect(screen.queryByText('a'.repeat(64))).toBeNull();
  });

  it('requires preview and explicit acknowledgement, and reuses one idempotency key across a safe retry', async () => {
    const preview = {
      preview_token: 'signed-preview-token',
      preview_expires_at: '2099-04-01T08:05:00Z',
      schema_version: 1,
      root_event_id: 1,
      source_event_id: 7,
      source_recurrence_id: '20300501T101500Z',
      effective_from_recurrence_id: '20300501T101500Z',
      selected_sections: defaultSections,
      manifest_hash: 'b'.repeat(64),
      blueprint_set_version: 0,
      counts: { sessions: 2, registration_settings: 1 },
      conflicts: [],
      can_commit: true,
    };
    mockPreview.mockResolvedValue({ data: preview });
    mockCommit
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        data: {
          blueprint_id: 10,
          blueprint_version: 1,
          schema_version: 1,
          root_event_id: 1,
          source_event_id: 7,
          source_recurrence_id: '20300501T101500Z',
          effective_from_recurrence_id: '20300501T101500Z',
          selected_sections: defaultSections,
          manifest_hash: 'b'.repeat(64),
          counts: preview.counts,
          idempotent_replay: false,
          created_at: '2030-04-01T08:01:00Z',
        },
      });
    mockGetHistory
      .mockResolvedValueOnce(history([], null))
      .mockResolvedValueOnce(history([item(10, 1)], null));

    const screen = render(<EventRecurrenceBlueprintsScreen />);
    fireEvent.press(await screen.findByText('Preview future setup'));
    expect(await screen.findByTestId('event-recurrence-blueprint-preview')).toBeTruthy();
    expect(mockCommit).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('Review and confirm'));
    expect(await screen.findByText('Confirm future occurrence setup')).toBeTruthy();
    fireEvent.press(screen.getByText('I confirm this future-only definition version'));
    fireEvent.press(screen.getByText('Save immutable version'));
    await waitFor(() => expect(mockCommit).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Future setup could not be saved')).toBeTruthy();

    fireEvent.press(screen.getByText('Save immutable version'));
    expect(await screen.findByText('Future setup saved')).toBeTruthy();
    expect(mockCommit).toHaveBeenCalledTimes(2);
    const firstKey = mockCommit.mock.calls[0]![4];
    expect(firstKey).toEqual(expect.stringMatching(/^event-recurrence-definition-/));
    expect(mockCommit.mock.calls[1]![4]).toBe(firstKey);
    expect(mockCommit).toHaveBeenLastCalledWith(
      7,
      '20300501T101500Z',
      defaultSections,
      'signed-preview-token',
      firstKey,
    );
  });

  /**
   * 🔴 S4-17. After a successful commit the history refresh used to set `loadFailed`, which
   * swapped the whole screen — the "saved" confirmation included — for "could not load".
   */
  it('keeps the saved confirmation when only the history refresh fails, and offers an inline retry', async () => {
    mockPreview.mockResolvedValue({
      data: {
        preview_token: 'signed-preview-token',
        preview_expires_at: '2099-04-01T08:05:00Z',
        schema_version: 1,
        root_event_id: 1,
        source_event_id: 7,
        source_recurrence_id: '20300501T101500Z',
        effective_from_recurrence_id: '20300501T101500Z',
        selected_sections: defaultSections,
        manifest_hash: 'b'.repeat(64),
        blueprint_set_version: 0,
        counts: { sessions: 2 },
        conflicts: [],
        can_commit: true,
      },
    });
    mockCommit.mockResolvedValueOnce({
      data: {
        blueprint_id: 10, blueprint_version: 1, schema_version: 1, root_event_id: 1, source_event_id: 7,
        source_recurrence_id: '20300501T101500Z', effective_from_recurrence_id: '20300501T101500Z',
        selected_sections: defaultSections, manifest_hash: 'b'.repeat(64), counts: { sessions: 2 },
        idempotent_replay: false, created_at: '2030-04-01T08:01:00Z',
      },
    });
    mockGetHistory
      .mockResolvedValueOnce(history([], null))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(history([item(10, 1)], null));

    const screen = render(<EventRecurrenceBlueprintsScreen />);
    fireEvent.press(await screen.findByText('Preview future setup'));
    fireEvent.press(await screen.findByText('Review and confirm'));
    fireEvent.press(await screen.findByText('I confirm this future-only definition version'));
    fireEvent.press(screen.getByText('Save immutable version'));

    expect(await screen.findByText('Future setup saved')).toBeTruthy();
    expect(await screen.findByTestId('event-recurrence-history-refresh-failed')).toBeTruthy();
    expect(screen.queryByTestId('event-recurrence-blueprints-unavailable')).toBeNull();

    fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByTestId('event-recurrence-blueprint-history-10')).toBeTruthy();
    expect(screen.getByText('Future setup saved')).toBeTruthy();
    expect(mockGetHistory).toHaveBeenCalledTimes(3);
  });

  it('ignores a stale preview after source navigation and resets selections to current permissions', async () => {
    const stalePreview = deferred<{ data: Record<string, unknown> }>();
    mockPreview.mockReturnValueOnce(stalePreview.promise).mockResolvedValueOnce({
      data: {
        preview_token: 'current-preview',
        preview_expires_at: '2099-04-01T08:05:00Z',
        schema_version: 1,
        root_event_id: 2,
        source_event_id: 8,
        source_recurrence_id: '20300508T101500Z',
        effective_from_recurrence_id: '20300508T101500Z',
        selected_sections: {
          agenda: false,
          ticket_types: false,
          registration: false,
          safety: false,
          staff: true,
        },
        manifest_hash: 'c'.repeat(64),
        blueprint_set_version: 0,
        counts: { staff_assignments: 1 },
        conflicts: [],
        can_commit: true,
      },
    });

    const screen = render(<EventRecurrenceBlueprintsScreen />);
    fireEvent.press(await screen.findByText('Preview future setup'));
    expect(mockPreview).toHaveBeenCalledTimes(1);

    mockEventId = '8';
    mockGetEvent.mockResolvedValue({
      data: event(8, '20300508T101500Z', {
        edit: false,
        manage_agenda: false,
        manage_registration: false,
        manage_staff: true,
      }),
    });
    screen.rerender(<EventRecurrenceBlueprintsScreen />);
    expect(await screen.findByText('Recurring event 8')).toBeTruthy();

    await act(async () => stalePreview.resolve({ data: {
      preview_token: 'stale-preview',
      preview_expires_at: '2099-04-01T08:05:00Z',
    } }));
    expect(screen.queryByTestId('event-recurrence-blueprint-preview')).toBeNull();

    fireEvent.press(screen.getByText('Staff assignments'));
    fireEvent.press(screen.getByText('Preview future setup'));
    await waitFor(() => expect(mockPreview).toHaveBeenCalledTimes(2));
    expect(mockPreview).toHaveBeenLastCalledWith(8, '20300508T101500Z', {
      agenda: false,
      ticket_types: false,
      registration: false,
      safety: false,
      staff: true,
    });
  });

  it('fails closed when capability negotiation or the concrete V2 identity is unavailable', async () => {
    mockGetCapabilities.mockResolvedValue({
      data: { ...capabilities, supports_definition_blueprints: false },
    });
    const screen = render(<EventRecurrenceBlueprintsScreen />);

    expect(await screen.findByTestId('event-recurrence-blueprints-unavailable')).toBeTruthy();
    expect(mockGetHistory).not.toHaveBeenCalled();
    expect(screen.queryByText('Preview future setup')).toBeNull();
  });
});
