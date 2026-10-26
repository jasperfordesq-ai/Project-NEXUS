// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockReportMember = jest.fn();
const mockReportMessage = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts && 'name' in opts ? `${key}:${String(opts.name)}` : key),
  }),
}));

jest.mock('@/lib/api/client', () => ({
  ApiResponseError: class ApiResponseError extends Error {
    status: number;
    code?: string;
    field?: string;
    constructor(status: number, message: string, _errors?: unknown, code?: string, field?: string) {
      super(message);
      this.status = status;
      this.code = code;
      this.field = field;
      this.name = 'ApiResponseError';
    }
  },
}));

jest.mock('@/lib/api/memberReports', () => {
  const actual = jest.requireActual('@/lib/api/memberReports');
  return {
    ...actual,
    reportMember: (...args: unknown[]) => mockReportMember(...args),
    reportMessage: (...args: unknown[]) => mockReportMessage(...args),
  };
});

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ text: '#111', textSecondary: '#555', textMuted: '#777', surface: '#fff', border: '#ddd', borderSubtle: '#eee', error: '#c00', success: '#0a0' }),
}));
jest.mock('@/lib/hooks/useTenant', () => ({ usePrimaryColor: () => '#006FEE' }));

jest.mock('@/components/ui/BottomSheet', () => {
  const { Text, View } = require('react-native');
  return ({ visible, title, children }: { visible: boolean; title?: string; children: React.ReactNode }) => (
    visible ? <View testID="sheet"><Text>{title}</Text>{children}</View> : null
  );
});
jest.mock('@/components/ui/TextArea', () => {
  const { Text, TextInput, View } = require('react-native');
  return ({ label, error, ...props }: { label?: string; error?: string }) => (
    <View>
      <Text>{label}</Text>
      <TextInput testID="report-details" accessibilityLabel={label} {...props} />
      {error ? <Text>{error}</Text> : null}
    </View>
  );
});
jest.mock('@/components/ui/NativeButton', () => {
  const { Pressable, Text } = require('react-native');
  const Button = ({ children, onPress, isDisabled, testID, accessibilityLabel }: { children: React.ReactNode; onPress?: () => void; isDisabled?: boolean; testID?: string; accessibilityLabel?: string }) => (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled: !!isDisabled }} disabled={isDisabled} onPress={onPress}>{children}</Pressable>
  );
  Button.Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  return { Button };
});
jest.mock('@/components/ui/Icon', () => ({ Ionicons: () => null }));

import { ApiResponseError } from '@/lib/api/client';
import ReportMemberSheet from './ReportMemberSheet';

function renderSheet(target: { type: 'member' | 'message'; id: number } = { type: 'member', id: 42 }) {
  const onClose = jest.fn();
  render(<ReportMemberSheet visible target={target} subjectName="Bob" onClose={onClose} />);
  return { onClose };
}

describe('ReportMemberSheet', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('shows six reasons with their help, the privacy line and the emergency line', () => {
    renderSheet();
    expect(screen.getByText('memberReport.titleMember:Bob')).toBeTruthy();
    for (const reason of ['safeguarding_concern', 'harassment', 'inappropriate', 'scam_or_fraud', 'spam', 'other']) {
      expect(screen.getByText(`memberReport.reason.${reason}`)).toBeTruthy();
      expect(screen.getByText(`memberReport.help.${reason}`)).toBeTruthy();
      expect(screen.getByLabelText(`memberReport.reason.${reason}. memberReport.help.${reason}`)).toBeTruthy();
    }
    expect(screen.getByText('memberReport.privacy')).toBeTruthy();
    expect(screen.getByText('memberReport.emergency')).toBeTruthy();
  });

  it('does not send without a reason', () => {
    renderSheet();
    fireEvent.press(screen.getByTestId('report-member-submit'));
    expect(mockReportMember).not.toHaveBeenCalled();
    expect(screen.getByText('memberReport.chooseReason')).toBeTruthy();
  });

  it('marks the chosen reason as checked', () => {
    renderSheet();
    const option = screen.getByLabelText('memberReport.reason.harassment. memberReport.help.harassment');
    fireEvent.press(option);
    expect(screen.getByLabelText('memberReport.reason.harassment. memberReport.help.harassment').props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
  });

  it('requires details for "other"', () => {
    renderSheet();
    fireEvent.press(screen.getByLabelText('memberReport.reason.other. memberReport.help.other'));
    fireEvent.press(screen.getByTestId('report-member-submit'));
    expect(mockReportMember).not.toHaveBeenCalled();
    expect(screen.getByText('memberReport.detailsRequired')).toBeTruthy();
  });

  it('sends a member report and shows the thank-you', async () => {
    mockReportMember.mockResolvedValue({ data: { reported: true, report_id: 5 } });
    renderSheet();
    fireEvent.press(screen.getByLabelText('memberReport.reason.harassment. memberReport.help.harassment'));
    fireEvent.changeText(screen.getByTestId('report-details'), 'He keeps calling');
    fireEvent.press(screen.getByTestId('report-member-submit'));
    await waitFor(() => expect(screen.getByText('memberReport.sent')).toBeTruthy());
    expect(mockReportMember).toHaveBeenCalledWith(42, { category: 'harassment', details: 'He keeps calling' });
    expect(mockReportMessage).not.toHaveBeenCalled();
  });

  it('sends a message report to the message endpoint', async () => {
    mockReportMessage.mockResolvedValue({ data: { reported: true, report_id: 6 } });
    renderSheet({ type: 'message', id: 77 });
    expect(screen.getByText('memberReport.titleMessage:Bob')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('memberReport.reason.spam. memberReport.help.spam'));
    fireEvent.press(screen.getByTestId('report-member-submit'));
    await waitFor(() => expect(screen.getByText('memberReport.sent')).toBeTruthy());
    expect(mockReportMessage).toHaveBeenCalledWith(77, { category: 'spam', details: '' });
  });

  it('shows a 409 as information, not as an error', async () => {
    mockReportMember.mockRejectedValue(new ApiResponseError(409, 'You have already reported this member.', undefined, 'ALREADY_REPORTED'));
    renderSheet();
    fireEvent.press(screen.getByLabelText('memberReport.reason.spam. memberReport.help.spam'));
    fireEvent.press(screen.getByTestId('report-member-submit'));
    await waitFor(() => expect(screen.getByText('You have already reported this member.')).toBeTruthy());
    expect(screen.queryByText('memberReport.failed')).toBeNull();
  });

  it('shows the server message for a refusal and keeps the form', async () => {
    mockReportMember.mockRejectedValue(new ApiResponseError(422, 'You cannot report yourself.', undefined, 'CANNOT_REPORT_SELF'));
    renderSheet();
    fireEvent.press(screen.getByLabelText('memberReport.reason.spam. memberReport.help.spam'));
    fireEvent.press(screen.getByTestId('report-member-submit'));
    await waitFor(() => expect(screen.getByText('You cannot report yourself.')).toBeTruthy());
    expect(screen.getByTestId('report-member-submit')).toBeTruthy();
  });

  it('falls back to a translated message when the server gives none', async () => {
    mockReportMember.mockRejectedValue(new Error('network'));
    renderSheet();
    fireEvent.press(screen.getByLabelText('memberReport.reason.spam. memberReport.help.spam'));
    fireEvent.press(screen.getByTestId('report-member-submit'));
    await waitFor(() => expect(screen.getByText('memberReport.failed')).toBeTruthy());
  });
});
