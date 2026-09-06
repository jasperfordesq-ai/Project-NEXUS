// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockUseApi = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCreateExchange = jest.fn();
const mockSetExchangeTags = jest.fn();
const mockUploadExchangeImage = jest.fn();
const mockGenerateExchangeDescription = jest.fn();
const mockLaunchImageLibraryAsync = jest.fn();

// The unsaved-changes guard subscribes to `beforeRemove`; capture the handler so a
// test can fire it the way Back / a swipe would.
const mockNavListeners: Record<string, (e: unknown) => void> = {};
const mockNavDispatch = jest.fn();

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  router: {
    back: (...args: unknown[]) => mockBack(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    canGoBack: jest.fn(() => false),
  },
  useNavigation: () => ({
    addListener: (event: string, handler: (e: unknown) => void) => {
      mockNavListeners[event] = handler;
      return () => { delete mockNavListeners[event]; };
    },
    dispatch: (...args: unknown[]) => mockNavDispatch(...args),
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => ({
      newExchange: 'New Listing',
      'detail.goBack': 'Go Back',
      'detail.cancel': 'Cancel',
      'detail.actionFailedTitle': 'Action failed',
      'detail.aiGenerateFailed': 'AI failed',
      'detail.imageUploadFailedTitle': 'Listing saved',
      'detail.imageUploadFailedMessage': 'Image upload failed',
      titleLabel: 'Title',
      description: 'Description',
      category: 'Category',
      timeCredits: 'Time Credits',
      offer: 'Offer',
      request: 'Request',
      offerPlaceholder: 'What are you offering?',
      requestPlaceholder: 'What do you need?',
      descriptionPlaceholder: 'Add more details...',
      postOffer: 'Post Offer',
      postRequest: 'Post Request',
      categoryLabel: String(opts?.name ?? ''),
      createError: 'Failed to create exchange.',
      'form.createIntro': 'Create a clear offer or request.',
      'form.basicsTitle': 'Listing basics',
      'form.deliveryTitle': 'Where and how',
      'form.extraDetails': 'Optional service details',
      'form.organiseTitle': 'Category and credits',
      'form.mediaSection': 'Listing image',
      'form.mediaHint': 'Add or replace the image.',
      'form.summaryType': 'Type',
      'form.summaryCategory': 'Category',
      'form.summaryNotSet': 'Not set',
      'form.offerTitle': 'Offer',
      'form.requestTitle': 'Request',
      'form.serviceType': 'Service format',
      'form.location': 'Location',
      'form.locationPlaceholder': 'Where this can happen',
      'form.locationFromProfile': 'From your profile',
      'form.skills': 'Skills',
      'form.skillsPlaceholder': 'gardening, mentoring',
      'form.serviceDetailsToggle': 'Optional service details',
      'form.extraDetailsHint': 'Optional details.',
      'form.experienceLabel': 'Experience',
      'form.equipmentLabel': 'Equipment',
      'form.accessibilityLabel': 'Accessibility',
      'form.accessibilityPlaceholder': 'Accessibility notes',
      'form.experienceBeginner': 'Beginner-friendly',
      'form.experienceSome': 'Some experience helpful',
      'form.experienceExperienced': 'Experienced practitioner',
      'form.experienceProfessional': 'Professional / certified',
      'form.equipmentProvidedOption': "I'll provide everything needed",
      'form.equipmentPartial': 'Some things needed from you',
      'form.equipmentBringOwn': "You'll need to provide your own",
      'form.equipmentNa': 'Not applicable',
      'form.addImage': 'Add image',
      'form.replaceImage': 'Replace',
      'form.removeImage': 'Remove',
      'form.aiHelpWrite': 'Help write description',
      'form.aiGenerating': 'Writing...',
      'form.aiEnterTitleFirst': 'Enter a title first',
      'form.titleTooGenericHint': 'Use a more specific title.',
      'form.hoursPlaceholder': 'Enter hours',
      'form.hoursHint': 'Estimate the time involved.',
      'serviceType.hybrid': 'Hybrid',
      'serviceType.physical_only': 'In person',
      'serviceType.remote_only': 'Remote',
      'serviceType.location_dependent': 'Location dependent',
      'validation.titleRequired': 'Title is required.',
      'validation.titleMinLength': 'Use at least 5 characters for the title.',
      'validation.descriptionRequired': 'Description is required.',
      'validation.descriptionMinLength': 'Use at least 20 characters for the description.',
      'validation.categoryRequired': 'Please choose a category.',
      'validation.invalidCredits': 'Enter a valid number of credits.',
      'validation.creditsRange': 'Enter between 0.5 and 100 credits.',
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
    bg: '#0A0A0F',
    text: '#000',
    textMuted: '#777',
    textSecondary: '#666',
    error: '#dc2626',
    warning: '#f59e0b',
    surface: '#fff',
    border: '#ddd',
  }),
}));

