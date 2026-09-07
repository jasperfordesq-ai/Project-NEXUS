// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockUseApi = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockUpdateExchange = jest.fn();
const mockSetExchangeTags = jest.fn();
const mockUploadExchangeImage = jest.fn();
const mockDeleteExchangeImage = jest.fn();
const mockGenerateExchangeDescription = jest.fn();
let mockListingCategoryId: number | null = 2;
let mockListingDescription = 'Listing body with enough detail.';
let mockExperienceLabel = 'Experience';
let mockEquipmentLabel = 'Equipment';
let mockAccessibilityLabel = 'Accessibility';

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  router: { back: (...args: unknown[]) => mockBack(...args), replace: (...args: unknown[]) => mockReplace(...args), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => ({ id: '5' }),
  // The unsaved-changes guard replays the prevented action through `dispatch`.
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      editTitle: 'Edit Listing',
      'detail.goBack': 'Go Back',
      titleLabel: 'Title',
      description: 'Description',
      'form.serviceType': 'Service format',
      'form.location': 'Location',
      'form.locationFromProfile': 'From your profile',
      'form.skills': 'Skills',
      'form.serviceDetailsToggle': 'Optional service details',
      'form.experienceLabel': mockExperienceLabel,
      'form.equipmentLabel': mockEquipmentLabel,
      'form.accessibilityLabel': mockAccessibilityLabel,
      'form.experienceBeginner': 'Beginner-friendly',
      'form.equipmentProvidedOption': "I'll provide everything needed",
      'form.aiHelpWrite': 'Help write description',
      'form.aiGenerating': 'Writing...',
      'form.aiEnterTitleFirst': 'Enter a title first',
      'form.hoursPlaceholder': 'Enter hours',
      'validation.titleMinLength': 'Use at least 5 characters for the title.',
      'validation.descriptionMinLength': 'Use at least 20 characters for the description.',
      'validation.categoryRequired': 'Please choose a category.',
      'validation.creditsRange': 'Enter between 0.5 and 100 credits.',
      category: 'Category',
      timeCredits: 'Time Credits',
      offer: 'Offer',
      request: 'Request',
      'detail.cancel': 'Cancel',
      'detail.saveChanges': 'Save changes',
      'form.partialSaveTitle': 'Your listing is saved, but not everything with it',
      'form.partialSaveTags': 'The skills could not be saved.',
      'form.partialSaveImage': 'The photo could not be saved.',
      'form.partialSaveRetry': 'Try the rest again',
      'form.partialSaveContinue': 'Continue without them',
    }[key] ?? key),
  }),
}));

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 1, location: 'Dublin' } }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#000',
    textMuted: '#777',
    error: '#dc2626',
    warning: '#f59e0b',
    background: '#f8fafc',
    surface: '#fff',
    border: '#ddd',
  }),
}));

jest.mock('@/lib/api/exchanges', () => ({
  getExchange: jest.fn(),
  getExchangeCategories: jest.fn(),
  setExchangeTags: (...args: unknown[]) => mockSetExchangeTags(...args),
  updateExchange: (...args: unknown[]) => mockUpdateExchange(...args),
  uploadExchangeImage: (...args: unknown[]) => mockUploadExchangeImage(...args),
  deleteExchangeImage: (...args: unknown[]) => mockDeleteExchangeImage(...args),
  generateExchangeDescription: (...args: unknown[]) => mockGenerateExchangeDescription(...args),
}));

jest.mock('@/lib/haptics', () => ({
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success', Error: 'error', Warning: 'warning' },
}));

jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('expo-image', () => ({ Image: 'View' }));
jest.mock('expo-image-picker', () => ({
  MediaTypeOptions: { Images: 'Images' },
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('@/components/ui/LoadingSpinner', () => () => null);

import { firePreventedRemoval, isGuardArmed } from '@/lib/test/unsavedGuardHarness';

import EditExchangeModal from './edit-exchange';

beforeEach(() => {
  mockUseApi.mockReset();
  mockBack.mockReset();
  mockReplace.mockReset();
  mockUpdateExchange.mockReset().mockResolvedValue({ data: { id: 5 } });
  mockSetExchangeTags.mockReset().mockResolvedValue({ data: {} });
  mockUploadExchangeImage.mockReset().mockResolvedValue({ data: { image_url: '/uploads/listing.jpg' } });
  mockDeleteExchangeImage.mockReset().mockResolvedValue(undefined);
  mockGenerateExchangeDescription.mockReset().mockResolvedValue({ data: { description: 'Generated listing body' } });
  mockListingCategoryId = 2;
  mockListingDescription = 'Listing body with enough detail.';
  mockExperienceLabel = 'Experience';
  mockEquipmentLabel = 'Equipment';
  mockAccessibilityLabel = 'Accessibility';
  const listingData = {
    id: 5,
    title: 'Edit me',
    get description() { return mockListingDescription; },
    type: 'offer',
    hours_estimate: 2,
    get category_id() { return mockListingCategoryId; },
    location: 'Skibbereen',
    service_type: 'hybrid',
    skill_tags: ['gardening'],
    status: 'active',
  };
  const listingState = {
      data: {
        data: listingData,
      },
      isLoading: false,
      error: null,
    };
  const categoriesState = {
    data: { data: [{ id: 1, name: 'Gardening' }, { id: 2, name: 'Teaching' }] },
    isLoading: false,
    error: null,
  };

  mockUseApi.mockImplementation((...args: unknown[]) => (
    args.length > 1 ? listingState : categoriesState
  ));
});

describe('EditExchangeModal', () => {
  it('renders the editable listing fields', () => {
    const { getAllByText, getByDisplayValue, getByPlaceholderText } = render(<EditExchangeModal />);
    expect(getAllByText('Edit Listing').length).toBeGreaterThan(0);
    expect(getByDisplayValue('Edit me')).toBeTruthy();
    expect(getByDisplayValue('Listing body with enough detail.')).toBeTruthy();
    expect(getByDisplayValue('Skibbereen')).toBeTruthy();
    expect(getByDisplayValue('gardening')).toBeTruthy();
    expect(getByPlaceholderText('Enter hours')).toBeTruthy();
    expect(getAllByText('Teaching').length).toBeGreaterThan(0);
    expect(getAllByText('Optional service details').length).toBeGreaterThan(0);
  });

  it('saves listing changes and tags', async () => {
    const { getByDisplayValue, getByText } = render(<EditExchangeModal />);
    fireEvent.changeText(getByDisplayValue('Edit me'), 'Updated title');
    fireEvent.changeText(getByDisplayValue('gardening'), 'gardening, mentoring');
    fireEvent.press(getByText('Save changes'));

    await waitFor(() => expect(mockUpdateExchange).toHaveBeenCalledWith(5, expect.objectContaining({
      title: 'Updated title',
      description: 'Listing body with enough detail.',
      type: 'offer',
      hours_estimate: 2,
      category_id: 2,
      location: 'Skibbereen',
      service_type: 'hybrid',
    })));
    expect(mockSetExchangeTags).toHaveBeenCalledWith(5, ['gardening', 'mentoring']);
  });

  it('requires title and description to meet listing length limits', async () => {
    const { getByDisplayValue, getByText } = render(<EditExchangeModal />);

    fireEvent.changeText(getByDisplayValue('Edit me'), 'Help');
    fireEvent.changeText(getByDisplayValue('Listing body with enough detail.'), 'Too short');
    fireEvent.press(getByText('Save changes'));

    await waitFor(() => expect(getByText('Use at least 5 characters for the title.')).toBeTruthy());
    expect(getByText('Use at least 20 characters for the description.')).toBeTruthy();
    expect(mockUpdateExchange).not.toHaveBeenCalled();
  });

  it('requires time credits to stay within the listing range', async () => {
    const { getByDisplayValue, getByText } = render(<EditExchangeModal />);

    fireEvent.changeText(getByDisplayValue('2'), '101');
    fireEvent.press(getByText('Save changes'));

    await waitFor(() => expect(getByText('Enter between 0.5 and 100 credits.')).toBeTruthy());
    expect(mockUpdateExchange).not.toHaveBeenCalled();
  });

  it('generates a replacement description from the listing context', async () => {
    const { getByDisplayValue, getByText } = render(<EditExchangeModal />);
    fireEvent.press(getByText('Help write description'));

    await waitFor(() => expect(mockGenerateExchangeDescription).toHaveBeenCalledWith({
      title: 'Edit me',
      category: 'Teaching',
      type: 'offer',
      notes: 'Listing body with enough detail.',
    }));
    expect(getByDisplayValue('Generated listing body')).toBeTruthy();
  });

  it('preserves localized service details when saving an edited listing', async () => {
    mockExperienceLabel = 'Taith';
    mockEquipmentLabel = 'Offer';
    mockAccessibilityLabel = 'Mynediad';
    mockListingDescription = [
      'Listing body with enough detail.',
      '',
      '---',
      'Taith: Beginner-friendly',
      "Offer: I'll provide everything needed",
      'Mynediad: Ground floor room',
    ].join('\n');

    const { getByText } = render(<EditExchangeModal />);
    fireEvent.press(getByText('Save changes'));

    await waitFor(() => expect(mockUpdateExchange).toHaveBeenCalledWith(5, expect.objectContaining({
      description: [
        'Listing body with enough detail.',
        '',
        '---',
        'Taith: Beginner-friendly',
        "Offer: I'll provide everything needed",
        'Mynediad: Ground floor room',
      ].join('\n'),
    })));
  });

  // 🔴 Audit 2026-09-06, F01. A listing written in French, edited in English: the labels
  // are the member's translated words, so an English editor used to match none of them,
  // find no details, and save the listing without them — erasing the step-free-entry note
  // a disabled member relies on. Changing only the title must not touch the rest.
  it('keeps service details written in another language through a title-only edit', async () => {
    mockListingDescription = [
      'Je propose des cours de guitare pour tous les niveaux.',
      '',
      '---',
      'Expérience: Accessible aux débutants',
      'Équipement: Je fournirai tout le nécessaire',
      'Accessibilité: Entrée sans marche',
    ].join('\n');

    const { getByDisplayValue, getByText } = render(<EditExchangeModal />);
    fireEvent.changeText(getByDisplayValue('Edit me'), 'Cours de guitare');
    fireEvent.press(getByText('Save changes'));

    await waitFor(() => expect(mockUpdateExchange).toHaveBeenCalledWith(5, expect.objectContaining({
      title: 'Cours de guitare',
      description: [
        'Je propose des cours de guitare pour tous les niveaux.',
        '',
        '---',
        'Experience: Beginner-friendly',
        "Equipment: I'll provide everything needed",
        'Accessibility: Entrée sans marche',
      ].join('\n'),
    })));
  });

  // 🔴 Audit 2026-09-06, F02. `---` is an ordinary horizontal rule in a member's own
  // prose. Everything after the first one used to be discarded on save, and any detail
  // line this build does not know about went with it.
  it('keeps prose after a separator and unknown detail lines through a title-only edit', async () => {
    mockListingDescription = [
      'What I offer, in enough detail to pass validation.',
      '',
      '---',
      'How it usually works on the day.',
      '',
      '---',
      'Experience: Beginner-friendly',
      'Deposit: 20 credits',
    ].join('\n');

    const { getByDisplayValue, getByText } = render(<EditExchangeModal />);
    fireEvent.changeText(getByDisplayValue('Edit me'), 'Updated title');
    fireEvent.press(getByText('Save changes'));

    await waitFor(() => expect(mockUpdateExchange).toHaveBeenCalledWith(5, expect.objectContaining({
      title: 'Updated title',
      description: [
        'What I offer, in enough detail to pass validation.',
        '',
        '---',
        'How it usually works on the day.',
        '',
        '---',
        'Experience: Beginner-friendly',
        'Deposit: 20 credits',
      ].join('\n'),
    })));
  });

  /**
   * 🔴 Audit 2026-09-06, F03. Pressing Save used to disarm the guard immediately, so the
   * member could walk out while the request was still running. A started save is not a
   * kept save: the screen stays protected until the write is confirmed.
   */
  it('keeps the form protected until a save is confirmed, then lets it leave', async () => {
    let confirmSave: (value: unknown) => void = () => {};
    mockUpdateExchange.mockImplementation(() => new Promise((resolve) => { confirmSave = resolve; }));

    const { getByDisplayValue, getByText } = render(<EditExchangeModal />);
    fireEvent.changeText(getByDisplayValue('Edit me'), 'Updated title');
    expect(isGuardArmed()).toBe(true);

    fireEvent.press(getByText('Save changes'));
    await waitFor(() => expect(mockUpdateExchange).toHaveBeenCalled());

    // The write is in flight. Leaving now is still challenged, and nothing navigates.
    expect(isGuardArmed()).toBe(true);
    firePreventedRemoval();
    expect(mockReplace).not.toHaveBeenCalled();

    await act(async () => { confirmSave({ data: { id: 5 } }); });

    // Confirmed: the screen's own navigation to the listing is no longer challenged.
    await waitFor(() => expect(isGuardArmed()).toBe(false));
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/(modals)/exchange-detail', params: { id: '5' } });
  });

  it('keeps the form protected when a save is rejected', async () => {
    mockUpdateExchange.mockRejectedValue(new Error('network unreachable'));

    const { getByDisplayValue, getByText } = render(<EditExchangeModal />);
    fireEvent.changeText(getByDisplayValue('Edit me'), 'Updated title');
    fireEvent.press(getByText('Save changes'));

    await waitFor(() => expect(mockUpdateExchange).toHaveBeenCalled());
    await waitFor(() => expect(isGuardArmed()).toBe(true));
    expect(mockReplace).not.toHaveBeenCalled();
  });

  /**
   * 🔴 Audit 2026-09-06, F06. The listing saves in one request and its skills and photo
   * in others. When one of those fails, the screen used to warn and then navigate to the
   * listing anyway — taking the failed input with it. The member's only route back to
   * their own skills was to type them again.
   */
  describe('partial save', () => {
    it('stays on the form with the failed skills when only the skills fail', async () => {
      mockSetExchangeTags.mockReset().mockRejectedValueOnce(new Error('network unreachable'));

      const { getByDisplayValue, getByText, getByTestId } = render(<EditExchangeModal />);
      fireEvent.changeText(getByDisplayValue('gardening'), 'gardening, mentoring');
      fireEvent.press(getByText('Save changes'));

      await waitFor(() => expect(getByTestId('listing-partial-save')).toBeTruthy());
      expect(mockReplace).not.toHaveBeenCalled();
      expect(getByText('The skills could not be saved.')).toBeTruthy();
      // The photo saved — do not claim otherwise.
      expect(() => getByText('The photo could not be saved.')).toThrow();
      // And the input that failed is still there to retry with.
      expect(getByDisplayValue('gardening, mentoring')).toBeTruthy();
    });

    it('retries only the skills, never the listing, and leaves once they land', async () => {
      mockSetExchangeTags.mockReset()
        .mockRejectedValueOnce(new Error('network unreachable'))
        .mockResolvedValueOnce({ data: {} });

      const { getByDisplayValue, getByText, getByTestId } = render(<EditExchangeModal />);
      fireEvent.changeText(getByDisplayValue('gardening'), 'gardening, mentoring');
      fireEvent.press(getByText('Save changes'));
      await waitFor(() => expect(getByTestId('listing-partial-save')).toBeTruthy());

      fireEvent.press(getByTestId('listing-partial-save-retry'));

      await waitFor(() => expect(mockSetExchangeTags).toHaveBeenCalledTimes(2));
      // 🔴 The listing was already saved. Sending it again is how a listing gets edited twice.
      expect(mockUpdateExchange).toHaveBeenCalledTimes(1);
      expect(mockSetExchangeTags).toHaveBeenLastCalledWith(5, ['gardening', 'mentoring']);
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/(modals)/exchange-detail', params: { id: '5' },
      }));
    });

    it('lets the member move on without the parts that failed', async () => {
      mockSetExchangeTags.mockReset().mockRejectedValue(new Error('network unreachable'));

      const { getByDisplayValue, getByText, getByTestId } = render(<EditExchangeModal />);
      fireEvent.changeText(getByDisplayValue('gardening'), 'gardening, mentoring');
      fireEvent.press(getByText('Save changes'));
      await waitFor(() => expect(getByTestId('listing-partial-save')).toBeTruthy());

      fireEvent.press(getByTestId('listing-partial-save-continue'));

      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/(modals)/exchange-detail', params: { id: '5' },
      }));
      expect(mockSetExchangeTags).toHaveBeenCalledTimes(1);
    });
  });

  it('goes back when cancel is pressed', () => {
    const { getByText } = render(<EditExchangeModal />);
    fireEvent.press(getByText('Cancel'));
    expect(mockBack).toHaveBeenCalled();
  });

  it('requires an explicit category when the listing has none', async () => {
    mockListingCategoryId = null;
    const { getByText } = render(<EditExchangeModal />);
    fireEvent.press(getByText('Save changes'));

    await waitFor(() => expect(getByText('Please choose a category.')).toBeTruthy());
    expect(mockUpdateExchange).not.toHaveBeenCalled();
  });
});
