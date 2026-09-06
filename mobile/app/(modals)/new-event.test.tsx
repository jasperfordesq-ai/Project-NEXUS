// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockCreateEvent = jest.fn().mockResolvedValue({ data: { id: 6 } });
const mockCreateRecurringEvent = jest.fn().mockResolvedValue({ data: { template: { id: 60 }, occurrences_created: 10 } });
const mockCommitEventRecurrenceRevision = jest.fn();
const mockGetEvent = jest.fn();
const mockGetEventCategories = jest.fn();
const mockGetEventRecurrenceCapabilities = jest.fn();
const mockUpdateEvent = jest.fn().mockResolvedValue({ data: { id: 7 } });
const mockUpdateRecurringEvent = jest.fn().mockResolvedValue({ data: { id: 7 } });
const mockPreviewEventRecurrenceRevision = jest.fn();
const mockUploadEventImage = jest.fn();
const mockLaunchImageLibraryAsync = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockConfirm = jest.fn();
// The unsaved-changes guard subscribes to `beforeRemove`; capture the handler so a test
// can fire it the way Back / a swipe would.
const mockNavListeners: Record<string, (e: unknown) => void> = {};
const mockNavDispatch = jest.fn();
let mockSearchParams: Record<string, string> = {};
const v2RecurrenceCapabilitiesResponse = {
  data: {
    contract_version: 1,
    engine: 'v2',
    structured_input: true,
    supported_frequencies: ['daily', 'weekly', 'monthly', 'yearly'],
    max_occurrences: 366,
    supported_end_types: ['after_count', 'on_date', 'never'],
    supports_rolling_never: true,
    supports_effective_revisions: true,
    supports_definition_blueprints: false,
    schema_ready: true,
    rollout_state: 'v2_rolling',
  },
};

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  router: {
    replace: (...args: unknown[]) => mockReplace(...args),
    back: (...args: unknown[]) => mockBack(...args),
    canGoBack: () => true,
  },
  useLocalSearchParams: () => mockSearchParams,
  useNavigation: () => ({
    addListener: (event: string, handler: (e: unknown) => void) => {
      mockNavListeners[event] = handler;
      return () => { delete mockNavListeners[event]; };
    },
    dispatch: (...args: unknown[]) => mockNavDispatch(...args),
  }),
}));

jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (...args: unknown[]) => mockConfirm(...args),
    confirmDialog: null,
  }),
}));
jest.mock('@/components/ui/LoadingSpinner', () => () => null);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'create.eyebrow': 'New event',
        'create.title': 'Create Event',
        'create.editTitle': 'Edit Event',
        'create.subtitle': 'Add a gathering.',
        'create.titleLabel': 'Title',
        'create.titlePlaceholder': 'What is happening?',
        'create.descriptionLabel': 'Description',
        'create.descriptionPlaceholder': 'Tell members what to expect.',
        'create.coverImageLabel': 'Cover image',
        'create.coverImageHint': 'Add a photo.',
        'create.addImage': 'Add image',
        'create.replaceImage': 'Replace image',
        'create.removeImage': 'Remove',
        'create.imageTypeError': 'Choose a JPEG, PNG, WebP, or GIF image.',
        'create.imageSizeError': 'Choose an image under 5 MB.',
        'create.imagePickFailedTitle': 'Image not selected',
        'create.imagePickFailedDescription': 'We could not open your photo library.',
        'create.imageUploadFailedTitle': 'Event saved',
        'create.imageUploadFailedDescription': 'The event was saved, but the cover image could not be uploaded.',
        'create.categoryLabel': 'Category',
        'create.startLabel': 'Start',
        'create.endLabel': 'End',
        'create.timezoneLabel': 'Event time zone',
        'create.timezonePlaceholder': 'Europe/Dublin',
        'create.timezoneHint': 'Use an IANA time zone.',
        'create.allDay': 'All-day event',
        'create.allDayEndLabel': 'Final event day',
        'create.dateOnlyPlaceholder': 'YYYY-MM-DD',
        'create.datePlaceholder': 'YYYY-MM-DDTHH:mm',
        'create.optionalDatePlaceholder': 'Optional end time',
        'create.locationLabel': 'Location',
        'create.locationPlaceholder': 'Venue, town, or meeting place',
        'create.coordinatesLabel': 'Map coordinates',
        'create.coordinatesHint': 'Optional coordinates help maps and nearby event discovery place this event accurately.',
        'create.latitudeLabel': 'Latitude',
        'create.latitudePlaceholder': '51.5007',
        'create.longitudeLabel': 'Longitude',
        'create.longitudePlaceholder': '-0.1246',
        'create.venueAccessibilityTitle': 'Venue accessibility',
        'create.venueAccessibilityHint': 'Share confirmed information.',
        'create.venueAccessibilityFeatures.step_free_access': 'Step-free access',
        'create.venueAccessibilityFeatures.accessible_toilet': 'Accessible toilet',
        'create.venueAccessibilityFeatures.hearing_loop': 'Hearing loop',
        'create.venueAccessibilityFeatures.quiet_space': 'Quiet space',
        'create.venueAccessibilityFeatures.seating_available': 'Seating available',
        'create.venueAccessibilityFeatures.accessible_parking': 'Accessible parking',
        'create.venueAccessibilityStatus.unknown': 'Not known',
        'create.venueAccessibilityStatus.yes': 'Yes',
        'create.venueAccessibilityStatus.no': 'No',
        'create.venueAccessibilityParkingDetails': 'Accessible parking details',
        'create.venueAccessibilityParkingPlaceholder': 'Spaces, access route, or booking instructions',
        'create.venueAccessibilityTransitDetails': 'Public transport and arrival details',
        'create.venueAccessibilityTransitPlaceholder': 'Nearest stop, station, or drop-off point',
        'create.venueAccessibilityAssistanceContact': 'Accessibility contact',
        'create.venueAccessibilityAssistancePlaceholder': 'Name, email, or phone for assistance',
        'create.venueAccessibilityNotes': 'Other accessibility notes',
        'create.venueAccessibilityNotesPlaceholder': 'Anything else members should know',
        'create.venueAccessibilityPrivacy': 'Share safe contact details only.',
        'create.remoteAttendance': 'Allow remote attendance',
        'create.videoUrlLabel': 'Video link',
        'create.videoUrlPlaceholder': 'https://...',
        'create.maxAttendeesLabel': 'Capacity',
        'create.maxAttendeesPlaceholder': 'Optional attendee limit',
        'create.federated': 'Share with federation',
        'create.recurrenceTitle': 'Repeating schedule',
        'create.recurrenceToggle': 'Make this a recurring event',
        'create.recurrenceFrequency': 'Frequency',
        'create.recurrenceFrequencies.daily': 'Daily',
        'create.recurrenceFrequencies.weekly': 'Weekly',
        'create.recurrenceFrequencies.biweekly': 'Every two weeks',
        'create.recurrenceFrequencies.monthly': 'Monthly',
        'create.recurrenceFrequencies.yearly': 'Yearly',
        'create.recurrenceDays': 'Repeat on',
        'create.recurrenceWeekdays.MO': 'Mon',
        'create.recurrenceWeekdays.TU': 'Tue',
        'create.recurrenceWeekdays.WE': 'Wed',
        'create.recurrenceWeekdays.TH': 'Thu',
        'create.recurrenceWeekdays.FR': 'Fri',
        'create.recurrenceWeekdays.SA': 'Sat',
        'create.recurrenceWeekdays.SU': 'Sun',
        'create.recurrenceEnds': 'Ends',
        'create.recurrenceEndTypes.after_count': 'After a number of events',
        'create.recurrenceEndTypes.on_date': 'On a date',
        'create.recurrenceEndTypes.never': 'Never',
        'create.recurrenceCount': 'Number of events',
        'create.recurrenceCountPlaceholder': '2 to {{max}}',
        'create.recurrenceEndDate': 'Series end date',
        'create.recurrenceNeverHint': 'Future dates are added automatically.',
        'create.recurrenceValidation': 'Choose valid recurrence details.',
        'create.recurrenceEditScope': 'Apply changes to',
        'create.recurrenceScopeSingle': 'Only this event',
        'create.recurrenceScopeFuture': 'This and future events',
        'create.recurrenceScopeSingleHint': 'Only this occurrence.',
        'create.recurrenceScopeFutureHint': 'Preview the impact.',
        'create.revisionPreview': 'Preview changes',
        'create.revisionImpactTitle': 'Review recurring changes',
        'create.revisionConfirm': 'Apply changes',
        'create.revisionPreviewStale': 'Preview is stale.',
        'create.revisionCommitFailed': 'Commit failed.',
        'create.reviewTitle': 'Ready to publish?',
        'create.reviewSubtitle': 'Review first.',
        'create.editReviewTitle': 'Ready to update?',
        'create.editReviewSubtitle': 'Save your changes.',
        'create.submit': 'Create event',
        'create.updateSubmit': 'Update event',
        'create.validationTitle': 'Check event details',
        'create.validationStartFuture': 'Choose a future start time.',
        'create.validationEndAfterStart': 'End time must be after the start time.',
        'create.validationCapacity': 'Capacity must be between 1 and 10,000.',
        'create.invalidCoordinates': 'Enter both latitude and longitude using valid coordinate ranges.',
        'create.loadFailed': 'Could not load event.',
        'create.loadFailedTitle': "Couldn't open this event",
        'create.validationDateFormat': 'Enter dates as YYYY-MM-DDTHH:mm.',
        'create.reviewMissing': 'Add a title, description and start time before continuing.',
        'create.unsavedTitle': 'Discard this event?',
        'create.unsavedMessage': 'You have unsaved details.',
        'create.discard': 'Discard',
        'create.failedTitle': 'Event not created',
        'create.failedDescription': 'We could not create the event.',
        'common:buttons.retry': 'Retry',
        'common:buttons.cancel': 'Cancel',
        'category.workshop': 'Workshop',
        'category.social': 'Social',
        'category.outdoor': 'Outdoor',
        'category.online': 'Online',
        'category.meeting': 'Meeting',
        'category.training': 'Training',
        'category.other': 'Other',
        'common:back': 'Back',
      };
      let value = map[key] ?? key;
      Object.entries(options ?? {}).forEach(([name, replacement]) => {
        value = value.split(`{{${name}}}`).join(String(replacement));
      });
      return value;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
    error: '#e53e3e',
  }),
}));