jest.mock('@/lib/api/exchanges', () => ({
  createExchange: (...args: unknown[]) => mockCreateExchange(...args),
  generateExchangeDescription: (...args: unknown[]) => mockGenerateExchangeDescription(...args),
  getExchangeCategories: jest.fn(),
  setExchangeTags: (...args: unknown[]) => mockSetExchangeTags(...args),
  uploadExchangeImage: (...args: unknown[]) => mockUploadExchangeImage(...args),
}));

jest.mock('@/lib/api/client', () => ({
  ApiResponseError: class ApiResponseError extends Error {},
}));

jest.mock('@/lib/haptics', () => ({
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

// Stable AppToast mock — fns created inside the factory closure.
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

const { show: mockShowToast } = (jest.requireMock('@/components/ui/AppToast') as {
  useAppToast: () => { show: jest.Mock };
}).useAppToast();

jest.mock('expo-image-picker', () => ({
  MediaTypeOptions: { Images: 'Images' },
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibraryAsync(...args),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('expo-image', () => ({ Image: 'View' }));
jest.mock('@/components/OfflineBanner', () => () => null);

import NewExchangeModal from './new-exchange';
import { firePreventedRemoval, isGuardArmed } from '@/lib/test/unsavedGuardHarness';

beforeEach(() => {
  mockUseApi.mockReset().mockReturnValue({
    data: { data: [{ id: 1, name: 'Gardening' }, { id: 2, name: 'Teaching' }] },
    isLoading: false,
    error: null,
  });
  mockBack.mockReset();
  mockReplace.mockReset();
  mockCreateExchange.mockReset().mockResolvedValue({ data: { id: 9 } });
  mockSetExchangeTags.mockReset().mockResolvedValue({ data: {} });
  mockUploadExchangeImage.mockReset().mockResolvedValue({ data: { image_url: '/uploads/listing.jpg' } });
  mockGenerateExchangeDescription.mockReset().mockResolvedValue({ data: { description: 'Generated listing body' } });
  mockLaunchImageLibraryAsync.mockReset().mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///tmp/listing.jpg' }] });
  mockShowToast.mockClear();
});

describe('NewExchangeModal', () => {
  it('renders the polished create form', () => {
    const { getAllByText, getByPlaceholderText } = render(<NewExchangeModal />);
    expect(getAllByText('New Listing').length).toBeGreaterThan(0);
    expect(getByPlaceholderText('What are you offering?')).toBeTruthy();
    expect(getByPlaceholderText('Add more details...')).toBeTruthy();
    expect(getByPlaceholderText('Enter hours')).toBeTruthy();
    expect(getAllByText('Category').length).toBeGreaterThan(0);
  });

  it('keeps the Android release layout full-height so form content renders below the header', () => {
    const { getByTestId } = render(<NewExchangeModal />);

    expect(StyleSheet.flatten(getByTestId('new-exchange-screen').props.style)).toEqual(
      expect.objectContaining({ flex: 1, backgroundColor: '#0A0A0F' }),
    );
    expect(StyleSheet.flatten(getByTestId('new-exchange-scroll').props.style)).toEqual(
      expect.objectContaining({ flex: 1, backgroundColor: '#0A0A0F' }),
    );
    expect(getByTestId('new-exchange-footer')).toBeTruthy();
    expect(getByTestId('new-exchange-title')).toBeTruthy();
    expect(getByTestId('new-exchange-description')).toBeTruthy();
    expect(getByTestId('new-exchange-hours')).toBeTruthy();
    expect(getByTestId('new-exchange-submit')).toBeTruthy();
  });

  it('requires title, description, category, and valid credits', async () => {
    const { getByText } = render(<NewExchangeModal />);
    fireEvent.press(getByText('Post Offer'));

    await waitFor(() => expect(getByText('Title is required.')).toBeTruthy());
    expect(getByText('Description is required.')).toBeTruthy();
    expect(getByText('Please choose a category.')).toBeTruthy();
    expect(mockCreateExchange).not.toHaveBeenCalled();
  });

  it('requires title and description to meet listing length limits', async () => {
    const { getByPlaceholderText, getByText } = render(<NewExchangeModal />);

    fireEvent.changeText(getByPlaceholderText('What are you offering?'), 'Help');
    fireEvent.changeText(getByPlaceholderText('Add more details...'), 'Too short');
    fireEvent.press(getByText('Gardening'));
    fireEvent.press(getByText('Post Offer'));

    await waitFor(() => expect(getByText('Use at least 5 characters for the title.')).toBeTruthy());
    expect(getByText('Use at least 20 characters for the description.')).toBeTruthy();
    expect(mockCreateExchange).not.toHaveBeenCalled();
  });

  it('requires time credits to stay within the listing range', async () => {
    const { getByPlaceholderText, getByText } = render(<NewExchangeModal />);

    fireEvent.changeText(getByPlaceholderText('What are you offering?'), 'Gardening help');
    fireEvent.changeText(getByPlaceholderText('Add more details...'), 'I can help with weeding and pruning.');
    fireEvent.changeText(getByPlaceholderText('Enter hours'), '0.25');
    fireEvent.press(getByText('Gardening'));
    fireEvent.press(getByText('Post Offer'));

    await waitFor(() => expect(getByText('Enter between 0.5 and 100 credits.')).toBeTruthy());
    expect(mockCreateExchange).not.toHaveBeenCalled();
  });

  it('creates a listing, saves tags, uploads an image, and opens the detail page', async () => {
    const { getByPlaceholderText, getByText } = render(<NewExchangeModal />);
    fireEvent.changeText(getByPlaceholderText('What are you offering?'), 'Gardening help');
    fireEvent.changeText(getByPlaceholderText('Add more details...'), 'I can help with weeding and pruning.');
    fireEvent.changeText(getByPlaceholderText('gardening, mentoring'), 'gardening, pruning');
    fireEvent.press(getByText('Teaching'));
    fireEvent.press(getByText('Add image'));
    await waitFor(() => expect(mockLaunchImageLibraryAsync).toHaveBeenCalled());
    fireEvent.press(getByText('Post Offer'));

    await waitFor(() => expect(mockCreateExchange).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Gardening help',
      description: 'I can help with weeding and pruning.',
      type: 'offer',
      hours_estimate: 1,
      category_id: 2,
      location: 'Dublin',
      service_type: 'hybrid',
    })));
    expect(mockSetExchangeTags).toHaveBeenCalledWith(9, ['gardening', 'pruning']);
    expect(mockUploadExchangeImage).toHaveBeenCalledWith(9, 'file:///tmp/listing.jpg');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/(modals)/exchange-detail', params: { id: '9' } }));
  });

  it('warns when the listing is saved but the image upload fails', async () => {
    mockUploadExchangeImage.mockRejectedValue(new Error('Upload failed'));
    const { getByPlaceholderText, getByText } = render(<NewExchangeModal />);
    fireEvent.changeText(getByPlaceholderText('What are you offering?'), 'Gardening help');
    fireEvent.changeText(getByPlaceholderText('Add more details...'), 'I can help with weeding and pruning.');
    fireEvent.press(getByText('Teaching'));
    fireEvent.press(getByText('Add image'));
    await waitFor(() => expect(mockLaunchImageLibraryAsync).toHaveBeenCalled());
    fireEvent.press(getByText('Post Offer'));

    await waitFor(() => expect(mockUploadExchangeImage).toHaveBeenCalledWith(9, 'file:///tmp/listing.jpg'));
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Listing saved', description: 'Image upload failed', variant: 'danger' }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/(modals)/exchange-detail', params: { id: '9' } }));
  });

  it('generates a description from the listing context', async () => {
    const { getByPlaceholderText, getByText } = render(<NewExchangeModal />);
    fireEvent.changeText(getByPlaceholderText('What are you offering?'), 'Gardening help');
    fireEvent.press(getByText('Teaching'));
    fireEvent.press(getByText('Help write description'));

    await waitFor(() => expect(mockGenerateExchangeDescription).toHaveBeenCalledWith({
      title: 'Gardening help',
      category: 'Teaching',
      type: 'offer',
      notes: '',
    }));
    expect(getByPlaceholderText('Add more details...').props.value).toBe('Generated listing body');
  });

  it('adds optional service details into the saved description', async () => {
    const { getAllByText, getByPlaceholderText, getByText } = render(<NewExchangeModal />);
    fireEvent.changeText(getByPlaceholderText('What are you offering?'), 'Music lesson');
    fireEvent.changeText(getByPlaceholderText('Add more details...'), 'I can help with beginner guitar.');
    fireEvent.press(getByText('Gardening'));
    fireEvent.press(getAllByText('Optional service details')[1]);
    fireEvent.press(getByText('Beginner-friendly'));
    fireEvent.press(getByText("I'll provide everything needed"));
    fireEvent.changeText(getByPlaceholderText('Accessibility notes'), 'Ground floor room');
    fireEvent.press(getByText('Post Offer'));

    await waitFor(() => expect(mockCreateExchange).toHaveBeenCalledWith(expect.objectContaining({
      description: [
        'I can help with beginner guitar.',
        '',
        '---',
        'Experience: Beginner-friendly',
        "Equipment: I'll provide everything needed",
        'Accessibility: Ground floor room',
      ].join('\n'),
    })));
  });
});

