// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetAuthoredPodcasts = jest.fn();
const mockCreatePodcastShow = jest.fn();
const mockCreatePodcastEpisode = jest.fn();
const mockPublishPodcastShow = jest.fn();
const mockDeletePodcastShow = jest.fn();
const mockValidatePodcastFeed = jest.fn();
const mockCreatePodcastEpisodeWithAudio = jest.fn();
const mockPickAudioFile = jest.fn();
const mockIsUploadAborted = jest.fn((_error?: unknown) => false);
const mockConfirm = jest.fn();

const SHOW = {
  id: 7,
  title: 'Time stories',
  slug: 'time-stories',
  summary: 'Neighbours swapping hours.',
  description: '',
  artwork_url: null,
  category: 'Community',
  author_name: 'Aoife',
  owner_email: '',
  copyright: '',
  funding_url: '',
  explicit: false,
  language: 'en',
  visibility: 'public',
  status: 'draft',
  moderation_status: 'approved',
  episode_count: 1,
  subscriber_count: 3,
  episodes: [
    {
      id: 33,
      show_id: 7,
      title: 'First hour',
      slug: 'first-hour',
      audio_url: 'https://example.org/first.mp3',
      explicit: false,
      episode_type: 'full',
      listen_count: 4,
      status: 'draft',
      moderation_status: 'pending',
      visibility: 'inherit',
      media_scan_status: 'clean',
      chapters: [],
    },
  ],
};

const CAPABILITIES = {
  can_create_show: true,
  enable_private_shows: true,
  enable_transcripts: true,
  enable_chapters: true,
};

jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    // Destructive actions must ASK first, so the dialog is captured rather than
    // auto-confirmed: a test that auto-confirms cannot tell a guarded delete
    // from an unguarded one.
    confirm: (options: unknown) => mockConfirm(options),
    confirmDialog: null,
  }),
}));

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { replace: jest.fn(), back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

jest.mock('react-i18next', () => {
  const map: Record<string, string> = {
    'studio.title': 'Podcast Studio',
    'studio.subtitle': 'Create member-led shows.',
    'studio.create_show': 'Create show',
    'studio.add_episode': 'Add episode',
    'studio.my_shows': 'My shows',
    'studio.no_shows': 'You have not created any shows yet.',
    'studio.select_show': 'Select show',
    'studio.publish_show': 'Publish show',
    'studio.publish_episode': 'Publish episode',
    'studio.archive_show': 'Archive show',
    'studio.delete_show': 'Delete show',
    'studio.archive_episode': 'Archive episode',
    'studio.delete_episode': 'Delete episode',
    'studio.edit_show': 'Edit show',
    'studio.edit_episode': 'Edit episode',
    'studio.save_changes': 'Save changes',
    'studio.validate_feed': 'Validate feed',
    'studio.creation_unavailable': 'You cannot create another show here.',
    'studio.show_created': 'Show created.',
    'studio.episode_created': 'Episode created.',
    'studio.show_published': 'Show published.',
    'studio.show_deleted': 'Show deleted.',
    'studio.save_failed': 'Could not save changes.',
    'studio.load_failed': 'Your podcast studio could not be loaded.',
    'studio.retry_load': 'Try again',
    'studio.retry_upload': 'Retry upload',
    'studio.artwork_upload_failed': 'The show was saved, but its artwork could not be uploaded.',
    'studio.audio_https_required': 'Use an HTTPS audio URL.',
    'studio.chapter_format_warning': '{{count}} chapter lines have no timestamp.',
    'studio.confirm_delete_show': 'Delete {{title}} and all of its episodes?',
    'studio.readiness_title': 'Show readiness',
    'studio.readiness_subtitle': '{{title}} checklist',
    'studio.readiness.public_show': 'Show is published, public, and approved',
    'studio.readiness.owner_email': 'Directory owner email is set',
    'studio.readiness.description': 'Show has a summary or description',
    'studio.readiness.artwork': 'Show artwork URL is set',
    'studio.readiness.published_episode': 'At least one approved episode is published',
    'studio.media_scan_status': 'Scan: {{status}}',
    'studio.media_status.clean': 'Clean',
    'studio.feed_validation.title': 'Feed check - {{title}}',
    'studio.feed_validation.valid': 'Your RSS feed is ready.',
    'studio.feed_validation.invalid': 'Your RSS feed has issues to fix.',
    'studio.feed_validation.errors': 'Blocking issues',
    'studio.feed_validation.warnings': 'Recommended fixes',
    'studio.feed_validation.skipped_episodes': '{{count}} episode(s) would be left out.',
    'studio.feed_validation.issues.episode_missing_audio_url': 'An episode is missing a valid audio URL.',
    'studio.feed_validation.issues.missing_artwork': 'Add show artwork.',
    'studio.unsaved_title': 'Discard this podcast draft?',
    'studio.unsaved_message': 'What you typed will be lost.',
    'studio.discard': 'Discard',
    'fields.show': 'Show',
    'fields.show_title': 'Show title',
    'fields.episode_title': 'Episode title',
    'fields.language': 'Language',
    'fields.category': 'Category',
    'fields.author_name': 'Directory author name',
    'fields.owner_email': 'Directory owner email',
    'fields.copyright': 'Copyright notice',
    'fields.funding_url': 'Funding URL',
    'fields.explicit_show': 'Mark this show as explicit',
    'fields.artwork_file': 'Show artwork',
    'fields.audio_url': 'Audio URL',
    'fields.audio_file_hint': 'Use an external audio URL.',
    'fields.audio_file': 'Hosted audio file',
    'fields.clear_audio_file': 'Clear selected file',
    'fields.audio_url_disabled_file_selected': 'Using the selected hosted file.',
    'studio.max_file_size': 'Max {{max}} MB.',
    'studio.file_too_large': 'That file is larger than the {{max}} MB limit.',
    'studio.unsupported_file_type': 'That file type is not supported.',
    'studio.uploading': 'Uploading audio',
    'studio.cancel_upload': 'Cancel upload',
    'studio.upload_cancelled': 'Upload cancelled - your episode details are still here.',
    'fields.visibility': 'Visibility',
    'fields.summary': 'Summary',
    'fields.description': 'Description',
    'fields.duration_seconds': 'Duration in seconds',
    'fields.episode_number': 'Episode number',
    'fields.season_number': 'Season number',
    'fields.cover_image_file': 'Episode cover image',
    'fields.scheduled_for': 'Schedule publication',
    'fields.scheduled_for_hint': 'Format: YYYY-MM-DD HH:MM',
    'fields.episode_type': 'Episode type',
    'fields.transcript': 'Transcript',
    'fields.transcript_language': 'Transcript language',
    'fields.explicit_episode': 'Mark this episode as explicit',
    'fields.chapters': 'Chapters',
    'fields.chapters_hint': 'One chapter per line.',
    'visibility.public': 'Public',
    'visibility.members': 'Members',
    'visibility.private': 'Private',
    'visibility.inherit': 'Inherit show visibility',
    'status.draft': 'Draft',
    'status.published': 'Published',
    'status.archived': 'Archived',
    'moderation.pending': 'Pending review',
    'moderation.approved': 'Approved',
    'episode.type.full': 'Full episode',
    'episode.type.trailer': 'Trailer',
    'episode.type.bonus': 'Bonus',
    'actions.cancel': 'Cancel',
    'actions.close': 'Close',
    'show.no_summary': 'No summary yet.',
    'show.episodes': 'Episodes',
    'common:back': 'Back',
    'common:buttons.cancel': 'Cancel',
    'common:errors.alertTitle': 'Error',
    'common:errors.generic': 'Something went wrong. Please try again.',
  };

  // 🔴 `t` must be STABLE. The real i18next returns the same function across
  // renders, and the studio's loader is a useCallback that depends on it — a
  // fresh `t` per render turns the initial load into an endless re-render loop
  // and the screen never leaves its spinner.
  const translate = (key: string, options?: Record<string, unknown>) => {
    const template = map[key];
    if (template === undefined) {
      return typeof options?.defaultValue === 'string' ? options.defaultValue : key;
    }
    return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
  };
  const i18n = { language: 'en' };

  return { useTranslation: () => ({ t: translate, i18n }) };
});

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({
    tenant: { slug: 'hour-timebank', default_language: 'en', supported_languages: ['en', 'ga'] },
    hasFeature: () => true,
    hasModule: () => true,
  }),
  usePrimaryColor: () => '#6366f1',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f8f8',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
    borderSubtle: '#eeeeee',
    error: '#bf0025',
    success: '#00753c',
    warning: '#aa4c00',
  }),
}));

