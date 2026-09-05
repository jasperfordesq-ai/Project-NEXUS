// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

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
  router: { back: (...args: unknown[]) => mockBack(...args), replace: (...args: unknown[]) => mockReplace(...args), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => ({ id: '5' }),
  // The unsaved-changes guard subscribes to `beforeRemove`.
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
    }[key] ?? key),
  }),
}));

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
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
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
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
