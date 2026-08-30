// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking, ScrollView, StyleSheet } from 'react-native';

// --- Mocks ---

const mockRouterPush = jest.fn();
const mockConfirm = jest.fn((opts: { onConfirm: () => void | Promise<void> }) => {
  void opts.onConfirm();
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockRouterPush, replace: jest.fn(), back: jest.fn() }),
  router: { push: (...args: unknown[]) => mockRouterPush(...args), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: '7' }),
  useNavigation: () => ({ setOptions: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'detail.title': 'Event Details',
        'detail.about': 'About this Event',
        'detail.organizer': 'Organizer',
        'detail.ownerTools': 'Event tools',
        'detail.edit': 'Edit',
        'detail.submitForReview': 'Submit for review',
        'detail.publishEvent': 'Publish event',
        'detail.submitForReviewConfirm': 'Submit this event for moderation?',
        'detail.publishEventConfirm': 'Publish this event now?',
        'detail.submittedForReview': 'Event submitted for review',
        'detail.publishedSuccessfully': 'Event published',
        'detail.publicationFailed': 'Publication failed',
        'lifecycleHistory.open': 'Open lifecycle history',
        'event_templates:templates.mobile.title': 'Event templates',
        'event_tickets:tickets.mobile.title': 'Event tickets',
        'event_tickets:tickets.mobile.gatewayDisabledDescription': 'Free tickets only. No wallet action is taken.',
        'event_tickets:tickets.mobile.catalogueTitle': 'Available tickets',
        'event_communications:title': 'Organizer communications',
        'event_communications:compose_description': 'Choose an exact event audience and delivery channels.',
        'event_communications:new_message': 'New message',
        'event_recurrence_blueprints:tab': 'Future setup',
        'event_recurrence_blueprints:definition_only_description': 'Definitions only; no participant records are copied.',
        'detail.organizerAttendance': 'Organizer attendance',
        'detail.loadingAttendees': 'Loading attendees',
        'detail.attendeesLoadError': 'Could not load attendees.',
        'detail.noAttendees': 'No attendees yet.',
        'detail.moreAttendees': opts ? `+${String(opts.count ?? 0)} more` : '+0 more',
        'detail.waitlistCount': opts ? `${String(opts.count ?? 0)} on the waitlist` : '0 on the waitlist',
        'detail.onWaitlistPosition': opts ? `You are on the waitlist: #${String(opts.position ?? '')}` : 'You are on the waitlist',
        'detail.checkInProgress': opts
          ? `${String(opts.checked ?? 0)} / ${String(opts.total ?? 0)} checked in`
          : '0 / 0 checked in',
        'detail.attendanceLoadError': 'Could not load attendance.',
        'detail.noCheckInAttendeesTitle': 'No check-ins yet',
        'detail.noCheckInAttendees': 'No attendees to check in yet.',
        'detail.attendeeGoing': 'Going',
        'detail.attendeeInterested': 'Interested',
        'detail.attendeeCheckedIn': 'Checked in',
        'detail.checkIn': 'Check in',
        'detail.checkingIn': 'Checking in',
        'detail.checkInError': 'Could not check in attendee.',
        'detail.checkInAttendeeLabel': opts ? `Check in ${String(opts.name ?? '')}` : 'Check in attendee',
        'attendance.title': 'Event check-in',
        'attendance.detailCta': 'Open the focused check-in workspace.',
        'attendance.openWorkspace': 'Open check-in',
        'allDay': 'All day',
        'detail.joinWaitlist': 'Join waitlist',
        'detail.leaveWaitlist': 'Leave waitlist',
        'detail.leaveWaitlistConfirmTitle': 'Leave the waitlist?',
        'detail.leaveWaitlistConfirmDescription': 'You will lose your current position.',
        'detail.offerDeclineConfirmTitle': 'Decline this reserved place?',
        'detail.offerDeclineConfirmDescription': 'The reserved place will be released.',
        'detail.joinWaitlistError': 'Could not join the waitlist.',
        'detail.leaveWaitlistError': 'Could not leave the waitlist.',
        'detail.offerAvailable': 'Place available',
        'detail.offerTitle': 'A place is available for you',
        'detail.offerDescription': 'Accept it to confirm your attendance.',
        'detail.acceptOffer': 'Accept place',
        'detail.declineOffer': 'Decline place',
        'detail.offerAccepted': 'Your place at the event is confirmed.',
        'detail.offerAcceptError': 'Could not accept the place.',
        'detail.offerDeclineError': 'Could not decline the place.',
        'detail.eventPolls': 'Event polls',
        'detail.loadingPolls': 'Loading polls',
        'detail.pollsLoadError': 'Could not load event polls.',
        'detail.pollVoteError': 'Could not submit your vote.',
        'detail.pollOptionFallback': 'Poll option',
        'detail.pollOptionResult': opts ? `${String(opts.label ?? '')} - ${String(opts.percent ?? 0)}%` : 'Poll option - 0%',
        'detail.pollTotalVotes': opts ? `${String(opts.count ?? 0)} votes` : '0 votes',
        'detail.communityMember': 'Community member',
        'agenda.title': 'Agenda',
        'agenda.loading': 'Loading agenda',
        'agenda.loadError': 'The event agenda could not be loaded.',
        'agenda.retry': 'Retry agenda',
        'agenda.sessionCount': opts ? `${String(opts.count ?? 0)} session` : '0 sessions',
        'agenda.starts': 'Starts',
        'agenda.ends': 'Ends',
        'agenda.track': 'Track',
        'agenda.room': 'Room',
        'agenda.speakers': 'Speakers',
        'agenda.speakerWithRole': opts ? `${String(opts.name ?? '')} — ${String(opts.role ?? '')}` : '',
        'agenda.speakerFallback': 'Guest speaker',
        'agenda.sessionAccessibility': opts
          ? `${String(opts.title ?? '')}. ${String(opts.type ?? '')}. ${String(opts.visibility ?? '')}. Starts ${String(opts.start ?? '')}. Ends ${String(opts.end ?? '')}. ${String(opts.details ?? '')}`
          : '',
        'agenda.type.session': 'Session',
        'agenda.type.keynote': 'Keynote',
        'agenda.type.workshop': 'Workshop',
        'agenda.type.panel': 'Panel',
        'agenda.type.break': 'Break',
        'agenda.type.networking': 'Networking',
        'agenda.type.other': 'Other',
        'agenda.visibility.public': 'Open to event viewers',
        'agenda.visibility.registered': 'Registered attendees',
        'agenda.visibility.staff': 'Event staff',
        'agenda.status.cancelled': 'Cancelled',
        'detail.invalidId': 'Invalid event ID.',
        'detail.notFound': 'Event not found.',
        'detail.goBack': 'Go Back',
        'going': 'Going',
        'interested': 'Interested',
        'onlineEvent': 'Online Event',
        'onlineTapToJoin': 'Tap to Join',
        'detail.joinOnline': 'Join online',
        'reminders.title': 'Reminders',
        'reminders.subtitle': 'Choose when Project NEXUS should remind you about this event.',
        'reminders.option.60': '1 hour before',
        'reminders.option.1440': '1 day before',
        'reminders.option.10080': '1 week before',
        'reminders.saved': 'Reminders updated.',
        'reminders.error': 'Could not update event reminders.',
        'reminders.enabled': 'Reminders enabled',
        'reminders.disabled': 'Reminders disabled',
        'reminders.timing': 'Reminder times',
        'reminders.customMinutes': 'Custom time in minutes',
        'reminders.addCustom': 'Add time',
        'reminders.channels': 'Delivery channels',
        'reminders.channel.email': 'Email',
        'reminders.channel.in_app': 'Notification bell',
        'reminders.channel.web_push': 'Web push',
        'reminders.channel.fcm': 'Mobile push',
        'reminders.resolved': opts ? `Reminder availability currently comes from ${String(opts.source ?? '')}.` : '',
        'reminders.source.event': 'this event',
        'reminders.save': 'Save reminders',
        'reminders.reset': 'Reset to defaults',
        'full': 'Full',
        'postponed': 'Postponed',
        'completed': 'Completed',
        'archived': 'Archived',
        'pendingReview': 'Pending review',
        'draft': 'Draft',
        'rsvpError': 'Failed to update RSVP.',
        'common:errors.alertTitle': 'Error',
        'common:buttons.cancel': 'Cancel',
        'attendees': opts
          ? `${String(opts.going ?? 0)} going · ${String(opts.interested ?? 0)} interested`
          : '0 going · 0 interested',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ hasFeature: () => true }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
    borderSubtle: '#eeeeee',
    error: '#e53e3e',
    success: '#22c55e',
    warning: '#f59e0b',
    info: '#3b82f6',
    errorBg: '#fee2e2',
    successBg: '#dcfce7',
    infoBg: '#dbeafe',
  }),
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, style }: { children: React.ReactNode; style?: unknown }) => (
      <View style={style}>{children}</View>
    ),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 24, left: 0 }),
  };
});

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 3, name: 'Current User' } }),
}));

const mockUseApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/components/events/EventSafetyCard', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return function MockEventSafetyCard() {
    return <Text testID="event-safety-card-stub">Participation requirements</Text>;
  };
});

jest.mock('@/components/events/EventAnalyticsSummaryCard', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    EventAnalyticsSummaryCard: () => <Text testID="event-analytics-card-stub">Event analytics</Text>,
  };
});

jest.mock('@/components/events/EventCheckinCredentialCard', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return () => <Text testID="event-checkin-credential-card-stub">Attendee check-in code</Text>;
});

jest.mock('@/components/events/EventRegistrationPanel', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return () => <Text testID="event-registration-panel-stub">Event registration</Text>;
});

jest.mock('@/components/events/EventAgendaEnterprisePanel', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    EventAgendaEnterprisePanel: () => (
      <Text testID="event-agenda-enterprise-panel-stub">Session registration</Text>
    ),
  };
});

jest.mock('@/lib/api/events', () => ({
  acceptEventWaitlistOffer: jest.fn().mockResolvedValue({
    data: {
      relationship: {
        registration: { state: 'confirmed' },
        waitlist: { state: 'accepted', position: 1, offer_active: false },
      },
      mutation: { changed: true, idempotent_replay: false, history_entry_id: 901, next_offer_created: false },
    },
  }),
  getEvent: jest.fn(),
  getEventAgenda: jest.fn().mockResolvedValue({
    data: {
      contract_version: 1,
      event_id: 7,
      agenda_version: 0,
      timezone: 'UTC',
      permissions: { manage: false },
      sessions: [],
    },
    meta: { base_url: 'https://test.api' },
  }),
  getEventOnlineLink: (event: { online_access: { reveal_state: string; join_url: string | null; video_url: string | null } }) =>
    event.online_access.reveal_state === 'available'
      ? event.online_access.join_url ?? event.online_access.video_url
      : null,
  rsvpEvent: jest.fn().mockResolvedValue({
    data: {
      contract_version: 2,
      event_id: 7,
      relationship: {
        engagement: { state: 'none', can_change: true },
        registration: { state: 'confirmed', waitlist_position: null, can_register: false, can_withdraw: true, can_join_waitlist: false, can_leave_waitlist: false },
        attendance: { state: 'not_checked_in', checked_in_at: null, checked_out_at: null },
        capacity: { limit: 20, confirmed: 1, remaining: 19, is_full: false, waitlist_count: 0 },
      },
      metrics: { confirmed_count: 1, interested_count: 0, waitlist_count: 0 },
      status: 'going',
      rsvp_counts: { going: 1, interested: 0 },
      waitlist_position: null,
      message: null,
    },
  }),
  removeRsvp: jest.fn().mockResolvedValue(undefined),
  getEventAttendees: jest.fn().mockResolvedValue({ data: [], meta: { per_page: 50, has_more: false, cursor: null } }),
  checkInEventAttendee: jest.fn().mockResolvedValue({ data: { checked_in: true, attendee_id: 22, event_id: 7 } }),
  joinEventWaitlist: jest.fn().mockResolvedValue({ data: { waitlisted: true, position: 2 } }),
  leaveEventWaitlist: jest.fn().mockResolvedValue(undefined),
  getEventPolls: jest.fn().mockResolvedValue({ data: [], meta: { per_page: 50, has_more: false, cursor: null } }),
  voteEventPoll: jest.fn().mockResolvedValue({ data: { id: 91, question: 'Which topic?', total_votes: 1, has_voted: true, voted_option_id: 12, options: [{ id: 12, text: 'Gardening', percentage: 100 }] } }),
  getEventReminders: jest.fn().mockResolvedValue({ data: [] }),
  getEventRecurrenceCapabilities: jest.fn(),
  updateEventReminders: jest.fn().mockResolvedValue({ data: [{ remind_before_minutes: 60, reminder_type: 'both', status: 'pending', scheduled_for: '2026-05-15T13:00:00Z' }] }),
  submitEventForReview: jest.fn().mockResolvedValue({ data: {} }),
  publishEvent: jest.fn().mockResolvedValue({ data: {} }),
}));

jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => () => null);

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

// Auto-confirm: invoking confirm() runs the action immediately, mirroring the
// old Alert.alert yes/no button-press simulation.
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: mockConfirm,
    confirmDialog: null,
  }),
}));

// --- Tests ---

import EventDetailScreen from './event-detail';
import { acceptEventWaitlistOffer, getEventAgenda, joinEventWaitlist, leaveEventWaitlist, publishEvent, rsvpEvent, submitEventForReview, updateEventReminders, voteEventPoll } from '@/lib/api/events';

const defaultApiState = { data: null, isLoading: false, error: null, refresh: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  mockUseApi.mockReturnValue(defaultApiState);
  mockRouterPush.mockClear();
});

const sharedEvent = require('../../../contracts/events/v2/event-detail.json');
const sharedRosterMember = require('../../../contracts/events/v2/event-roster-item.json');
const sharedAgenda = require('../../../contracts/events/v2/event-agenda.json');
const mockEvent = {
  ...sharedEvent,
  id: 7,
  title: 'Community Skill Share Workshop',
  description: 'Join us for an afternoon of skill sharing and community building.',
  organizer: { ...sharedEvent.organizer, id: 3, display_name: 'Jane Organizer' },
  schedule: { ...sharedEvent.schedule, start_at: '2026-05-15T14:00:00Z' },
  location: { ...sharedEvent.location, label: 'Community Hall, Main Street', mode: 'in_person' },
  online_access: {
    ...sharedEvent.online_access,
    mode: 'in_person',
    reveal_state: 'not_applicable',
    join_url: null,
    video_url: null,
  },
  relationship: {
    engagement: { state: 'none', can_change: true },
    registration: { state: 'none', waitlist_position: null, can_register: true, can_withdraw: false, can_join_waitlist: false, can_leave_waitlist: false },
    attendance: { state: 'not_checked_in', checked_in_at: null, checked_out_at: null },
    capacity: { limit: 20, confirmed: 12, remaining: 8, is_full: false, waitlist_count: 0 },
  },
  permissions: { ...sharedEvent.permissions, edit: true, manage_people: true, check_in: true, broadcast: true },
  metrics: { confirmed_count: 12, interested_count: 5, waitlist_count: 0 },
};

const emptyAgendaState = {
  data: {
    data: {
      contract_version: 1 as const,
      event_id: 7,
      agenda_version: 0,
      timezone: 'UTC',
      permissions: { manage: false },
      sessions: [],
    },
    meta: { base_url: 'https://test.api' },
  },
  isLoading: false,
  error: null,
  refresh: jest.fn(),
};

