// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import SettingsSafeguardingScreen from './settings-safeguarding';
import {
  addSafeguardingChoice,
  getAddableSafeguardingOptions,
  getMySafeguardingChoices,
  removeSafeguardingChoice,
} from '@/lib/api/safeguarding';

jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { back: jest.fn(), canGoBack: jest.fn(() => false), replace: jest.fn(), push: jest.fn() },
}));

const mockSafeguardingT = (key: string) => {
  const map: Record<string, string> = {
    'safeguarding.title': 'Safeguarding preferences',
    'safeguarding.subtitle': 'These are the choices you have made about extra support.',
    'safeguarding.currentTitle': 'Your choices',
    'safeguarding.none': 'You have not asked for any extra support.',
    'safeguarding.whatThisDoes': 'What this does',
    'safeguarding.remove': 'Remove',
    'safeguarding.removeConfirmTitle': 'Remove this choice?',
    'safeguarding.removeConfirmBody': 'The support it gives you stops straight away.',
    'safeguarding.removed': 'Choice removed',
    'safeguarding.removeError': 'Could not remove that.',
    'safeguarding.loadError': 'Could not load your choices.',
    'safeguarding.addTitle': 'Add extra support',
    'safeguarding.addIntro': 'You can ask for extra support at any time.',
    'safeguarding.add': 'Add this',
    'safeguarding.addConfirmTitle': 'Add this support?',
    'safeguarding.addConfirmBody': 'It starts straight away.',
    'safeguarding.addConfirmYes': 'Yes, add it',
    'safeguarding.added': 'Added.',
    'safeguarding.addError': 'Could not add that.',
    'common:buttons.back': 'Back',
    'common:buttons.cancel': 'Cancel',
    'common:errors.generic': 'Error',
    attribution: 'AGPL attribution',
    'sourceRepo.builtOn': 'Built on Project NEXUS by Jasper Ford',
    'sourceRepo.accessibilityLabel': 'Opens the source code repository on GitHub.',
  };
  return map[key] ?? key;
};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockSafeguardingT, i18n: { language: 'en' } }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ text: '#111827', textSecondary: '#4b5563', textMuted: '#6b7280', error: '#ef4444', success: '#16a34a' }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1 } }) }));

jest.mock('@/lib/api/safeguarding', () => ({
  getMySafeguardingChoices: jest.fn(),
  getAddableSafeguardingOptions: jest.fn(),
  addSafeguardingChoice: jest.fn(),
  removeSafeguardingChoice: jest.fn(),
}));

jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

const mockConfirm = jest.fn();
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({ confirm: mockConfirm, confirmDialog: null }),
}));

const mockGetChoices = getMySafeguardingChoices as jest.MockedFunction<typeof getMySafeguardingChoices>;
const mockGetAddable = getAddableSafeguardingOptions as jest.MockedFunction<typeof getAddableSafeguardingOptions>;
const mockAdd = addSafeguardingChoice as jest.MockedFunction<typeof addSafeguardingChoice>;
const mockRemove = removeSafeguardingChoice as jest.MockedFunction<typeof removeSafeguardingChoice>;

const HELD = {
  preference_id: 5,
  option_id: 10,
  option_key: 'coordinator_introductions',
  label: 'A coordinator keeps an eye on my exchanges',
  description: null,
  consent_given_at: '2026-01-15T10:00:00Z',
  effects: ['A coordinator approves your exchanges.'],
};

const OPEN = {
  option_id: 42,
  option_key: 'is_vulnerable_adult',
  label: 'I consider myself a vulnerable adult',
  description: 'Choose this if you would like extra care.',
  effects: ['Only coordinators and vetted members can message you.'],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockConfirm.mockImplementation((opts: { onConfirm: () => void | Promise<void> }) => { void opts.onConfirm(); });
  mockGetChoices.mockResolvedValue([HELD]);
  mockGetAddable.mockResolvedValue([OPEN]);
});

describe('SettingsSafeguardingScreen', () => {
  it('shows current choices and choices that can be added, each with what it does', async () => {
    const screen = render(<SettingsSafeguardingScreen />);

    expect(await screen.findByText('A coordinator keeps an eye on my exchanges')).toBeTruthy();
    expect(screen.getByText(/A coordinator approves your exchanges./)).toBeTruthy();
    expect(screen.getByText('Add extra support')).toBeTruthy();
    expect(screen.getByText('I consider myself a vulnerable adult')).toBeTruthy();
    expect(screen.getByText(/Only coordinators and vetted members can message you/)).toBeTruthy();
  });

  it('says so when the member holds no choices, and hides the add section when nothing is left', async () => {
    mockGetChoices.mockResolvedValue([]);
    mockGetAddable.mockResolvedValue([]);
    const screen = render(<SettingsSafeguardingScreen />);

    expect(await screen.findByText('You have not asked for any extra support.')).toBeTruthy();
    expect(screen.queryByText('Add extra support')).toBeNull();
  });

  it('confirms before adding, then saves through the add-choice endpoint and reloads', async () => {
    mockAdd.mockResolvedValue({});
    const screen = render(<SettingsSafeguardingScreen />);
    fireEvent.press(await screen.findByText('Add this'));

    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Add this support?',
      confirmLabel: 'Yes, add it',
      variant: 'primary',
    }));
    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith(42));
    await waitFor(() => expect(mockGetAddable).toHaveBeenCalledTimes(2));
  });

  it('does not add anything when the confirmation is not accepted', async () => {
    mockConfirm.mockImplementation(() => {});
    const screen = render(<SettingsSafeguardingScreen />);
    fireEvent.press(await screen.findByText('Add this'));
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('removes a choice through the same endpoint as the website, after a warning', async () => {
    mockRemove.mockResolvedValue({});
    const screen = render(<SettingsSafeguardingScreen />);
    fireEvent.press(await screen.findByText('Remove'));

    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Remove this choice?', variant: 'danger' }));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith(10));
    await waitFor(() => expect(screen.queryByText('A coordinator keeps an eye on my exchanges')).toBeNull());
  });

  it('keeps the choice listed when removing fails', async () => {
    mockRemove.mockRejectedValue(new Error('Unavailable'));
    const screen = render(<SettingsSafeguardingScreen />);
    fireEvent.press(await screen.findByText('Remove'));
    await waitFor(() => expect(mockRemove).toHaveBeenCalled());
    expect(screen.getByText('A coordinator keeps an eye on my exchanges')).toBeTruthy();
  });

  it('shows an error with a retry instead of an empty list when loading fails', async () => {
    mockGetChoices.mockRejectedValueOnce(new Error('Unavailable'));
    const screen = render(<SettingsSafeguardingScreen />);
    await screen.findByTestId('safeguarding-settings-error');
    expect(screen.queryByText('You have not asked for any extra support.')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByText('common:buttons.retry')); });
    expect(await screen.findByText('A coordinator keeps an eye on my exchanges')).toBeTruthy();
  });
});