jest.mock('@/lib/api/podcasts', () => ({
  getAuthoredPodcasts: (...args: unknown[]) => mockGetAuthoredPodcasts(...args),
  createPodcastShow: (...args: unknown[]) => mockCreatePodcastShow(...args),
  createPodcastEpisode: (...args: unknown[]) => mockCreatePodcastEpisode(...args),
  createPodcastEpisodeWithAudio: (...args: unknown[]) => mockCreatePodcastEpisodeWithAudio(...args),
  publishPodcastShow: (...args: unknown[]) => mockPublishPodcastShow(...args),
  publishPodcastEpisode: jest.fn().mockResolvedValue({ id: 33 }),
  archivePodcastShow: jest.fn().mockResolvedValue({ id: 7 }),
  archivePodcastEpisode: jest.fn().mockResolvedValue({ id: 33 }),
  deletePodcastShow: (...args: unknown[]) => mockDeletePodcastShow(...args),
  deletePodcastEpisode: jest.fn().mockResolvedValue({ deleted: true }),
  updatePodcastShow: jest.fn().mockResolvedValue({ id: 7 }),
  updatePodcastEpisode: jest.fn().mockResolvedValue({ id: 33 }),
  uploadPodcastShowArtwork: jest.fn().mockResolvedValue({ url: '/uploads/a.jpg' }),
  uploadPodcastEpisodeCover: jest.fn().mockResolvedValue({ url: '/uploads/c.jpg' }),
  validatePodcastFeed: (...args: unknown[]) => mockValidatePodcastFeed(...args),
}));

jest.mock('@/lib/media/pickAudioFile', () => ({
  pickAudioFile: (...args: unknown[]) => mockPickAudioFile(...args),
}));

jest.mock('@/lib/api/uploadWithProgress', () => ({
  isUploadAborted: (error: unknown) => mockIsUploadAborted(error),
}));

jest.mock('@/lib/haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success' },
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  launchImageLibraryAsync: jest.fn().mockResolvedValue({ canceled: true, assets: [] }),
  MediaTypeOptions: { Images: 'Images' },
}));

jest.mock('@/components/ui/Icon', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => 'View');
jest.mock('@/components/podcasts/PodcastShowStatsPanel', () => 'View');

jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

jest.mock('@/components/ui/EmptyState', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return function MockEmptyState({ title, subtitle, actionLabel, onAction }: { title: string; subtitle?: string; actionLabel?: string; onAction?: () => void }) {
    return (
      <View>
        <Text>{title}</Text>
        {subtitle ? <Text>{subtitle}</Text> : null}
        {actionLabel && onAction ? (
          <Pressable accessibilityRole="button" onPress={onAction}><Text>{actionLabel}</Text></Pressable>
        ) : null}
      </View>
    );
  };
});

// A sheet renders through a portal in the app; here it simply shows its content
// when open, so a test can read the edit form and the feed-check result.
jest.mock('@/components/ui/BottomSheet', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return function MockBottomSheet({ visible, title, children }: { visible: boolean; title?: string; children: React.ReactNode }) {
    if (!visible) return null;
    return (
      <View>
        {title ? <Text>{title}</Text> : null}
        {children}
      </View>
    );
  };
});

