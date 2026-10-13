// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
} from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventReminderPanel } from './EventReminderPanel';

const { deleteMock, readMock, tMock, updateMock } = vi.hoisted(() => ({
  deleteMock: vi.fn(),
  readMock: vi.fn(),
  tMock: vi.fn((key: string) => key),
  updateMock: vi.fn(),
}));

vi.mock('@/lib/events-api', () => ({
  eventsApi: {
    reminders: readMock,
    updateReminders: updateMock,
    deleteReminders: deleteMock,
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tMock }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    onPress,
    isDisabled,
    isLoading,
    startContent,
    variant: _variant,
    ...props
  }: {
    children?: ReactNode;
    onPress?: () => void;
    isDisabled?: boolean;
    isLoading?: boolean;
    startContent?: ReactNode;
    variant?: string;
  } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) => (
    <button type="button" onClick={onPress} disabled={isDisabled || isLoading} {...props}>
      {startContent}{children}
    </button>
  ),
}));

vi.mock('@/components/ui/Card', () => ({
  Card: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
  CardBody: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/Checkbox', () => ({
  Checkbox: ({
    children,
    isSelected,
    onValueChange,
    ...props
  }: {
    children?: ReactNode;
    isSelected?: boolean;
    onValueChange?: (selected: boolean) => void;
  } & LabelHTMLAttributes<HTMLLabelElement>) => (
    <label {...props}>
      <input
        type="checkbox"
        checked={isSelected}
        onChange={(event) => onValueChange?.(event.currentTarget.checked)}
      />
      {children}
    </label>
  ),
}));

vi.mock('@/components/ui/Input', () => ({
  Input: ({
    label,
    value,
    onValueChange,
    ...props
  }: {
    label?: ReactNode;
    value?: string;
    onValueChange?: (value: string) => void;
  } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) => (
    <label>
      {label}
      <input value={value} onChange={(event) => onValueChange?.(event.currentTarget.value)} {...props} />
    </label>
  ),
}));

vi.mock('@/components/ui/Switch', () => ({
  Switch: ({
    children,
    isSelected,
    isDisabled,
    onValueChange,
    ...props
  }: {
    children?: ReactNode;
    isSelected?: boolean;
    isDisabled?: boolean;
    onValueChange?: (selected: boolean) => void;
    'aria-label'?: string;
  }) => (
    <label>
      <input
        type="checkbox"
        checked={isSelected}
        disabled={isDisabled}
        onChange={(event) => onValueChange?.(event.currentTarget.checked)}
        {...props}
      />
      {children}
    </label>
  ),
}));

function preferences(revision = 4) {
  return {
    revision,
    overrides: {
      email_enabled: true,
      in_app_enabled: true,
      web_push_enabled: false,
      fcm_enabled: true,
      realtime_enabled: true,
      cadence: 'instant' as const,
      reminders_enabled: true,
    },
    rules: [{
      id: 8,
      offset_minutes: 60,
      enabled: true,
      rule_version: 2,
      email_enabled: null,
      in_app_enabled: null,
      web_push_enabled: null,
      fcm_enabled: null,
      realtime_enabled: null,
    }],
    resolved: {
      channels: { email: true, in_app: true, web_push: false, fcm: true, realtime: true },
      channel_sources: { email: 'event' },
      cadence: 'instant' as const,
      cadence_source: 'event',
      reminders_enabled: true,
      reminders_source: 'event',
    },
    limits: {
      minimum_offset_minutes: 5,
      maximum_offset_minutes: 525_600,
      maximum_rules: 10,
      default_offsets_minutes: [10_080, 1_440, 60],
    },
    capabilities: { independent_channels: true, diagnostics_supported: false },
  };
}

describe('EventReminderPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readMock.mockResolvedValue({ success: true, data: preferences() });
    updateMock.mockResolvedValue({ success: true, data: preferences(5) });
    deleteMock.mockResolvedValue({ success: true, data: preferences(0) });
  });

  // E-104: with reminders switched off for the community the server answers
  // 403; the attendee must not see a reminder switch plus a red error.
  it('renders nothing when the community has switched reminders off', async () => {
    readMock.mockResolvedValue({ success: false, code: 'FORBIDDEN' });

    const { container } = render(<EventReminderPanel eventId={7} />);

    await waitFor(() => {
      expect(readMock).toHaveBeenCalledWith(7);
    });
    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('saves bounded rules and independent channels against the loaded revision', async () => {
    render(<EventReminderPanel eventId={101} />);

    await screen.findByText('reminders.title');
    fireEvent.click(await screen.findByText('reminders.offset_1440'));
    fireEvent.click(await screen.findByText('reminders.channel_web_push'));
    fireEvent.click(screen.getByRole('button', { name: 'reminders.save' }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock).toHaveBeenCalledWith(101, expect.objectContaining({
      expected_revision: 4,
      overrides: expect.objectContaining({
        cadence: 'instant',
        reminders_enabled: true,
        web_push_enabled: true,
      }),
      rules: expect.arrayContaining([
        expect.objectContaining({ offset_minutes: 60, enabled: true }),
        expect.objectContaining({ offset_minutes: 1_440, enabled: true }),
      ]),
    }));
  });

  it('refreshes the aggregate after an optimistic-concurrency conflict', async () => {
    readMock
      .mockResolvedValueOnce({ success: true, data: preferences(4) })
      .mockResolvedValueOnce({ success: true, data: preferences(9) });
    updateMock.mockResolvedValue({ success: false, code: 'VERSION_CONFLICT' });

    render(<EventReminderPanel eventId={101} />);
    await screen.findByText('reminders.title');
    fireEvent.click(screen.getByRole('button', { name: 'reminders.save' }));

    await screen.findByText('reminders.conflict_refreshed');
    expect(readMock).toHaveBeenCalledTimes(2);
  });

  it('resets with the current revision', async () => {
    render(<EventReminderPanel eventId={101} />);
    await screen.findByText('reminders.title');
    fireEvent.click(screen.getByRole('button', { name: 'reminders.reset' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith(101, 4));
  });
});