const populatedAgendaState = {
  data: {
    data: {
      ...sharedAgenda,
      event_id: 7,
      timezone: 'Pacific/Auckland',
      permissions: { manage: false },
      sessions: [{
        ...sharedAgenda.sessions[0],
        title: 'Repair skills workshop',
        type: 'workshop',
        visibility: 'registered',
        start_at: '2026-08-09T22:30:00+00:00',
        end_at: '2026-08-09T23:15:00+00:00',
        timezone: 'Pacific/Auckland',
        track: 'Practical skills',
        room: 'Workshop room',
        speakers: [{
          ...sharedAgenda.sessions[0].speakers[0],
          display_name: 'Alex Morgan',
          role: 'Facilitator',
        }],
      }],
    },
    meta: { base_url: 'https://test.api' },
  },
  isLoading: false,
  error: null,
  refresh: jest.fn(),
};

const reminderPreferences = {
  revision: 3,
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
    id: 9,
    offset_minutes: 1440,
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
    maximum_offset_minutes: 43_200,
    maximum_rules: 8,
    default_offsets_minutes: [10_080, 1_440, 60],
  },
  capabilities: { independent_channels: true, diagnostics_supported: false },
};

const reminderPreferencesState = {
  data: { data: reminderPreferences },
  isLoading: false,
  error: null,
  refresh: jest.fn(),
};