jest.mock('@/components/ui/StatusChip', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  const Chip = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Chip.Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  return { Chip };
});

// The real wrappers render a HeroUI TextField whose label is not the
// placeholder; the mocks expose the label as a placeholder so a test can reach
// a specific field by name.
jest.mock('@/components/ui/Input', () => {
  const React = require('react');
  const { TextInput } = require('react-native');
  return function MockInput({ label, placeholder, ...rest }: Record<string, unknown>) {
    return <TextInput accessibilityLabel={label as string} placeholder={(placeholder as string) ?? (label as string)} {...rest} />;
  };
});

jest.mock('@/components/ui/TextArea', () => {
  const React = require('react');
  const { TextInput } = require('react-native');
  return function MockTextArea({ label, placeholder, ...rest }: Record<string, unknown>) {
    return <TextInput accessibilityLabel={label as string} placeholder={(placeholder as string) ?? (label as string)} multiline {...rest} />;
  };
});

jest.mock('heroui-native', () => {
  const React = require('react');
  const { Pressable, Text, TextInput, View } = require('react-native');
  const Button = ({ children, onPress, isDisabled }: { children: React.ReactNode; onPress?: () => void; isDisabled?: boolean }) => (
    <Pressable accessibilityRole="button" disabled={isDisabled} onPress={isDisabled ? undefined : onPress}>
      <View>{children}</View>
    </Pressable>
  );
  Button.Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  const Card = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Card.Body = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Card.Footer = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
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
    TagGroup,
    Spinner: () => <View />,
    Surface: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    TextField: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    Label: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    Input: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => <TextInput ref={ref} {...props} />),
    TextArea: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => <TextInput ref={ref} {...props} />),
    FieldError: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
  };
});

import PodcastStudioRoute from './podcast-studio';

/** The heading and the submit button share a label; the button is the last one. */
function pressLast(elements: unknown[]): void {
  fireEvent.press(elements[elements.length - 1] as never);
}

