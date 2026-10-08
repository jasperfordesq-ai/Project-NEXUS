// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiResponseError } from '@/lib/api/client';

const mockReplace = jest.fn();
let mockRouteParams: Record<string, string> = { id: '19' };

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: (...args: unknown[]) => mockReplace(...args), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => mockRouteParams,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'deleteOpportunity.heading': 'Remove this opportunity',
        'deleteOpportunity.hint': 'It disappears from the list and nobody new can apply.',
        'deleteOpportunity.button': 'Delete opportunity',
        'deleteOpportunity.confirmTitle': 'Delete this opportunity?',
        'deleteOpportunity.confirmMessage': 'It will no longer be shown to volunteers.',
        'deleteOpportunity.confirm': 'Delete',
        'deleteOpportunity.doneTitle': 'Opportunity deleted',
        'deleteOpportunity.doneMessage': 'Volunteers can no longer see or apply to it.',
        'deleteOpportunity.failed': 'Could not delete this opportunity.',
        'common:buttons.cancel': 'Cancel',
        'common:errors.alertTitle': 'Error',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/lib/haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { id: 2, slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ bg: '#fff', surface: '#f8f9fa', text: '#111', textSecondary: '#666', textMuted: '#999', error: '#dc2626', success: '#16a34a', warning: '#f59e0b', border: '#ddd' }),
}));
jest.mock('@/lib/ui/rootInsets', () => ({ useBottomInset: () => 0 }));
jest.mock('@/components/ui/ConfirmDialog', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    __esModule: true,
    default: ({ visible, title, cancelLabel, confirmLabel, cancelTestID, confirmTestID, onClose, onConfirm }: Record<string, unknown>) =>
      visible ? (
        <View>
          <Text>{title as string}</Text>
          <Pressable testID={cancelTestID as string} onPress={onClose as () => void}><Text>{cancelLabel as string}</Text></Pressable>
          <Pressable testID={confirmTestID as string} onPress={onConfirm as () => void}><Text>{confirmLabel as string}</Text></Pressable>
        </View>
      ) : null,
  };
});
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});
const { show: mockShowToast } = (jest.requireMock('@/components/ui/AppToast') as { useAppToast: () => { show: jest.Mock } }).useAppToast();

// The form itself is `new-volunteering`, tested in its own file; here it only has to be present.
jest.mock('./new-volunteering', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { __esModule: true, default: () => <View testID="opportunity-form" /> };
});
jest.mock('@/lib/api/volunteeringOrganiser', () => ({ deleteOpportunity: jest.fn() }));

import { deleteOpportunity } from '@/lib/api/volunteeringOrganiser';
import EditVolunteering from './edit-volunteering';

describe('EditVolunteering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = { id: '19' };
    jest.mocked(deleteOpportunity).mockResolvedValue(undefined);
  });

  it('renders the edit form with the delete action below it', () => {
    const screen = render(<EditVolunteering />);
    expect(screen.getByTestId('opportunity-form')).toBeTruthy();
    expect(screen.getByTestId('edit-volunteering-delete')).toBeTruthy();
  });

  it('🔴 deletes only after the organiser confirms, then leaves the dead record behind', async () => {
    const screen = render(<EditVolunteering />);

    fireEvent.press(screen.getByTestId('edit-volunteering-delete'));
    expect(deleteOpportunity).not.toHaveBeenCalled();
    expect(screen.getByText('Delete this opportunity?')).toBeTruthy();

    await act(async () => { fireEvent.press(screen.getByTestId('edit-volunteering-delete-confirm')); });
    expect(deleteOpportunity).toHaveBeenCalledWith(19);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/(modals)/volunteering', params: { tab: 'organisations' } }));
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Opportunity deleted', variant: 'success' }));
  });

  it('shows the server\'s refusal in its own words and stays on the screen', async () => {
    jest.mocked(deleteOpportunity).mockRejectedValueOnce(new ApiResponseError(403, 'You do not manage this opportunity.', undefined, 'FORBIDDEN'));
    const screen = render(<EditVolunteering />);
    fireEvent.press(screen.getByTestId('edit-volunteering-delete'));
    await act(async () => { fireEvent.press(screen.getByTestId('edit-volunteering-delete-confirm')); });
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'You do not manage this opportunity.', variant: 'danger' })));
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('offers no delete when there is no opportunity to delete', () => {
    mockRouteParams = {};
    const screen = render(<EditVolunteering />);
    expect(screen.getByTestId('opportunity-form')).toBeTruthy();
    expect(screen.queryByTestId('edit-volunteering-delete')).toBeNull();
  });
});
