// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import SettingsDataExportScreen from './settings-data-export';
import { getDataExportHistory, requestDataExport } from '@/lib/api/settings';

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { back: jest.fn(), canGoBack: jest.fn(() => false), replace: jest.fn(), push: jest.fn() },
}));

const mockSettingsDataExportT = (key: string, options?: Record<string, unknown>) => {
  const map: Record<string, string> = {
        'dataExport.title': 'Data export',
        'dataExport.privacyBadge': 'Account data',
        'dataExport.subtitle': 'Download a portable copy.',
        'dataExport.intro': 'Exports may include account activity.',
        'dataExport.warning': 'Keep exported files private.',
        'dataExport.loading': 'Loading export history...',
        'dataExport.loadError': 'Could not load export history.',
        'dataExport.requestButton': 'Request export',
        'dataExport.requesting': 'Requesting export...',
        'dataExport.requested': 'Export requested',
        'dataExport.requestedBody': 'Your export request has been submitted.',
        'dataExport.requestError': 'Could not request your export.',
        'dataExport.format.label': 'Export format',
        'dataExport.format.json': 'JSON',
        'dataExport.format.jsonHelp': 'Best for portability.',
        'dataExport.format.zip': 'ZIP archive',
        'dataExport.format.zipHelp': 'Best for multiple files.',
        'dataExport.history.title': 'Export history',
        'dataExport.history.count': `${options?.count ?? 0} exports`,
        'dataExport.history.empty': 'No exports yet',
        'dataExport.history.emptyDesc': 'Exports will appear here.',
        'common:buttons.back': 'Back',
        // Read by <SourceRepositoryLink /> from the 'common' namespace.
        attribution: 'AGPL attribution',
        'sourceRepo.builtOn': 'Built on Project NEXUS by Jasper Ford',
        'sourceRepo.accessibilityLabel': 'Opens the source code repository on GitHub.',
        'common:errors.generic': 'Error',
  };
  return map[key] ?? key;
};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockSettingsDataExportT,
    i18n: { language: 'en' },
  }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
    warning: '#f59e0b',
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));

jest.mock('@/lib/api/settings', () => ({
  getDataExportHistory: jest.fn(),
  requestDataExport: jest.fn(),
}));

jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

const mockGetDataExportHistory = getDataExportHistory as jest.MockedFunction<typeof getDataExportHistory>;
const mockRequestDataExport = requestDataExport as jest.MockedFunction<typeof requestDataExport>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SettingsDataExportScreen', () => {
  it('renders export history and format options', async () => {
    mockGetDataExportHistory.mockResolvedValue([
      { id: 7, format: 'json', requested_at: '2026-05-01T10:00:00Z', completed_at: '2026-05-01T10:01:00Z', file_size_bytes: 2048 },
    ]);

    const { getByText } = render(<SettingsDataExportScreen />);

    await waitFor(() => expect(getByText('json')).toBeTruthy());
    expect(getByText('JSON')).toBeTruthy();
    expect(getByText('ZIP archive')).toBeTruthy();
    expect(getByText('1 exports')).toBeTruthy();
    expect(getByText('2.0 KB')).toBeTruthy();
  });

  it('requests a data export using the selected format', async () => {
    mockGetDataExportHistory.mockResolvedValue([]);
    mockRequestDataExport.mockResolvedValue({});

    const { getByText } = render(<SettingsDataExportScreen />);
    await waitFor(() => expect(getByText('Request export')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByText('ZIP archive'));
    });
    await waitFor(() => expect(getByText('Best for multiple files.')).toBeTruthy());
    await act(async () => {
      fireEvent.press(getByText('Request export'));
    });

    await waitFor(() => expect(mockRequestDataExport).toHaveBeenCalledWith('zip'));
  });
});