describe('PodcastStudioRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthoredPodcasts.mockResolvedValue({ shows: [SHOW], capabilities: CAPABILITIES });
    mockCreatePodcastShow.mockResolvedValue({ id: 12, title: 'Neighbourhood radio' });
    mockCreatePodcastEpisode.mockResolvedValue({ id: 44, title: 'Episode one' });
    mockPublishPodcastShow.mockResolvedValue({ id: 7 });
    mockDeletePodcastShow.mockResolvedValue({ deleted: true });
    mockValidatePodcastFeed.mockResolvedValue({ valid: false, errors: ['episode_41_missing_audio_url'], warnings: ['missing_artwork'], skipped_episode_count: 2 });
    mockCreatePodcastEpisodeWithAudio.mockResolvedValue({ id: 45, title: 'Episode one' });
    mockPickAudioFile.mockResolvedValue({ status: 'cancelled' });
    mockIsUploadAborted.mockReturnValue(false);
  });

  it('creates a show with the directory metadata the member typed', async () => {
    const view = render(<PodcastStudioRoute />);
    await waitFor(() => expect(view.getByPlaceholderText('Show title')).toBeTruthy());

    fireEvent.changeText(view.getByPlaceholderText('Show title'), '  Neighbourhood radio  ');
    fireEvent.changeText(view.getByPlaceholderText('Category'), 'Community');
    fireEvent.changeText(view.getByPlaceholderText('Directory owner email'), 'host@example.org');
    fireEvent.changeText(view.getByPlaceholderText('Funding URL'), 'https://example.org/support');
    // Two visibility pickers are on screen (show, then episode) — take the show's.
    fireEvent.press(view.getAllByText('Private')[0]);
    fireEvent.press(view.getByText('Mark this show as explicit'));
    pressLast(view.getAllByText('Create show'));

    await waitFor(() => {
      expect(mockCreatePodcastShow).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Neighbourhood radio',
        category: 'Community',
        owner_email: 'host@example.org',
        funding_url: 'https://example.org/support',
        visibility: 'private',
        explicit: true,
        language: 'en',
      }));
    });
    // The studio reloads after every successful write; wait for it so no
    // state update lands after the test has finished.
    await waitFor(() => expect(mockGetAuthoredPodcasts).toHaveBeenCalledTimes(2));
  });

  it('refuses a plain-HTTP audio URL before any request is made', async () => {
    const view = render(<PodcastStudioRoute />);
    await waitFor(() => expect(view.getByPlaceholderText('Episode title')).toBeTruthy());

    fireEvent.changeText(view.getByPlaceholderText('Episode title'), 'Episode one');
    fireEvent.changeText(view.getByPlaceholderText('Audio URL'), 'http://example.org/one.mp3');
    pressLast(view.getAllByText('Add episode'));

    await waitFor(() => expect(view.getByText('Use an HTTPS audio URL.')).toBeTruthy());
    expect(mockCreatePodcastEpisode).not.toHaveBeenCalled();
  });

  it('accepts plain HTTP on localhost, which the API allows for development', async () => {
    const view = render(<PodcastStudioRoute />);
    await waitFor(() => expect(view.getByPlaceholderText('Episode title')).toBeTruthy());

    fireEvent.changeText(view.getByPlaceholderText('Episode title'), 'Episode one');
    fireEvent.changeText(view.getByPlaceholderText('Audio URL'), 'http://localhost:8090/one.mp3');
    pressLast(view.getAllByText('Add episode'));

    await waitFor(() => expect(mockCreatePodcastEpisode).toHaveBeenCalled());
    // The studio reloads after every successful write; wait for it so no
    // state update lands after the test has finished.
    await waitFor(() => expect(mockGetAuthoredPodcasts).toHaveBeenCalledTimes(2));
  });

  it('creates an episode against the selected show, with parsed chapters and a format warning', async () => {
    const view = render(<PodcastStudioRoute />);
    await waitFor(() => expect(view.getByPlaceholderText('Episode title')).toBeTruthy());

    fireEvent.changeText(view.getByPlaceholderText('Episode title'), 'Episode one');
    fireEvent.changeText(view.getByPlaceholderText('Audio URL'), 'https://example.org/one.mp3');
    fireEvent.changeText(view.getByPlaceholderText('Episode number'), '3');
    fireEvent.changeText(view.getByPlaceholderText('Duration in seconds'), '1800');
    fireEvent.press(view.getByText('Trailer'));
    fireEvent.changeText(view.getByPlaceholderText('Chapters'), '00:30 Welcome\n1:05:10 The guest\nNo timestamp here');

    // The line with no timestamp is counted and reported, not silently accepted.
    expect(view.getByText('1 chapter lines have no timestamp.')).toBeTruthy();

    pressLast(view.getAllByText('Add episode'));

    await waitFor(() => {
      expect(mockCreatePodcastEpisode).toHaveBeenCalledWith(7, expect.objectContaining({
        title: 'Episode one',
        audio_url: 'https://example.org/one.mp3',
        episode_number: 3,
        duration_seconds: 1800,
        episode_type: 'trailer',
        chapters: [
          { title: 'Welcome', starts_at_seconds: 30, position: 0 },
          { title: 'The guest', starts_at_seconds: 3910, position: 1 },
          { title: 'No timestamp here', starts_at_seconds: 0, position: 2 },
        ],
      }));
    });
    // The studio reloads after every successful write; wait for it so no
    // state update lands after the test has finished.
    await waitFor(() => expect(mockGetAuthoredPodcasts).toHaveBeenCalledTimes(2));
  });

  it('publishes a draft show through the publish endpoint', async () => {
    const view = render(<PodcastStudioRoute />);
    await waitFor(() => expect(view.getByText('Publish show')).toBeTruthy());

    fireEvent.press(view.getByText('Publish show'));

    await waitFor(() => expect(mockPublishPodcastShow).toHaveBeenCalledWith(7));
    // The studio reloads after every successful write; wait for it so no
    // state update lands after the test has finished.
    await waitFor(() => expect(mockGetAuthoredPodcasts).toHaveBeenCalledTimes(2));
  });

  it('asks before deleting a show, and deletes only once the member confirms', async () => {
    const view = render(<PodcastStudioRoute />);
    await waitFor(() => expect(view.getByText('Delete show')).toBeTruthy());

    fireEvent.press(view.getByText('Delete show'));

    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Delete show',
      message: 'Delete Time stories and all of its episodes?',
      variant: 'danger',
    }));
    expect(mockDeletePodcastShow).not.toHaveBeenCalled();

    // The dialog's own button calls this from inside React; driving it directly
    // has to be wrapped, or its state updates land outside act().
    const options = mockConfirm.mock.calls[0][0] as { onConfirm: () => Promise<void> };
    await act(async () => { await options.onConfirm(); });

    await waitFor(() => expect(mockDeletePodcastShow).toHaveBeenCalledWith(7));
    // The studio reloads after every successful write; wait for it so no
    // state update lands after the test has finished.
    await waitFor(() => expect(mockGetAuthoredPodcasts).toHaveBeenCalledTimes(2));
  });

  it('shows the feed check result, with per-episode issues collapsed onto a readable sentence', async () => {
    const view = render(<PodcastStudioRoute />);
    await waitFor(() => expect(view.getByText('Validate feed')).toBeTruthy());

    fireEvent.press(view.getByText('Validate feed'));

    await waitFor(() => expect(mockValidatePodcastFeed).toHaveBeenCalledWith(7));
    await waitFor(() => expect(view.getByText('Your RSS feed has issues to fix.')).toBeTruthy());
    expect(view.getByText('An episode is missing a valid audio URL.')).toBeTruthy();
    expect(view.getByText('Add show artwork.')).toBeTruthy();
    expect(view.getByText('2 episode(s) would be left out.')).toBeTruthy();
  });

  it('replaces the create form with a notice when the community forbids new shows', async () => {
    mockGetAuthoredPodcasts.mockResolvedValue({
      shows: [SHOW],
      capabilities: { ...CAPABILITIES, can_create_show: false },
    });

    const view = render(<PodcastStudioRoute />);

    await waitFor(() => expect(view.getByText('You cannot create another show here.')).toBeTruthy());
    expect(view.queryByPlaceholderText('Show title')).toBeNull();
    expect(view.queryByText('Create show')).toBeNull();
  });

  it('hides the transcript and chapter fields when the community has them switched off', async () => {
    mockGetAuthoredPodcasts.mockResolvedValue({
      shows: [SHOW],
      capabilities: { ...CAPABILITIES, enable_transcripts: false, enable_chapters: false },
    });

    const view = render(<PodcastStudioRoute />);
    await waitFor(() => expect(view.getByPlaceholderText('Episode title')).toBeTruthy());

    expect(view.queryByPlaceholderText('Transcript')).toBeNull();
    expect(view.queryByPlaceholderText('Chapters')).toBeNull();

    fireEvent.changeText(view.getByPlaceholderText('Episode title'), 'Episode one');
    fireEvent.changeText(view.getByPlaceholderText('Audio URL'), 'https://example.org/one.mp3');
    pressLast(view.getAllByText('Add episode'));

    await waitFor(() => expect(mockCreatePodcastEpisode).toHaveBeenCalled());
    const payload = mockCreatePodcastEpisode.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('chapters');
    expect(payload.transcript).toBe('');
    // The studio reloads after every successful write; wait for it so no
    // state update lands after the test has finished.
    await waitFor(() => expect(mockGetAuthoredPodcasts).toHaveBeenCalledTimes(2));
  });

  it('opens the edit-show sheet prefilled from the show it was opened on', async () => {
    const view = render(<PodcastStudioRoute />);
    await waitFor(() => expect(view.getByText('Edit show')).toBeTruthy());

    fireEvent.press(view.getByText('Edit show'));

    await waitFor(() => expect(view.getByDisplayValue('Time stories')).toBeTruthy());
    expect(view.getByDisplayValue('Aoife')).toBeTruthy();
    expect(view.getByText('Save changes')).toBeTruthy();
  });

  it('reports a failed load and offers a retry rather than an empty studio', async () => {
    mockGetAuthoredPodcasts.mockRejectedValueOnce(new Error('offline'));

    const view = render(<PodcastStudioRoute />);
    // The failure shows as both the heading and, with no server message to
    // quote, the detail line beneath it.
    await waitFor(() => expect(view.getAllByText('Your podcast studio could not be loaded.').length).toBeGreaterThan(0));

    mockGetAuthoredPodcasts.mockResolvedValue({ shows: [SHOW], capabilities: CAPABILITIES });
    fireEvent.press(view.getByText('Try again'));

    // The show title appears in the picker and again in the My shows list.
    await waitFor(() => expect(view.getAllByText('Time stories').length).toBeGreaterThan(0));
    expect(view.queryByText('Try again')).toBeNull();
  });

  /*
    Hosted audio. The whole reason this screen exists natively is that a member
    records on the phone the audio is already on — so picking that file has to
    work, not just pasting a link to it.
  */
  describe('uploading an audio file from the device', () => {
    const PICKED = { uri: 'file:///cache/ep.m4a', name: 'ep.m4a', mimeType: 'audio/x-m4a', size: 4096 };

    async function chooseFile(view: ReturnType<typeof render>) {
      mockPickAudioFile.mockResolvedValue({ status: 'picked', file: PICKED });
      // 🔴 `pressLast`, not getByTestId/getByLabelText: the heroui-native mock in
      // `__mocks__/` renders a bare View and drops testID and accessibilityLabel,
      // and the field heading repeats the button's own text.
      await act(async () => { pressLast(view.getAllByText('Hosted audio file')); });
    }

    it('uploads the chosen file instead of an audio URL', async () => {
      const view = render(<PodcastStudioRoute />);
      await waitFor(() => expect(view.getByPlaceholderText('Episode title')).toBeTruthy());

      fireEvent.changeText(view.getByPlaceholderText('Episode title'), 'Episode one');
      await chooseFile(view);
      await waitFor(() => expect(view.getByText('ep.m4a')).toBeTruthy());

      pressLast(view.getAllByText('Add episode'));

      await waitFor(() => expect(mockCreatePodcastEpisodeWithAudio).toHaveBeenCalled());
      const [showId, payload, file] = mockCreatePodcastEpisodeWithAudio.mock.calls[0]!;
      expect(showId).toBe(7);
      expect(payload).toMatchObject({ title: 'Episode one' });
      // 🔴 Sending both makes the API prefer the URL and ignore the upload.
      expect(payload).not.toHaveProperty('audio_url');
      expect(file).toMatchObject({ uri: 'file:///cache/ep.m4a', name: 'ep.m4a' });
      expect(mockCreatePodcastEpisode).not.toHaveBeenCalled();
    });

    it('passes the tenant ceiling and allowed types to the picker', async () => {
      mockGetAuthoredPodcasts.mockResolvedValue({
        shows: [SHOW],
        capabilities: { ...CAPABILITIES, max_audio_size_mb: 80, allowed_audio_mimes: ['audio/mpeg'] },
      });
      const view = render(<PodcastStudioRoute />);
      await waitFor(() => expect(view.getByPlaceholderText('Episode title')).toBeTruthy());

      await chooseFile(view);

      expect(mockPickAudioFile).toHaveBeenCalledWith({ maxMb: 80, mimes: ['audio/mpeg'] });
      expect(view.getByText(/Max 80 MB/)).toBeTruthy();
    });

    it('explains a refused file rather than failing silently', async () => {
      const view = render(<PodcastStudioRoute />);
      await waitFor(() => expect(view.getByPlaceholderText('Episode title')).toBeTruthy());

      mockPickAudioFile.mockResolvedValue({ status: 'too_large', maxMb: 250 });
      // 🔴 `pressLast`, not getByTestId/getByLabelText: the heroui-native mock in
      // `__mocks__/` renders a bare View and drops testID and accessibilityLabel,
      // and the field heading repeats the button's own text.
      await act(async () => { pressLast(view.getAllByText('Hosted audio file')); });
      expect(view.getByText('That file is larger than the 250 MB limit.')).toBeTruthy();

      mockPickAudioFile.mockResolvedValue({ status: 'unsupported_type' });
      // 🔴 `pressLast`, not getByTestId/getByLabelText: the heroui-native mock in
      // `__mocks__/` renders a bare View and drops testID and accessibilityLabel,
      // and the field heading repeats the button's own text.
      await act(async () => { pressLast(view.getAllByText('Hosted audio file')); });
      expect(view.getByText('That file type is not supported.')).toBeTruthy();

      expect(mockCreatePodcastEpisodeWithAudio).not.toHaveBeenCalled();
    });

    it('does not let a stale URL race the chosen file, and restores the field when cleared', async () => {
      const view = render(<PodcastStudioRoute />);
      await waitFor(() => expect(view.getByPlaceholderText('Episode title')).toBeTruthy());

      fireEvent.changeText(view.getByPlaceholderText('Audio URL'), 'https://example.org/old.mp3');
      await chooseFile(view);

      expect(view.getByPlaceholderText('Audio URL').props.value).toBe('');
      expect(view.getByText('Using the selected hosted file.')).toBeTruthy();

      fireEvent.press(view.getByText('Clear selected file'));
      await waitFor(() => expect(view.queryByText('Using the selected hosted file.')).toBeNull());
    });

    it('shows progress with a working cancel while the file goes out', async () => {
      let reportProgress: ((percent: number) => void) | undefined;
      let abortSignal: AbortSignal | undefined;
      mockCreatePodcastEpisodeWithAudio.mockImplementation((
        _showId: number,
        _payload: unknown,
        _file: unknown,
        options: { onProgress?: (p: number) => void; signal?: AbortSignal },
      ) => {
        reportProgress = options.onProgress;
        abortSignal = options.signal;
        return new Promise(() => { /* held open so the progress UI stays on screen */ });
      });

      const view = render(<PodcastStudioRoute />);
      await waitFor(() => expect(view.getByPlaceholderText('Episode title')).toBeTruthy());
      fireEvent.changeText(view.getByPlaceholderText('Episode title'), 'Episode one');
      await chooseFile(view);
      pressLast(view.getAllByText('Add episode'));

      await waitFor(() => expect(reportProgress).toBeDefined());
      await act(async () => { reportProgress!(42); });
      expect(view.getByText('42%')).toBeTruthy();

      await act(async () => { fireEvent.press(view.getByText('Cancel upload')); });
      expect(abortSignal?.aborted).toBe(true);
    });

    /**
     * Cancelling is not a failure. The form and the chosen file must survive it,
     * or a member who stops a slow upload has to type everything again.
     */
    it('keeps the episode details when the member cancels the upload', async () => {
      mockCreatePodcastEpisodeWithAudio.mockRejectedValue(new Error('aborted'));
      mockIsUploadAborted.mockReturnValue(true);

      const view = render(<PodcastStudioRoute />);
      await waitFor(() => expect(view.getByPlaceholderText('Episode title')).toBeTruthy());
      fireEvent.changeText(view.getByPlaceholderText('Episode title'), 'Episode one');
      await chooseFile(view);
      pressLast(view.getAllByText('Add episode'));

      await waitFor(() => expect(mockCreatePodcastEpisodeWithAudio).toHaveBeenCalled());
      expect(view.getByPlaceholderText('Episode title').props.value).toBe('Episode one');
      expect(view.getByText('ep.m4a')).toBeTruthy();
      // Not reported as a save failure.
      expect(view.queryByText('Could not save changes.')).toBeNull();
    });
  });
});