jest.mock('@/lib/api/events', () => ({
  createEvent: (...args: unknown[]) => mockCreateEvent(...args),
  createRecurringEvent: (...args: unknown[]) => mockCreateRecurringEvent(...args),
  commitEventRecurrenceRevision: (...args: unknown[]) => mockCommitEventRecurrenceRevision(...args),
  getEvent: (...args: unknown[]) => mockGetEvent(...args),
  getEventCategories: (...args: unknown[]) => mockGetEventCategories(...args),
  getEventRecurrenceCapabilities: (...args: unknown[]) => mockGetEventRecurrenceCapabilities(...args),
  previewEventRecurrenceRevision: (...args: unknown[]) => mockPreviewEventRecurrenceRevision(...args),
  updateEvent: (...args: unknown[]) => mockUpdateEvent(...args),
  updateRecurringEvent: (...args: unknown[]) => mockUpdateRecurringEvent(...args),
  uploadEventImage: (...args: unknown[]) => mockUploadEventImage(...args),
}));

jest.mock('expo-crypto', () => ({ randomUUID: () => 'mobile-revision-key-1' }));

jest.mock('@/lib/haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success' },
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('expo-image', () => ({ Image: 'View' }));
jest.mock('expo-image-picker', () => ({
  MediaTypeOptions: { Images: 'Images' },
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibraryAsync(...args),
}));
jest.mock('@/components/ui/AppTopBar', () => 'View');

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

jest.mock('@/components/ui/FormActionFooter', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return function MockFormActionFooter({ subtitle, submitLabel, isDisabled, onSubmit }: { subtitle: string; submitLabel: string; isDisabled?: boolean; onSubmit: () => void }) {
    return (
      <View>
        <Text>{subtitle}</Text>
        <Pressable accessibilityRole="button" testID="footer-submit" accessibilityState={{ disabled: !!isDisabled }} onPress={onSubmit}>
          <Text>{submitLabel}</Text>
        </Pressable>
      </View>
    );
  };
});

jest.mock('heroui-native', () => {
  const React = require('react');
  const { Pressable, Text, TextInput, View } = require('react-native');
  const Button = ({ children, onPress, accessibilityLabel, accessibilityState }: { children: React.ReactNode; onPress?: () => void; accessibilityLabel?: string; accessibilityState?: Record<string, unknown> }) => (
    <Pressable onPress={onPress} accessibilityLabel={accessibilityLabel} accessibilityState={accessibilityState}>
      <View>{children}</View>
    </Pressable>
  );
  Button.Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  const Card = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Card.Body = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  const TagGroupContext = React.createContext(null);
  const TagGroup = ({ children, onSelectionChange }: { children: React.ReactNode; onSelectionChange?: (keys: Set<string | number>) => void }) => (
    <TagGroupContext.Provider value={{ onSelectionChange }}>
      <View>{children}</View>
    </TagGroupContext.Provider>
  );
  TagGroup.List = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  TagGroup.Item = ({ children, id }: { children: React.ReactNode; id: string | number }) => {
    const ctx = React.useContext(TagGroupContext);
    return (
      <Pressable onPress={() => ctx?.onSelectionChange?.(new Set([id]))}>
        <View>{children}</View>
      </Pressable>
    );
  };
  TagGroup.ItemLabel = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  return {
    Button,
    Card,
    Text,
    TextField: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    Label: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    Input: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => <TextInput ref={ref} {...props} />),
    FieldError: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    TagGroup,
  };
});

import NewEventRoute from './new-event';
import { useAppToast } from '@/components/ui/AppToast';
import { firePreventedRemoval, isGuardArmed } from '@/lib/test/unsavedGuardHarness';