describe('EventDetailScreen', () => {
  it('renders without crashing when data is loaded', () => {
    mockUseApi.mockReturnValue({ data: { data: mockEvent }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByTestId, toJSON } = render(<EventDetailScreen />);
    expect(toJSON()).toBeTruthy();
    expect(getByTestId('event-registration-panel-stub')).toBeTruthy();
  });

  it('renders private analytics only for event organisers', () => {
    mockUseApi.mockReturnValue({ data: { data: mockEvent }, isLoading: false, error: null, refresh: jest.fn() });

    const organiser = render(<EventDetailScreen />);
    expect(organiser.getByTestId('event-analytics-card-stub')).toBeTruthy();
    expect(organiser.queryByTestId('event-safety-card-stub')).toBeNull();
    organiser.unmount();

    mockUseApi.mockReturnValue({
      data: { data: { ...mockEvent, permissions: { ...mockEvent.permissions, edit: false } } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });
    const attendee = render(<EventDetailScreen />);
    expect(attendee.queryByTestId('event-analytics-card-stub')).toBeNull();
    expect(attendee.getByTestId('event-safety-card-stub')).toBeTruthy();
  });

  it('renders the loading state', () => {
    mockUseApi.mockReturnValue({ data: null, isLoading: true, error: null, refresh: jest.fn() });

    const { toJSON } = render(<EventDetailScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders the event title when loaded', () => {
    mockUseApi.mockReturnValue({ data: { data: mockEvent }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<EventDetailScreen />);
    expect(getByText('Community Skill Share Workshop')).toBeTruthy();
  });

  it('renders translated all-day inclusive dates in the event IANA timezone', () => {
    mockUseApi.mockReturnValue({
      data: {
        data: {
          ...mockEvent,
          schedule: {
            ...mockEvent.schedule,
            start_at: '2026-08-09T12:00:00Z',
            end_at: '2026-08-11T12:00:00Z',
            timezone: 'Pacific/Auckland',
            all_day: true,
          },
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText, queryByText } = render(<EventDetailScreen />);
    // Day-first: formatEventSchedule now defaults to the app's own locale
    // rather than taking a caller-supplied tag that could be a bare 'en'.
    expect(getByText(/10 August 2026.*11 August 2026/)).toBeTruthy();
    expect(getByText('All day')).toBeTruthy();
    expect(queryByText(/12 August 2026/)).toBeNull();
  });

  it('renders the canonical postponed lifecycle state', () => {
    mockUseApi.mockReturnValue({
      data: {
        data: {
          ...mockEvent,
          schedule: {
            ...mockEvent.schedule,
            state: 'postponed',
            operational_state: 'postponed',
            lifecycle_version: 2,
          },
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<EventDetailScreen />);
    expect(getByText('Postponed')).toBeTruthy();
  });

  it('renders the not found state', () => {
    mockUseApi.mockReturnValue({ data: null, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<EventDetailScreen />);
    expect(getByText('Event not found.')).toBeTruthy();
    expect(getByText('Go Back')).toBeTruthy();
  });

  it('renders the RSVP button', () => {
    mockUseApi.mockReturnValue({ data: { data: mockEvent }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByTestId, getByText } = render(<EventDetailScreen />);
    expect(getByText('Going')).toBeTruthy();
    expect(getByTestId('event-going-action')).toBeTruthy();
  });

  it('keeps the RSVP footer above the device safe area and reserves scroll space', () => {
    mockUseApi.mockReturnValue({ data: { data: mockEvent }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByTestId, UNSAFE_getAllByType } = render(<EventDetailScreen />);
    const mainScroll = UNSAFE_getAllByType(ScrollView).find((node) => node.props.contentContainerStyle?.paddingHorizontal === 16);

    expect(StyleSheet.flatten(getByTestId('event-rsvp-footer').props.style)).toEqual(
      expect.objectContaining({ paddingBottom: 36 }),
    );
    expect(mainScroll?.props.contentContainerStyle).toEqual(expect.objectContaining({ paddingBottom: expect.any(Number) }));
    expect(mainScroll?.props.contentContainerStyle.paddingBottom).toBeGreaterThanOrEqual(124);
  });

  it('submits an RSVP and updates the visible attendee count', async () => {
    let hookIndex = 0;
    const eventState = { data: { data: mockEvent }, isLoading: false, error: null, refresh: jest.fn() };
    mockUseApi.mockImplementation(() => {
      const state = hookIndex % 5 === 0
        ? eventState
        : hookIndex % 5 === 1
          ? reminderPreferencesState
          : hookIndex % 5 === 4
            ? emptyAgendaState
            : { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
      hookIndex += 1;
      return state;
    });

    const { getByText } = render(<EventDetailScreen />);

    fireEvent.press(getByText('Going'));

    await waitFor(() => {
      expect(rsvpEvent).toHaveBeenCalledWith(
        7,
        'going',
        expect.stringMatching(/^rsvp-going-7-/),
      );
      expect(getByText(/1 going.*0 interested/)).toBeTruthy();
    });
  });

  it('opens the edit event route when the server grants edit permission', () => {
    mockUseApi.mockReturnValue({ data: { data: mockEvent }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<EventDetailScreen />);

    fireEvent.press(getByText('Edit'));

    expect(mockRouterPush).toHaveBeenCalledWith({ pathname: '/(modals)/edit-event', params: { id: '7' } });
  });

  it('confirms and submits a moderated draft from server publication permissions', async () => {
    const refresh = jest.fn();
    mockUseApi.mockReturnValue({
      data: {
        data: {
          ...mockEvent,
          permissions: { ...mockEvent.permissions, publish: false, submit_for_review: true },
        },
      },
      isLoading: false,
      error: null,
      refresh,
    });

    const { getByText } = render(<EventDetailScreen />);
    fireEvent.press(getByText('Submit for review'));

    await waitFor(() => {
      expect(submitEventForReview).toHaveBeenCalledWith(7);
      expect(refresh).toHaveBeenCalled();
      expect(publishEvent).not.toHaveBeenCalled();
    });
  });

  it('opens templates, lifecycle history and the bounded ticket catalogue from permitted event tools', () => {
    mockUseApi.mockReturnValue({ data: { data: mockEvent }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<EventDetailScreen />);

    fireEvent.press(getByText('Event templates'));
    expect(mockRouterPush).toHaveBeenCalledWith('/(modals)/event-templates');

    fireEvent.press(getByText('Open lifecycle history'));
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/(modals)/event-lifecycle-history',
      params: { id: '7' },
    });

    fireEvent.press(getByText('Available tickets'));
    expect(mockRouterPush).toHaveBeenCalledWith({ pathname: '/(modals)/event-tickets', params: { id: '7' } });
  });

  it('shows the future-setup entry only for a concrete V2 occurrence with negotiated capability', () => {
    const recurringEvent = {
      ...mockEvent,
      series: {
        ...mockEvent.series,
        recurrence: {
          parent_event_id: 3,
          root_event_id: 3,
          is_template: false,
          recurrence_id: '20300501T101500Z',
          engine: 'sabre-vobject',
          engine_version: '2',
          frequency: 'weekly',
          interval: 1,
          rrule: 'FREQ=WEEKLY',
          occurrence_count: 4,
          occurrences: [],
        },
      },
      permissions: {
        ...mockEvent.permissions,
        edit: true,
        manage_agenda: true,
      },
    };
    const eventState = { data: { data: recurringEvent }, isLoading: false, error: null, refresh: jest.fn() };
    const capabilityState = {
      data: {
        data: {
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
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    let hookIndex = 0;
    mockUseApi.mockImplementation(() => {
      const slot = hookIndex % 6;
      hookIndex += 1;
      if (slot === 0) return eventState;
      if (slot === 5) return capabilityState;
      return defaultApiState;
    });

    const permitted = render(<EventDetailScreen />);
    const futureSetupLabels = permitted.getAllByText('Future setup');
    fireEvent.press(futureSetupLabels[futureSetupLabels.length - 1]!);
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/(modals)/event-recurrence-blueprints',
      params: { id: '7' },
    });
    permitted.unmount();

    hookIndex = 0;
    mockUseApi.mockImplementation(() => {
      const slot = hookIndex % 6;
      hookIndex += 1;
      if (slot === 0) return eventState;
      if (slot === 5) {
        return {
          ...capabilityState,
          data: { data: { ...capabilityState.data.data, supports_definition_blueprints: false } },
        };
      }
      return defaultApiState;
    });
    const denied = render(<EventDetailScreen />);
    expect(denied.queryByText('Future setup')).toBeNull();
  });

  it('opens organizer communications only when the server grants broadcast permission', () => {
    mockUseApi.mockReturnValue({ data: { data: mockEvent }, isLoading: false, error: null, refresh: jest.fn() });

    const permitted = render(<EventDetailScreen />);
    fireEvent.press(permitted.getByText('New message'));
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/(modals)/event-communications',
      params: { id: '7' },
    });
    permitted.unmount();

    mockUseApi.mockReturnValue({
      data: { data: { ...mockEvent, permissions: { ...mockEvent.permissions, broadcast: false } } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });
    const denied = render(<EventDetailScreen />);
    expect(denied.queryByText('Organizer communications')).toBeNull();
  });

  it('uses server permissions instead of deriving organizer tools from the signed-in user', () => {
    mockUseApi.mockReturnValue({
      data: {
        data: {
          ...mockEvent,
          permissions: { ...mockEvent.permissions, edit: false, manage_people: false, check_in: false },
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { queryByText } = render(<EventDetailScreen />);

    expect(queryByText('Edit')).toBeNull();
    expect(queryByText('Event templates')).toBeNull();
    expect(queryByText('Open lifecycle history')).toBeNull();
    expect(queryByText('Event check-in')).toBeNull();
  });

  it('offers tickets and the private check-in credential only to confirmed attendees', () => {
    let hookIndex = 0;
    const eventState = {
      data: {
        data: {
          ...mockEvent,
          permissions: { ...mockEvent.permissions, edit: false, manage_people: false, check_in: false, manage_registration: false },
          relationship: {
            ...mockEvent.relationship,
            registration: {
              ...mockEvent.relationship.registration,
              state: 'confirmed',
              can_register: false,
              can_withdraw: true,
            },
          },
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    mockUseApi.mockImplementation(() => {
      const state = hookIndex % 5 === 0
        ? eventState
        : hookIndex % 5 === 1
          ? reminderPreferencesState
          : hookIndex % 5 === 4
            ? emptyAgendaState
            : { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
      hookIndex += 1;
      return state;
    });

    const { getByTestId, getByText, queryByText } = render(<EventDetailScreen />);

    expect(getByText('Available tickets')).toBeTruthy();
    expect(getByTestId('event-checkin-credential-card-stub')).toBeTruthy();
    expect(queryByText('Event templates')).toBeNull();
  });

  it('does not expose an attendee credential before registration is confirmed', () => {
    mockUseApi.mockReturnValue({
      data: { data: { ...mockEvent, permissions: { ...mockEvent.permissions, edit: false } } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { queryByTestId } = render(<EventDetailScreen />);

    expect(queryByTestId('event-checkin-credential-card-stub')).toBeNull();
  });

  it('renders the canonical named series supplied by the server', () => {
    mockUseApi.mockReturnValue({ data: { data: mockEvent }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<EventDetailScreen />);

    expect(getByText('Repair Together')).toBeTruthy();
  });

  it('loads and renders a read-only agenda in the event timezone', async () => {
    let hookIndex = 0;
    const eventState = { data: { data: mockEvent }, isLoading: false, error: null, refresh: jest.fn() };
    const emptyState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    mockUseApi.mockImplementation(() => {
      const state = hookIndex % 5 === 0
        ? eventState
        : hookIndex % 5 === 4
          ? populatedAgendaState
          : emptyState;
      hookIndex += 1;
      return state;
    });

    const screen = render(<EventDetailScreen />);

    expect(screen.getByText('Agenda')).toBeTruthy();
    expect(screen.getByText('Repair skills workshop')).toBeTruthy();
    expect(screen.getByText('Workshop')).toBeTruthy();
    expect(screen.getByText('Registered attendees')).toBeTruthy();
    // Day-first. This asserted /Aug 10/ while the agenda formatter took a
    // threaded locale that could be a bare language code; it now reads
    // dateLocale() directly, so the label matches what members actually see.
    expect(screen.getByText(/10 Aug.*10:30/)).toBeTruthy();
    expect(screen.getByText(/10 Aug.*11:15/)).toBeTruthy();
    expect(screen.getByText(/Practical skills/)).toBeTruthy();
    expect(screen.getByText(/Workshop room/)).toBeTruthy();
    expect(screen.getByText(/Alex Morgan — Facilitator/)).toBeTruthy();
    expect(screen.getByTestId('event-agenda-enterprise-panel-stub')).toBeTruthy();
    expect(screen.queryByText('Edit session')).toBeNull();

    const agendaHook = mockUseApi.mock.calls.find((call) => (
      Array.isArray(call[1]) && call[1].length === 3 && call[1][0] === 7 && call[1][1] === 7
    ));
    expect(agendaHook?.[2]).toEqual({ enabled: true });
    await agendaHook?.[0]();
    expect(getEventAgenda).toHaveBeenCalledWith(7);
  });

  it('does not add an empty agenda card for an event without sessions', () => {
    let hookIndex = 0;
    const eventState = { data: { data: mockEvent }, isLoading: false, error: null, refresh: jest.fn() };
    mockUseApi.mockImplementation(() => {
      const state = hookIndex % 5 === 0
        ? eventState
        : hookIndex % 5 === 1
          ? reminderPreferencesState
          : hookIndex % 5 === 4
            ? emptyAgendaState
            : { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
      hookIndex += 1;
      return state;
    });

    const { queryByText } = render(<EventDetailScreen />);

    expect(queryByText('Agenda')).toBeNull();
  });

  it('offers a compact retry when the agenda cannot be loaded', () => {
    let hookIndex = 0;
    const retry = jest.fn();
    const eventState = { data: { data: mockEvent }, isLoading: false, error: null, refresh: jest.fn() };
    const agendaErrorState = { data: null, isLoading: false, error: 'EVENT_AGENDA_UNAVAILABLE', refresh: retry };
    mockUseApi.mockImplementation(() => {
      const state = hookIndex % 5 === 0
        ? eventState
        : hookIndex % 5 === 4
          ? agendaErrorState
          : { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
      hookIndex += 1;
      return state;
    });

    const { getByText } = render(<EventDetailScreen />);

    expect(getByText('The event agenda could not be loaded.')).toBeTruthy();
    fireEvent.press(getByText('Retry agenda'));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('opens the bounded attendance workspace instead of mutating the legacy roster inline', () => {
    let hookIndex = 0;
    const eventState = { data: { data: mockEvent }, isLoading: false, error: null, refresh: jest.fn() };
    const remindersState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const attendeesState = {
        data: {
          data: [
            {
              ...sharedRosterMember,
              member: { ...sharedRosterMember.member, id: 22, display_name: 'Mina Member', avatar_url: null },
              attendance: { state: 'not_checked_in', checked_in_at: null, checked_out_at: null },
            },
            {
              ...sharedRosterMember,
              member: { ...sharedRosterMember.member, id: 23, display_name: 'Iris Interested', avatar_url: null },
              engagement: { state: 'interested', can_change: false },
              registration: { ...sharedRosterMember.registration, state: 'none' },
              attendance: { state: 'not_checked_in', checked_in_at: null, checked_out_at: null },
            },
          ],
          meta: { per_page: 50, has_more: false, cursor: null },
        },
        isLoading: false,
        error: null,
        refresh: jest.fn(),
      };
    mockUseApi.mockImplementation(() => {
      const state = hookIndex % 5 === 0
        ? eventState
        : hookIndex % 5 === 1
          ? remindersState
          : hookIndex % 5 === 2
            ? attendeesState
            : hookIndex % 5 === 3
              ? { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() }
              : emptyAgendaState;
      hookIndex += 1;
      return state;
    });

    const { getByText } = render(<EventDetailScreen />);

    expect(getByText('Event check-in')).toBeTruthy();
    fireEvent.press(getByText('Open check-in'));
    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/(modals)/event-attendance',
      params: { id: '7' },
    });
  });

  it('uses backend online_link when opening an online event', async () => {
    const openUrlSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    mockUseApi.mockReturnValue({
      data: {
        data: {
          ...mockEvent,
          location: { ...mockEvent.location, label: null, mode: 'online' },
          online_access: {
            ...mockEvent.online_access,
            mode: 'online',
            reveal_state: 'available',
            join_url: 'https://meet.example/live',
          },
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<EventDetailScreen />);

    expect(getByText('Tap to Join')).toBeTruthy();
    fireEvent.press(getByText('Join online'));

    await waitFor(() => {
      expect(openUrlSpy).toHaveBeenCalledWith('https://meet.example/live');
    });
    openUrlSpy.mockRestore();
  });

  it('does not expose a meeting URL when the server marks access as restricted', () => {
    mockUseApi.mockReturnValue({
      data: {
        data: {
          ...mockEvent,
          location: { ...mockEvent.location, mode: 'online' },
          online_access: {
            ...mockEvent.online_access,
            mode: 'online',
            reveal_state: 'restricted',
            join_url: 'https://meet.example/private',
          },
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { queryByText } = render(<EventDetailScreen />);

    expect(queryByText('Join online')).toBeNull();
  });

  it('joins and leaves the event waitlist when the event is full', async () => {
    let hookIndex = 0;
    const refresh = jest.fn();
    const fullEvent = {
      ...mockEvent,
      relationship: {
        ...mockEvent.relationship,
        registration: {
          ...mockEvent.relationship.registration,
          can_register: false,
          can_join_waitlist: true,
        },
        capacity: { ...mockEvent.relationship.capacity, remaining: 0, is_full: true, waitlist_count: 1 },
      },
      metrics: { ...mockEvent.metrics, waitlist_count: 1 },
    };
    const eventState = { data: { data: fullEvent }, isLoading: false, error: null, refresh };
    const remindersState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const attendeesState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    mockUseApi.mockImplementation(() => {
      const state = hookIndex % 5 === 0
        ? eventState
        : hookIndex % 5 === 1
          ? remindersState
          : hookIndex % 5 === 2
            ? attendeesState
            : hookIndex % 5 === 3
              ? { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() }
              : emptyAgendaState;
      hookIndex += 1;
      return state;
    });

    const firstRender = render(<EventDetailScreen />);

    expect(firstRender.getByText('1 on the waitlist')).toBeTruthy();
    fireEvent.press(firstRender.getByText('Join waitlist'));

    await waitFor(() => {
      expect(joinEventWaitlist).toHaveBeenCalledWith(7);
      expect(refresh).toHaveBeenCalled();
    });
    firstRender.unmount();

    hookIndex = 0;
    const waitlistedEvent = {
      ...fullEvent,
      relationship: {
        ...fullEvent.relationship,
        registration: {
          ...fullEvent.relationship.registration,
          state: 'waitlisted',
          waitlist_position: 2,
          can_join_waitlist: false,
          can_leave_waitlist: true,
        },
      },
    };
    const waitlistedState = { data: { data: waitlistedEvent }, isLoading: false, error: null, refresh };
    mockUseApi.mockImplementation(() => {
      const state = hookIndex % 5 === 0
        ? waitlistedState
        : hookIndex % 5 === 1
          ? remindersState
          : hookIndex % 5 === 2
            ? attendeesState
            : hookIndex % 5 === 3
              ? { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() }
              : emptyAgendaState;
      hookIndex += 1;
      return state;
    });
    const secondRender = render(<EventDetailScreen />);
    expect(secondRender.getByText('You are on the waitlist: #2')).toBeTruthy();
    mockConfirm.mockImplementationOnce(() => undefined);
    fireEvent.press(secondRender.getByText('Leave waitlist'));

    expect(leaveEventWaitlist).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Leave the waitlist?',
      message: 'You will lose your current position.',
      variant: 'danger',
    }));

    fireEvent.press(secondRender.getByText('Leave waitlist'));

    await waitFor(() => {
      expect(leaveEventWaitlist).toHaveBeenCalledWith(7);
    });
  });

  it('offers canonical accept and decline actions for a live waitlist offer', async () => {
    let hookIndex = 0;
    const refresh = jest.fn();
    const offeredEvent = {
      ...mockEvent,
      relationship: {
        ...mockEvent.relationship,
        engagement: { ...mockEvent.relationship.engagement, can_change: true },
        registration: {
          ...mockEvent.relationship.registration,
          state: 'offered',
          waitlist_position: 1,
          can_register: false,
          can_withdraw: false,
          can_join_waitlist: false,
          can_leave_waitlist: true,
        },
        capacity: { ...mockEvent.relationship.capacity, remaining: 0, is_full: true, waitlist_count: 1 },
      },
      metrics: { ...mockEvent.metrics, waitlist_count: 1 },
    };
    const eventState = { data: { data: offeredEvent }, isLoading: false, error: null, refresh };
    mockUseApi.mockImplementation(() => {
      const state = hookIndex % 5 === 0
        ? eventState
        : hookIndex % 5 === 1
          ? reminderPreferencesState
          : hookIndex % 5 === 4
            ? emptyAgendaState
            : { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
      hookIndex += 1;
      return state;
    });

    const screen = render(<EventDetailScreen />);

    expect(screen.getByText('A place is available for you')).toBeTruthy();
    expect(screen.queryByLabelText('Going')).toBeNull();
    expect(screen.queryByLabelText('Interested')).toBeNull();
    fireEvent.press(screen.getByLabelText('Accept place'));

    await waitFor(() => {
      expect(acceptEventWaitlistOffer).toHaveBeenCalledWith(7, expect.stringMatching(/^accept-offer-7-/));
      expect(refresh).toHaveBeenCalled();
      expect(screen.queryByText('A place is available for you')).toBeNull();
      expect(screen.getByLabelText('Going')).toBeTruthy();
    });
  });

  it('renders and votes on event-linked polls', async () => {
    let hookIndex = 0;
    const eventState = { data: { data: mockEvent }, isLoading: false, error: null, refresh: jest.fn() };
    const remindersState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const attendeesState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    const pollsState = {
      data: {
        data: [{
          id: 91,
          question: 'Which topic should we cover?',
          total_votes: 0,
          has_voted: false,
          options: [
            { id: 12, text: 'Gardening', percentage: 0 },
            { id: 13, text: 'Cooking', percentage: 0 },
          ],
        }],
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    mockUseApi.mockImplementation(() => {
      const state = hookIndex % 5 === 0
        ? eventState
        : hookIndex % 5 === 1
          ? remindersState
          : hookIndex % 5 === 2
            ? attendeesState
            : hookIndex % 5 === 3
              ? pollsState
              : emptyAgendaState;
      hookIndex += 1;
      return state;
    });

    const { getByText } = render(<EventDetailScreen />);

    expect(getByText('Event polls')).toBeTruthy();
    fireEvent.press(getByText('Gardening'));

    await waitFor(() => {
      expect(voteEventPoll).toHaveBeenCalledWith(91, 12);
      expect(getByText('Gardening - 100%')).toBeTruthy();
    });
  });

  it('renders and updates per-event reminders', async () => {
    let hookIndex = 0;
    const confirmedEvent = {
      ...mockEvent,
      relationship: {
        ...mockEvent.relationship,
        registration: {
          ...mockEvent.relationship.registration,
          state: 'confirmed',
          can_register: false,
          can_withdraw: true,
        },
      },
    };
    const eventState = { data: { data: confirmedEvent }, isLoading: false, error: null, refresh: jest.fn() };
    const remindersState = reminderPreferencesState;
    const attendeesState = { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    mockUseApi.mockImplementation(() => {
      const state = hookIndex % 5 === 0
        ? eventState
        : hookIndex % 5 === 1
          ? remindersState
          : hookIndex % 5 === 2
            ? attendeesState
            : hookIndex % 5 === 3
              ? { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() }
              : emptyAgendaState;
      hookIndex += 1;
      return state;
    });

    const { getByText } = render(<EventDetailScreen />);

    expect(getByText('Reminders')).toBeTruthy();
    fireEvent.press(getByText('1 hour before'));
    fireEvent.press(getByText('Save reminders'));

    await waitFor(() => {
      expect(updateEventReminders).toHaveBeenCalledWith(7, {
        expected_revision: 3,
        overrides: reminderPreferences.overrides,
        rules: [
          {
            offset_minutes: 1440,
            enabled: true,
            email_enabled: null,
            in_app_enabled: null,
            web_push_enabled: null,
            fcm_enabled: null,
            realtime_enabled: null,
          },
          {
            offset_minutes: 60,
            enabled: true,
            email_enabled: null,
            in_app_enabled: null,
            web_push_enabled: null,
            fcm_enabled: null,
            realtime_enabled: null,
          },
        ],
      });
    });
  });
});