/*
  Regressions from the 2026-09-05 native-app audit. Each of these was a reproduced
  defect, not a hypothetical: the audit's own fixtures asserted the broken behaviour.
*/
describe('NewExchangeModal — audit 2026-09-05 regressions', () => {
  function fillValidListing(screen: ReturnType<typeof render>) {
    fireEvent.changeText(screen.getByPlaceholderText('What are you offering?'), 'Gardening help');
    fireEvent.changeText(screen.getByPlaceholderText('Add more details...'), 'I can help with weeding and pruning.');
  }

  beforeEach(() => {
    for (const key of Object.keys(mockNavListeners)) delete mockNavListeners[key];
    mockNavDispatch.mockClear();
  });

  /**
   * 🔴 F01. A rejected save used to show its error for a frame and then run the same
   * navigation block as a success — back, or replace with the listings tab — taking
   * every typed field with it.
   */
  it('stays on the form with the input intact when the save is rejected', async () => {
    mockCreateExchange.mockRejectedValue(new Error('offline'));
    const screen = render(<NewExchangeModal />);
    fillValidListing(screen);
    fireEvent.press(screen.getByText('Teaching'));

    fireEvent.press(screen.getByText('Post Offer'));
    await waitFor(() => expect(mockCreateExchange).toHaveBeenCalled());
    // The old navigation ran on a 0ms timer; give it every chance to fire.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Gardening help')).toBeTruthy();
    expect(screen.getByDisplayValue('I can help with weeding and pruning.')).toBeTruthy();
    expect(screen.getByText(/createError|Failed to create/)).toBeTruthy();
  });

  /**
   * 🔴 F02. Reading only `data` from useApi made a failed category request look like
   * "no categories": the picker and even its required-field error disappeared, so the
   * form looked fillable but could never be submitted, with no explanation.
   */
  it('says categories failed to load, offers a retry, and explains why publishing is blocked', async () => {
    const refresh = jest.fn();
    mockUseApi.mockReturnValue({ data: null, isLoading: false, error: 'Network error', refresh });
    const screen = render(<NewExchangeModal />);

    expect(screen.getByTestId('new-exchange-categories-failed')).toBeTruthy();
    fireEvent.press(screen.getByText(/categoriesRetry|Try again/));
    expect(refresh).toHaveBeenCalled();

    fillValidListing(screen);
    fireEvent.press(screen.getByText('Post Offer'));
    await act(async () => {});

    expect(mockCreateExchange).not.toHaveBeenCalled();
    expect(screen.getByText(/categoriesUnavailable|none could be loaded/)).toBeTruthy();
    // Input survives the failed attempt so a retry costs nothing.
    expect(screen.getByDisplayValue('Gardening help')).toBeTruthy();
  });

  it('distinguishes categories still loading from a community that has none', () => {
    mockUseApi.mockReturnValue({ data: null, isLoading: true, error: null, refresh: jest.fn() });
    expect(render(<NewExchangeModal />).getByTestId('new-exchange-categories-loading')).toBeTruthy();

    mockUseApi.mockReturnValue({ data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() });
    expect(render(<NewExchangeModal />).getByTestId('new-exchange-categories-empty')).toBeTruthy();
  });

  /**
   * F04. Tags used to fail silently (`.catch(() => null)`): the listing existed, the
   * tags did not, and the member never knew. The listing is still opened — retrying
   * the whole creation is how duplicates are made.
   */
  it('reports that the listing was saved but its tags were not', async () => {
    mockSetExchangeTags.mockRejectedValue(new Error('tags down'));
    const screen = render(<NewExchangeModal />);
    fillValidListing(screen);
    fireEvent.changeText(screen.getByPlaceholderText('gardening, mentoring'), 'gardening, pruning');
    fireEvent.press(screen.getByText('Teaching'));

    fireEvent.press(screen.getByText('Post Offer'));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringMatching(/tagsSaveFailedTitle|Listing saved/),
      variant: 'danger',
    })));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/(modals)/exchange-detail', params: { id: '9' } }));
    expect(mockCreateExchange).toHaveBeenCalledTimes(1);
  });

  /**
   * F05. Back, Cancel, the Android back button and an iOS swipe all pop the screen via
   * `beforeRemove`; with unsaved input the guard holds the screen and asks first.
   */
  it('asks before discarding unsaved input, and lets a clean form leave freely', () => {
    const screen = render(<NewExchangeModal />);
    expect(isGuardArmed()).toBe(false);

    fireEvent.changeText(screen.getByPlaceholderText('What are you offering?'), 'Half-typed title');
    expect(isGuardArmed()).toBe(true);

    firePreventedRemoval();
    expect(mockNavDispatch).not.toHaveBeenCalled();
  });

  /** F06. Half the app's locales type decimals with a comma. */
  it('accepts a comma decimal for time credits', async () => {
    const screen = render(<NewExchangeModal />);
    fillValidListing(screen);
    fireEvent.press(screen.getByText('Teaching'));
    fireEvent.changeText(screen.getByDisplayValue('1'), '1,5');

    fireEvent.press(screen.getByText('Post Offer'));

    await waitFor(() => expect(mockCreateExchange).toHaveBeenCalledWith(expect.objectContaining({ hours_estimate: 1.5 })));
  });
});