const showToast = useAppToast().show as jest.Mock;
const sharedEvent = require('../../../contracts/events/v2/event-detail.json');
const canonicalEditEvent = {
  ...sharedEvent,
  id: 7,
  title: 'Existing workshop',
  description: 'Existing details for attendees.',
  schedule: {
    ...sharedEvent.schedule,
    start_at: '2099-01-02T12:00:00.000Z',
    end_at: '2099-01-02T13:00:00.000Z',
  },
  location: {
    ...sharedEvent.location,
    label: 'Old hall',
    latitude: 51.5,
    longitude: -0.12,
    mode: 'hybrid',
  },
  online_access: {
    ...sharedEvent.online_access,
    mode: 'hybrid',
    reveal_state: 'available',
    join_url: 'https://meet.example/old',
  },
  relationship: {
    ...sharedEvent.relationship,
    capacity: { ...sharedEvent.relationship.capacity, limit: 25 },
  },
  category: { id: 4, name: 'Workshop', slug: 'workshop', colour: '#f59e0b' },
  permissions: { ...sharedEvent.permissions, edit: true },
  federated_visibility: 'listed',
};

describe('NewEventRoute', () => {
  beforeEach(() => {
    showToast.mockClear();
    mockSearchParams = {};
    mockCreateEvent.mockClear();
    mockCreateRecurringEvent.mockClear();
    mockCommitEventRecurrenceRevision.mockReset();
    mockGetEvent.mockReset();
    mockGetEventCategories.mockReset().mockReturnValue(new Promise(() => undefined));
    mockGetEventRecurrenceCapabilities.mockReset().mockReturnValue(new Promise(() => undefined));
    mockUpdateEvent.mockClear();
    mockUpdateRecurringEvent.mockClear();
    mockPreviewEventRecurrenceRevision.mockReset();
    mockUploadEventImage.mockReset().mockResolvedValue({ data: { image_url: '/uploads/events/cover.jpg' } });
    mockLaunchImageLibraryAsync.mockReset().mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/event-cover.jpg', mimeType: 'image/jpeg', fileSize: 1024 }],
    });
    mockReplace.mockClear();
    mockBack.mockClear();
    mockConfirm.mockClear();
    mockNavDispatch.mockClear();
    Object.keys(mockNavListeners).forEach((key) => { delete mockNavListeners[key]; });
  });

  it('keeps the native create event frame full height with an explicit background', () => {
    const { getByTestId } = render(<NewEventRoute />);
    const screen = getByTestId('new-event-screen');
    const scroll = getByTestId('new-event-scroll');

    expect(screen.props.style).toEqual(expect.objectContaining({
      flex: 1,
      backgroundColor: '#ffffff',
    }));
    expect(scroll.props.style).toEqual(expect.objectContaining({
      flex: 1,
      backgroundColor: '#ffffff',
    }));
    expect(scroll.props.contentContainerStyle).toEqual(expect.objectContaining({
      flexGrow: 1,
      backgroundColor: '#ffffff',
      paddingBottom: 120,
    }));
  });

  it('blocks event starts in the past', async () => {
    const { getByPlaceholderText, getByText } = render(<NewEventRoute />);

    fireEvent.changeText(getByPlaceholderText('What is happening?'), 'Repair workshop');
    fireEvent.changeText(getByPlaceholderText('Tell members what to expect.'), 'Bring something small to mend together.');
    fireEvent.changeText(getByPlaceholderText('YYYY-MM-DDTHH:mm'), '2000-01-01T09:00');
    fireEvent.press(getByText('Create event'));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith({ title: 'Check event details', description: 'Choose a future start time.', variant: 'warning' });
    });
    expect(mockCreateEvent).not.toHaveBeenCalled();
  });

  it('blocks end times before the start time', async () => {
    const { getByPlaceholderText, getByText } = render(<NewEventRoute />);

    fireEvent.changeText(getByPlaceholderText('What is happening?'), 'Repair workshop');
    fireEvent.changeText(getByPlaceholderText('Tell members what to expect.'), 'Bring something small to mend together.');
    fireEvent.changeText(getByPlaceholderText('YYYY-MM-DDTHH:mm'), '2099-01-02T12:00');
    fireEvent.changeText(getByPlaceholderText('Optional end time'), '2099-01-02T11:00');
    fireEvent.press(getByText('Create event'));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith({ title: 'Check event details', description: 'End time must be after the start time.', variant: 'warning' });
    });
    expect(mockCreateEvent).not.toHaveBeenCalled();
  });

  it('blocks capacity outside the supported range', async () => {
    const { getByPlaceholderText, getByText } = render(<NewEventRoute />);

    fireEvent.changeText(getByPlaceholderText('What is happening?'), 'Repair workshop');
    fireEvent.changeText(getByPlaceholderText('Tell members what to expect.'), 'Bring something small to mend together.');
    fireEvent.changeText(getByPlaceholderText('Optional attendee limit'), '0');
    fireEvent.press(getByText('Create event'));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith({ title: 'Check event details', description: 'Capacity must be between 1 and 10,000.', variant: 'warning' });
    });
    expect(mockCreateEvent).not.toHaveBeenCalled();
  });

  it('requires paired valid coordinates when coordinates are provided', async () => {
    const { getByPlaceholderText, getByText } = render(<NewEventRoute />);

    fireEvent.changeText(getByPlaceholderText('What is happening?'), 'Repair workshop');
    fireEvent.changeText(getByPlaceholderText('Tell members what to expect.'), 'Bring something small to mend together.');
    fireEvent.changeText(getByPlaceholderText('51.5007'), '91');
    fireEvent.changeText(getByPlaceholderText('-0.1246'), '-0.1246');
    fireEvent.press(getByText('Create event'));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith({ title: 'Check event details', description: 'Enter both latitude and longitude using valid coordinate ranges.', variant: 'warning' });
    });
    expect(mockCreateEvent).not.toHaveBeenCalled();
  });

  it('submits category and remote attendance fields using the event API contract', async () => {
    const { getByPlaceholderText, getByText } = render(<NewEventRoute />);

    fireEvent.changeText(getByPlaceholderText('What is happening?'), 'Repair workshop');
    fireEvent.changeText(getByPlaceholderText('Tell members what to expect.'), 'Bring something small to mend.');
    fireEvent.changeText(getByPlaceholderText('Venue, town, or meeting place'), 'Community hall');
    fireEvent.changeText(getByPlaceholderText('51.5007'), '51.501');
    fireEvent.changeText(getByPlaceholderText('-0.1246'), '-0.125');
    fireEvent.press(getByText('Workshop'));
    fireEvent.press(getByText('Allow remote attendance'));
    fireEvent.changeText(getByPlaceholderText('https://...'), 'https://meet.example/workshop');
    fireEvent.press(getByText('Create event'));

    await waitFor(() => {
      expect(mockCreateEvent).toHaveBeenCalledWith(expect.objectContaining({
        category_id: null,
        category_name: 'workshop',
        location: 'Community hall',
        latitude: 51.501,
        longitude: -0.125,
        is_online: true,
        allow_remote_attendance: true,
        video_url: 'https://meet.example/workshop',
        timezone: expect.any(String),
        all_day: false,
      }));
    });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/(modals)/event-detail', params: { id: '6' } }));
  });

  it('creates canonical venue-accessibility facts', async () => {
    const { getAllByText, getByPlaceholderText, getByText } = render(<NewEventRoute />);

    fireEvent.changeText(getByPlaceholderText('What is happening?'), 'Accessible repair workshop');
    fireEvent.changeText(getByPlaceholderText('Tell members what to expect.'), 'A detailed workshop with confirmed venue access information.');
    fireEvent.press(getAllByText('Yes')[0]);
    fireEvent.changeText(getByPlaceholderText('Spaces, access route, or booking instructions'), 'Two bays beside the east entrance');
    fireEvent.changeText(getByPlaceholderText('Name, email, or phone for assistance'), 'access@example.test');
    fireEvent.press(getByText('Create event'));

    await waitFor(() => expect(mockCreateEvent).toHaveBeenCalledWith(expect.objectContaining({
      venue_accessibility: expect.objectContaining({
        step_free_access: true,
        parking_details: 'Two bays beside the east entrance',
        assistance_contact: 'access@example.test',
      }),
    })));
  });

  it('creates a structured biweekly never-ending series without a client-authored RRULE', async () => {
    mockGetEventRecurrenceCapabilities.mockResolvedValueOnce(v2RecurrenceCapabilitiesResponse);
    const { getByPlaceholderText, getByText } = render(<NewEventRoute />);

    fireEvent.changeText(getByPlaceholderText('What is happening?'), 'Recurring repair workshop');
    fireEvent.changeText(getByPlaceholderText('Tell members what to expect.'), 'Bring something small to mend together.');
    fireEvent.press(getByText('Make this a recurring event'));
    await waitFor(() => expect(getByText('Never')).toBeTruthy());
    fireEvent.press(getByText('Every two weeks'));
    fireEvent.press(getByText('Mon'));
    fireEvent.press(getByText('Never'));
    fireEvent.press(getByText('Create event'));

    await waitFor(() => expect(mockCreateRecurringEvent).toHaveBeenCalledWith(expect.objectContaining({
      recurrence_frequency: 'weekly',
      recurrence_interval: 2,
      recurrence_days: 'MO',
      recurrence_ends_type: 'never',
    })));
    const payload = mockCreateRecurringEvent.mock.calls[0][0];
    expect(payload).not.toHaveProperty('recurrence_rule');
    expect(payload).not.toHaveProperty('recurrence_rrule');
    expect(mockCreateEvent).not.toHaveBeenCalled();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)/events'));
  });

  it('falls back to legacy recurrence limits when runtime capability negotiation fails', async () => {
    mockGetEventRecurrenceCapabilities.mockRejectedValueOnce(new Error('offline'));

    const { getByPlaceholderText, getByText, queryByText } = render(<NewEventRoute />);
    await waitFor(() => expect(mockGetEventRecurrenceCapabilities).toHaveBeenCalledTimes(1));
    fireEvent.press(getByText('Make this a recurring event'));

    expect(getByPlaceholderText('2 to 52')).toBeTruthy();
    expect(queryByText('Never')).toBeNull();
  });

  it('previews and commits this-and-future edits instead of using the generic update endpoint', async () => {
    mockGetEventRecurrenceCapabilities.mockResolvedValueOnce(v2RecurrenceCapabilitiesResponse);
    mockSearchParams = { id: '7' };
    mockGetEvent.mockResolvedValueOnce({
      data: {
        ...canonicalEditEvent,
        series: {
          ...canonicalEditEvent.series,
          recurrence: {
            parent_event_id: 70,
            root_event_id: 70,
            is_template: false,
            frequency: 'weekly',
            interval: 1,
            rrule: 'FREQ=WEEKLY;COUNT=10',
            occurrence_count: 10,
            occurrences: [],
          },
        },
      },
    });
    mockPreviewEventRecurrenceRevision.mockResolvedValue({
      data: {
        preview_token: 'preview-token',
        preview_expires_at: '2099-01-01T00:05:00Z',
        scope: 'this_and_future',
        selected_event_id: 7,
        root_event_id: 70,
        effective_from_utc: '2099-01-02 12:00:00',
        can_commit: true,
        impact: {
          changed_count: 4,
          unique_recipient_count: 2,
          blocking_conflicts: [],
        },
      },
    });
    mockCommitEventRecurrenceRevision
      .mockRejectedValueOnce(new Error('lost response'))
      .mockResolvedValueOnce({ data: { revision_id: 8 } });

    const { getByDisplayValue, getByPlaceholderText, getByText } = render(<NewEventRoute />);
    await waitFor(() => expect(getByDisplayValue('Existing workshop')).toBeTruthy());
    fireEvent.changeText(getByDisplayValue('Existing workshop'), 'Updated future workshops');
    fireEvent.press(getByText('This and future events'));
    fireEvent.press(getByText('Preview changes'));

    await waitFor(() => expect(mockPreviewEventRecurrenceRevision).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ title: 'Updated future workshops' }),
    ));
    expect(mockUpdateEvent).not.toHaveBeenCalled();
    expect(mockUpdateRecurringEvent).not.toHaveBeenCalled();

    fireEvent.changeText(getByPlaceholderText('Anything else members should know'), 'Changed after preview');
    fireEvent.press(getByText('Apply changes'));
    expect(mockCommitEventRecurrenceRevision).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Preview is stale.' }));

    fireEvent.press(getByText('Preview changes'));
    await waitFor(() => expect(mockPreviewEventRecurrenceRevision).toHaveBeenCalledTimes(2));
    fireEvent.press(getByText('Apply changes'));
    await waitFor(() => expect(mockCommitEventRecurrenceRevision).toHaveBeenCalledTimes(1));
    fireEvent.press(getByText('Apply changes'));
    await waitFor(() => expect(mockCommitEventRecurrenceRevision).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ accessibility_notes: 'Changed after preview' }),
      'preview-token',
      'mobile-revision-key-1',
    ));
    expect(mockCommitEventRecurrenceRevision.mock.calls[0][3]).toBe('mobile-revision-key-1');
    expect(mockCommitEventRecurrenceRevision.mock.calls[1][3]).toBe('mobile-revision-key-1');
  });

  it('converts an inclusive all-day range in the selected IANA timezone', async () => {
    const { getAllByPlaceholderText, getByPlaceholderText, getByText } = render(<NewEventRoute />);

    fireEvent.changeText(getByPlaceholderText('What is happening?'), 'Brisbane community weekend');
    fireEvent.changeText(getByPlaceholderText('Tell members what to expect.'), 'A two-day community programme.');
    fireEvent.changeText(getByPlaceholderText('Europe/Dublin'), 'Australia/Brisbane');
    fireEvent.press(getByText('All-day event'));
    const dateFields = getAllByPlaceholderText('YYYY-MM-DD');
    fireEvent.changeText(dateFields[0], '2099-01-02');
    fireEvent.changeText(dateFields[1], '2099-01-03');
    fireEvent.press(getByText('Create event'));

    await waitFor(() => {
      expect(mockCreateEvent).toHaveBeenCalledWith(expect.objectContaining({
        start_time: '2099-01-01T14:00:00.000Z',
        end_time: '2099-01-03T14:00:00.000Z',
        timezone: 'Australia/Brisbane',
        all_day: true,
      }));
    });
  });

  it('uploads a selected cover image after creating the event', async () => {
    const { getByPlaceholderText, getByText } = render(<NewEventRoute />);

    fireEvent.changeText(getByPlaceholderText('What is happening?'), 'Repair workshop');
    fireEvent.changeText(getByPlaceholderText('Tell members what to expect.'), 'Bring something small to mend.');
    fireEvent.press(getByText('Add image'));
    await waitFor(() => expect(mockLaunchImageLibraryAsync).toHaveBeenCalled());
    fireEvent.press(getByText('Create event'));

    await waitFor(() => {
      expect(mockCreateEvent).toHaveBeenCalled();
    });
    expect(mockUploadEventImage).toHaveBeenCalledWith(6, 'file:///tmp/event-cover.jpg');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/(modals)/event-detail', params: { id: '6' } }));
  });

  it('hydrates an existing event and updates it in edit mode', async () => {
    mockSearchParams = { id: '7' };
    mockGetEvent.mockResolvedValueOnce({ data: canonicalEditEvent });

    const { getByDisplayValue, getByText } = render(<NewEventRoute />);

    await waitFor(() => expect(getByDisplayValue('Existing workshop')).toBeTruthy());
    fireEvent.changeText(getByDisplayValue('Existing workshop'), 'Updated workshop');
    fireEvent.press(getByText('Update event'));

    await waitFor(() => {
      expect(mockUpdateEvent).toHaveBeenCalledWith(7, expect.objectContaining({
        title: 'Updated workshop',
        description: 'Existing details for attendees.',
        location: 'Old hall',
        latitude: 51.5,
        longitude: -0.12,
        category_id: 4,
        category_name: null,
        series_id: 12,
        is_online: true,
        video_url: 'https://meet.example/old',
        max_attendees: 25,
        federated_visibility: 'listed',
        timezone: canonicalEditEvent.schedule.timezone,
        all_day: canonicalEditEvent.schedule.all_day,
      }));
    });
    expect(mockCreateEvent).not.toHaveBeenCalled();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/(modals)/event-detail', params: { id: '7' } }));
  });

  it('does not submit a deep-linked edit when the server denies edit permission', async () => {
    mockSearchParams = { id: '7' };
    mockGetEvent.mockResolvedValueOnce({
      data: {
        ...canonicalEditEvent,
        permissions: { ...canonicalEditEvent.permissions, edit: false },
      },
    });

    const { getByText, queryByText } = render(<NewEventRoute />);

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Could not load event.',
      variant: 'danger',
    })));
    // S4-03: no form and no live submit over blank fields — the failure is shown with a retry.
    expect(queryByText('Update event')).toBeNull();
    expect(getByText("Couldn't open this event")).toBeTruthy();
    expect(mockUpdateEvent).not.toHaveBeenCalled();

    mockGetEvent.mockResolvedValueOnce({ data: canonicalEditEvent });
    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(mockGetEvent).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getByText('Update event')).toBeTruthy());
  });

  it('does not silently disable federation when v2 omits legacy visibility state', async () => {
    mockSearchParams = { id: '7' };
    const eventWithoutFederation: Partial<typeof canonicalEditEvent> = { ...canonicalEditEvent };
    delete eventWithoutFederation.federated_visibility;
    mockGetEvent.mockResolvedValueOnce({ data: eventWithoutFederation });

    const { getByDisplayValue, getByText } = render(<NewEventRoute />);

    await waitFor(() => expect(getByDisplayValue('Existing workshop')).toBeTruthy());
    fireEvent.press(getByText('Update event'));

    await waitFor(() => expect(mockUpdateEvent).toHaveBeenCalled());
    expect(mockUpdateEvent.mock.calls[0][1]).not.toEqual(expect.objectContaining({
      federated_visibility: 'none',
    }));
  });

  it('shows an existing cover image and uploads a replacement in edit mode', async () => {
    mockSearchParams = { id: '7' };
    mockGetEvent.mockResolvedValueOnce({
      data: {
        ...canonicalEditEvent,
        schedule: { ...canonicalEditEvent.schedule, end_at: null },
        location: { ...canonicalEditEvent.location, mode: 'in_person' },
        online_access: {
          ...canonicalEditEvent.online_access,
          mode: 'in_person',
          reveal_state: 'not_applicable',
          join_url: null,
          video_url: null,
        },
        relationship: {
          ...canonicalEditEvent.relationship,
          capacity: { ...canonicalEditEvent.relationship.capacity, limit: null },
        },
        federated_visibility: 'none',
        primary_image: { url: '/uploads/events/existing.jpg', alt_text: 'Existing workshop' },
      },
    });

    const { getByText } = render(<NewEventRoute />);

    await waitFor(() => expect(getByText('Replace image')).toBeTruthy());
    fireEvent.press(getByText('Replace image'));
    await waitFor(() => expect(mockLaunchImageLibraryAsync).toHaveBeenCalled());
    fireEvent.press(getByText('Update event'));

    await waitFor(() => expect(mockUpdateEvent).toHaveBeenCalled());
    expect(mockUploadEventImage).toHaveBeenCalledWith(7, 'file:///tmp/event-cover.jpg');
  });

  function fillValidEvent(screen: ReturnType<typeof render>) {
    fireEvent.changeText(screen.getByPlaceholderText('What is happening?'), 'Repair workshop');
    fireEvent.changeText(screen.getByPlaceholderText('Tell members what to expect.'), 'Bring something small to mend together.');
    fireEvent.changeText(screen.getByPlaceholderText('YYYY-MM-DDTHH:mm'), '2099-01-02T12:00');
  }

  /**
   * 🔴 S4-01. A rejected create used to toast for a frame and then run the same navigation
   * as a success, taking every typed field with it.
   */
  it('stays on the form with the input intact when the save is rejected', async () => {
    mockCreateEvent.mockRejectedValueOnce(new Error('offline'));
    const screen = render(<NewEventRoute />);
    fillValidEvent(screen);

    fireEvent.press(screen.getByText('Create event'));
    await waitFor(() => expect(mockCreateEvent).toHaveBeenCalled());
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Event not created', variant: 'danger' })));
    // The old navigation ran on a 0ms timer; give it every chance to fire.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Repair workshop')).toBeTruthy();
    expect(screen.getByDisplayValue('Bring something small to mend together.')).toBeTruthy();
  });

  /** S4-04. Back, Cancel and gestures pop the screen via `beforeRemove`; dirty input is guarded. */
  it('asks before discarding unsaved input, and lets an untouched form leave freely', () => {
    const screen = render(<NewEventRoute />);
    expect(isGuardArmed()).toBe(false);

    fireEvent.changeText(screen.getByPlaceholderText('What is happening?'), 'Half-typed title');
    expect(isGuardArmed()).toBe(true);

    firePreventedRemoval();
    expect(mockNavDispatch).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard this event?', variant: 'danger' }));
  });

  /** S4-05. Half the app's locales type decimals with a comma; coordinates too. */
  it('accepts comma decimals for coordinates', async () => {
    const screen = render(<NewEventRoute />);
    fillValidEvent(screen);
    fireEvent.changeText(screen.getByPlaceholderText('51.5007'), '51,5');
    fireEvent.changeText(screen.getByPlaceholderText('-0.1246'), '-0,12');

    fireEvent.press(screen.getByText('Create event'));

    await waitFor(() => expect(mockCreateEvent).toHaveBeenCalledWith(expect.objectContaining({ latitude: 51.5, longitude: -0.12 })));
  });

  /** S4-25. A mistyped date is a format problem, not a missing field. */
  it('reports a mistyped start as an invalid format rather than a missing field', async () => {
    const screen = render(<NewEventRoute />);
    fillValidEvent(screen);
    fireEvent.changeText(screen.getByPlaceholderText('YYYY-MM-DDTHH:mm'), 'next friday');

    fireEvent.press(screen.getByText('Create event'));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Enter dates as YYYY-MM-DDTHH:mm.' })));
    expect(showToast).not.toHaveBeenCalledWith(expect.objectContaining({ description: 'Add a title, description, and valid future start time.' }));
    expect(mockCreateEvent).not.toHaveBeenCalled();
  });

  /** S4-18. An event that has already started can still be edited when its start is left alone. */
  it('lets an already-started event be edited without touching its start, but not moved into the past', async () => {
    mockSearchParams = { id: '7' };
    mockGetEvent.mockResolvedValueOnce({
      data: {
        ...canonicalEditEvent,
        schedule: { ...canonicalEditEvent.schedule, start_at: '2001-01-02T12:00:00.000Z', end_at: null },
      },
    });

    const { getByDisplayValue, getByText, getByPlaceholderText } = render(<NewEventRoute />);
    await waitFor(() => expect(getByDisplayValue('Existing workshop')).toBeTruthy());

    fireEvent.changeText(getByDisplayValue('Existing workshop'), 'Renamed workshop');
    fireEvent.press(getByText('Update event'));
    await waitFor(() => expect(mockUpdateEvent).toHaveBeenCalledWith(7, expect.objectContaining({ title: 'Renamed workshop' })));

    fireEvent.changeText(getByPlaceholderText('YYYY-MM-DDTHH:mm'), '2001-01-03T12:00');
    fireEvent.press(getByText('Update event'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Choose a future start time.' })));
    expect(mockUpdateEvent).toHaveBeenCalledTimes(1);
  });

  /** S4-26. The toggle chips announce their state to assistive technology. */
  it('exposes the all-day toggle state to accessibility', () => {
    const { getByLabelText } = render(<NewEventRoute />);
    expect(getByLabelText('All-day event').props.accessibilityState).toEqual(expect.objectContaining({ selected: false }));
    fireEvent.press(getByLabelText('All-day event'));
    expect(getByLabelText('All-day event').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
  });

  /** S6-07. The footer says what is missing and is disabled until the required fields are filled. */
  it('derives the footer copy and disabled state from the required fields', () => {
    const screen = render(<NewEventRoute />);
    expect(screen.getByText('Add a title, description and start time before continuing.')).toBeTruthy();
    expect(screen.getByTestId('footer-submit').props.accessibilityState.disabled).toBe(true);

    fillValidEvent(screen);
    expect(screen.getByText('Review first.')).toBeTruthy();
    expect(screen.getByTestId('footer-submit').props.accessibilityState.disabled).toBe(false);
  });
});
