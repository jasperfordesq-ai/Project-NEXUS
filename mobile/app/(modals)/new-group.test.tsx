// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockCreateGroup = jest.fn().mockResolvedValue({ data: { id: 484 } });
const mockGetGroup = jest.fn();
const mockGetGroupTemplates = jest.fn();
const mockUpdateGroup = jest.fn();
const mockUploadGroupImage = jest.fn();
const mockLaunchImageLibraryAsync = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockConfirm = jest.fn();
const mockNavListeners: Record<string, (e: unknown) => void> = {};
const mockNavDispatch = jest.fn();
let mockSearchParams: Record<string, string | undefined> = {};

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
  useConfirm: () => ({ confirm: (...args: unknown[]) => mockConfirm(...args), confirmDialog: null }),
}));
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/AccentIcon', () => {
  const React = require('react');
  const { View } = require('react-native');
  return () => <View testID="accent-icon" />;
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'create.eyebrow': 'New group',
        'create.loadFailedTitle': "Couldn't open this group",
        'create.loadFailed': 'Could not load group.',
        'create.unsavedTitle': 'Discard this group?',
        'create.unsavedMessage': 'You have unsaved details.',
        'create.discard': 'Discard',
        'create.failedTitle': 'Group not created',
        'common:buttons.retry': 'Retry',
        'common:buttons.cancel': 'Cancel',
        'create.title': 'Create Group',
        'create.editTitle': 'Edit Group',
        'create.subtitle': 'Start a community space.',
        'create.nameLabel': 'Group name',
        'create.namePlaceholder': 'Name your group',
        'create.descriptionLabel': 'Description',
        'create.descriptionPlaceholder': 'What is this group for?',
        'create.imageLabel': 'Group image',
        'create.imageHint': 'Add a recognisable image for this group.',
        'create.addImage': 'Add image',
        'create.replaceImage': 'Replace image',
        'create.removeImage': 'Remove',
        'create.imageTypeError': 'Choose a JPEG, PNG, WebP, or GIF image.',
        'create.imageSizeError': 'Choose an image under 5 MB.',
        'create.imagePickFailedTitle': 'Image not selected',
        'create.imagePickFailedDescription': 'We could not open your photo library.',
        'create.imageUploadFailedTitle': 'Group saved',
        'create.imageUploadFailedDescription': 'The group was saved, but the image could not be uploaded.',
        'create.locationLabel': 'Location',
        'create.locationPlaceholder': 'Optional place or area',
        'create.coordinatesLabel': 'Map coordinates',
        'create.coordinatesHint': 'Optional coordinates help maps and nearby group discovery place this group accurately.',
        'create.latitudeLabel': 'Latitude',
        'create.latitudePlaceholder': '51.5007',
        'create.longitudeLabel': 'Longitude',
        'create.longitudePlaceholder': '-0.1246',
        'create.templateLabel': 'Group template',
        'create.visibilityLabel': 'Visibility',
        'create.federated': 'List in federation',
        'create.reviewTitle': 'Ready to publish?',
        'create.editReviewTitle': 'Ready to save?',
        'create.reviewSubtitle': 'Check first.',
        'create.submit': 'Create group',
        'create.updateSubmit': 'Update group',
        'create.validationTitle': 'Check group details',
        'create.validationRequired': 'Add a group name and description before continuing.',
        'create.validationNameLength': 'Use 3 to 100 characters for the group name.',
        'create.validationDescriptionLength': 'Use 20 to 2000 characters for the group description.',
        'create.invalidCoordinates': 'Enter both latitude and longitude using valid coordinate ranges.',
        public: 'Public',
        private: 'Private',
        'common:back': 'Back',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#6366f1' }));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
    error: '#dc2626',
    surface: '#f8fafc',
  }),
}));
jest.mock('@/lib/api/groups', () => ({
  createGroup: (...args: unknown[]) => mockCreateGroup(...args),
  getGroup: (...args: unknown[]) => mockGetGroup(...args),
  getGroupTemplates: (...args: unknown[]) => mockGetGroupTemplates(...args),
  updateGroup: (...args: unknown[]) => mockUpdateGroup(...args),
  uploadGroupImage: (...args: unknown[]) => mockUploadGroupImage(...args),
}));
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

import NewGroupRoute from './new-group';
import { useAppToast } from '@/components/ui/AppToast';
import { firePreventedRemoval, isGuardArmed } from '@/lib/test/unsavedGuardHarness';

const showToast = useAppToast().show as jest.Mock;

describe('NewGroupRoute', () => {
  beforeEach(() => {
    mockCreateGroup.mockClear();
    mockGetGroup.mockReset();
    mockGetGroupTemplates.mockReset().mockResolvedValue({ data: [] });
    mockUpdateGroup.mockReset();
    mockUpdateGroup.mockResolvedValue({ data: { id: 484 } });
    mockUploadGroupImage.mockReset().mockResolvedValue({ data: { image_url: '/uploads/groups/group.jpg' } });
    mockLaunchImageLibraryAsync.mockReset().mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///tmp/group.jpg', mimeType: 'image/jpeg', fileSize: 1024 }],
    });
    mockReplace.mockClear();
    mockBack.mockClear();
    mockConfirm.mockClear();
    mockNavDispatch.mockClear();
    Object.keys(mockNavListeners).forEach((key) => { delete mockNavListeners[key]; });
    mockSearchParams = {};
    showToast.mockClear();
  });

  it('keeps the native create group frame full height with an explicit background', () => {
    const { getByTestId } = render(<NewGroupRoute />);
    const screen = getByTestId('new-group-screen');
    const scroll = getByTestId('new-group-scroll');

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

  it('requires a description before creating a group', async () => {
    const { getByPlaceholderText, getByText } = render(<NewGroupRoute />);

    fireEvent.changeText(getByPlaceholderText('Name your group'), 'Repair club');
    fireEvent.press(getByText('Create group'));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith({ title: 'Check group details', description: 'Add a group name and description before continuing.', variant: 'warning' });
    });
    expect(mockCreateGroup).not.toHaveBeenCalled();
  });

  it('requires the group name to meet the frontend length limits', async () => {
    const { getByPlaceholderText, getByText } = render(<NewGroupRoute />);

    fireEvent.changeText(getByPlaceholderText('Name your group'), 'Go');
    fireEvent.changeText(getByPlaceholderText('What is this group for?'), 'A group for sharing repair skills and local mending sessions.');
    fireEvent.press(getByText('Create group'));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith({ title: 'Check group details', description: 'Use 3 to 100 characters for the group name.', variant: 'warning' });
    });
    expect(mockCreateGroup).not.toHaveBeenCalled();
  });

  it('requires the group description to meet the frontend length limits', async () => {
    const { getByPlaceholderText, getByText } = render(<NewGroupRoute />);

    fireEvent.changeText(getByPlaceholderText('Name your group'), 'Repair club');
    fireEvent.changeText(getByPlaceholderText('What is this group for?'), 'Too short.');
    fireEvent.press(getByText('Create group'));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith({ title: 'Check group details', description: 'Use 20 to 2000 characters for the group description.', variant: 'warning' });
    });
    expect(mockCreateGroup).not.toHaveBeenCalled();
  });

  it('submits group visibility and federation settings', async () => {
    const { getByPlaceholderText, getByText } = render(<NewGroupRoute />);

    fireEvent.changeText(getByPlaceholderText('Name your group'), 'Repair club');
    fireEvent.changeText(getByPlaceholderText('What is this group for?'), 'A group for sharing repair skills and local mending sessions.');
    fireEvent.changeText(getByPlaceholderText('Optional place or area'), 'Community hall');
    fireEvent.changeText(getByPlaceholderText('51.5007'), '51.501');
    fireEvent.changeText(getByPlaceholderText('-0.1246'), '-0.125');
    fireEvent.press(getByText('Private'));
    fireEvent.press(getByText('List in federation'));
    fireEvent.press(getByText('Create group'));

    await waitFor(() => {
      expect(mockCreateGroup).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Repair club',
        description: 'A group for sharing repair skills and local mending sessions.',
        visibility: 'private',
        location: 'Community hall',
        latitude: 51.501,
        longitude: -0.125,
        federated_visibility: 'listed',
      }));
    });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/(modals)/group-detail', params: { id: '484' } }));
  });

  it('loads group templates for new groups and applies default visibility', async () => {
    mockGetGroupTemplates.mockResolvedValueOnce({
      data: [
        { id: 12, name: 'Private circle', icon: 'lock', default_visibility: 'private' },
      ],
    });

    const { getByPlaceholderText, getByText } = render(<NewGroupRoute />);

    await waitFor(() => expect(getByText('Private circle')).toBeTruthy());
    fireEvent.press(getByText('Private circle'));
    fireEvent.changeText(getByPlaceholderText('Name your group'), 'Repair club');
    fireEvent.changeText(getByPlaceholderText('What is this group for?'), 'A group for sharing repair skills and local mending sessions.');
    fireEvent.press(getByText('Create group'));

    await waitFor(() => {
      expect(mockCreateGroup).toHaveBeenCalledWith(expect.objectContaining({
        visibility: 'private',
      }));
    });
  });

  it('requires paired valid coordinates when coordinates are provided', async () => {
    const { getByPlaceholderText, getByText } = render(<NewGroupRoute />);

    fireEvent.changeText(getByPlaceholderText('Name your group'), 'Repair club');
    fireEvent.changeText(getByPlaceholderText('What is this group for?'), 'A group for sharing repair skills and local mending sessions.');
    fireEvent.changeText(getByPlaceholderText('51.5007'), '51.501');
    fireEvent.press(getByText('Create group'));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith({ title: 'Check group details', description: 'Enter both latitude and longitude using valid coordinate ranges.', variant: 'warning' });
    });
    expect(mockCreateGroup).not.toHaveBeenCalled();
  });

  it('uploads a selected group image after creating the group', async () => {
    const { getByPlaceholderText, getByText } = render(<NewGroupRoute />);

    fireEvent.changeText(getByPlaceholderText('Name your group'), 'Repair club');
    fireEvent.changeText(getByPlaceholderText('What is this group for?'), 'A group for sharing repair skills and local mending sessions.');
    fireEvent.press(getByText('Add image'));
    await waitFor(() => expect(mockLaunchImageLibraryAsync).toHaveBeenCalled());
    fireEvent.press(getByText('Create group'));

    await waitFor(() => {
      expect(mockCreateGroup).toHaveBeenCalled();
    });
    expect(mockUploadGroupImage).toHaveBeenCalledWith(484, 'file:///tmp/group.jpg');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/(modals)/group-detail', params: { id: '484' } }));
  });

  it('loads an existing group and submits updates in edit mode', async () => {
    mockSearchParams = { id: '9' };
    mockGetGroup.mockResolvedValue({
      data: {
        id: 9,
        name: 'Garden crew',
        description: 'A group for coordinating seasonal planting and shared gardening days.',
        visibility: 'private',
        location: 'Community garden',
        latitude: 52.1,
        longitude: -6.3,
        federated_visibility: 'listed',
        image_url: '/uploads/groups/existing.jpg',
      },
    });
    mockUpdateGroup.mockResolvedValue({ data: { id: 9 } });

    const { getByDisplayValue, getByPlaceholderText, getByText } = render(<NewGroupRoute />);

    await waitFor(() => {
      expect(getByDisplayValue('Garden crew')).toBeTruthy();
    });

    expect(mockGetGroupTemplates).not.toHaveBeenCalled();
    expect(getByDisplayValue('A group for coordinating seasonal planting and shared gardening days.')).toBeTruthy();
    expect(getByDisplayValue('Community garden')).toBeTruthy();
    expect(getByDisplayValue('52.1')).toBeTruthy();
    expect(getByDisplayValue('-6.3')).toBeTruthy();

    fireEvent.changeText(getByPlaceholderText('Name your group'), 'Garden exchange');
    fireEvent.changeText(getByPlaceholderText('What is this group for?'), 'A group for coordinating tool swaps, planting help, and shared gardening days.');
    fireEvent.press(getByText('Public'));
    fireEvent.press(getByText('List in federation'));
    fireEvent.press(getByText('Update group'));

    await waitFor(() => {
      expect(mockUpdateGroup).toHaveBeenCalledWith(9, expect.objectContaining({
        name: 'Garden exchange',
        description: 'A group for coordinating tool swaps, planting help, and shared gardening days.',
        visibility: 'public',
        location: 'Community garden',
        latitude: 52.1,
        longitude: -6.3,
        federated_visibility: 'none',
      }));
    });
    expect(mockCreateGroup).not.toHaveBeenCalled();
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/(modals)/group-detail', params: { id: '9' } }));
  });

  it('shows an existing group image and uploads a replacement in edit mode', async () => {
    mockSearchParams = { id: '9' };
    mockGetGroup.mockResolvedValue({
      data: {
        id: 9,
        name: 'Garden crew',
        description: 'A group for coordinating seasonal planting and shared gardening days.',
        visibility: 'private',
        location: 'Community garden',
        federated_visibility: 'listed',
        image_url: '/uploads/groups/existing.jpg',
      },
    });
    mockUpdateGroup.mockResolvedValue({ data: { id: 9 } });

    const { getByText } = render(<NewGroupRoute />);

    await waitFor(() => expect(getByText('Replace image')).toBeTruthy());
    fireEvent.press(getByText('Replace image'));
    await waitFor(() => expect(mockLaunchImageLibraryAsync).toHaveBeenCalled());
    fireEvent.press(getByText('Update group'));

    await waitFor(() => expect(mockUpdateGroup).toHaveBeenCalled());
    expect(mockUploadGroupImage).toHaveBeenCalledWith(9, 'file:///tmp/group.jpg');
  });

  function fillValidGroup(screen: ReturnType<typeof render>) {
    fireEvent.changeText(screen.getByPlaceholderText('Name your group'), 'Garden crew');
    fireEvent.changeText(screen.getByPlaceholderText('What is this group for?'), 'A group for coordinating seasonal planting and shared gardening days.');
  }

  /** 🔴 S4-02. A rejected create used to toast for a frame and then leave the form anyway. */
  it('stays on the form with the input intact when the save is rejected', async () => {
    mockCreateGroup.mockRejectedValueOnce(new Error('offline'));
    const screen = render(<NewGroupRoute />);
    fillValidGroup(screen);

    fireEvent.press(screen.getByText('Create group'));
    await waitFor(() => expect(mockCreateGroup).toHaveBeenCalled());
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Garden crew')).toBeTruthy();
  });

  /** 🔴 S4-03. A failed hydration must not leave a live "Update group" over blank fields. */
  it('withholds the form when the group cannot be loaded, offers a retry, and never saves blanks', async () => {
    mockSearchParams = { id: '9' };
    mockGetGroup.mockRejectedValueOnce(new Error('offline'));

    const { getByText, queryByText, getByDisplayValue } = render(<NewGroupRoute />);

    await waitFor(() => expect(getByText("Couldn't open this group")).toBeTruthy());
    expect(queryByText('Update group')).toBeNull();
    expect(mockUpdateGroup).not.toHaveBeenCalled();

    mockGetGroup.mockResolvedValueOnce({ data: { id: 9, name: 'Garden crew', description: 'A group for coordinating seasonal planting and shared gardening days.', visibility: 'public', federated_visibility: 'none' } });
    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(getByDisplayValue('Garden crew')).toBeTruthy());
    expect(getByText('Update group')).toBeTruthy();
  });

  /** S4-04. Dirty input is guarded on Back / gestures. */
  it('asks before discarding unsaved input', () => {
    const screen = render(<NewGroupRoute />);
    expect(isGuardArmed()).toBe(false);
    fireEvent.changeText(screen.getByPlaceholderText('Name your group'), 'Half-typed');
    expect(isGuardArmed()).toBe(true);

    firePreventedRemoval();
    expect(mockNavDispatch).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard this group?' }));
  });

  /** S4-05. Comma decimals for coordinates. */
  it('accepts comma decimals for coordinates', async () => {
    const screen = render(<NewGroupRoute />);
    fillValidGroup(screen);
    fireEvent.changeText(screen.getByPlaceholderText('51.5007'), '52,1');
    fireEvent.changeText(screen.getByPlaceholderText('-0.1246'), '-6,3');
    fireEvent.press(screen.getByText('Create group'));

    await waitFor(() => expect(mockCreateGroup).toHaveBeenCalledWith(expect.objectContaining({ latitude: 52.1, longitude: -6.3 })));
  });

  /** S4-22 / S4-26. The selected visibility uses the accent foreground and announces its state. */
  it('marks the selected visibility for assistive technology and paints its icon with the accent foreground', () => {
    const { getByLabelText, getAllByTestId } = render(<NewGroupRoute />);
    expect(getByLabelText('Public').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    expect(getByLabelText('Private').props.accessibilityState).toEqual(expect.objectContaining({ selected: false }));
    // Public (selected) is the only accent-painted icon among the three toggles.
    expect(getAllByTestId('accent-icon')).toHaveLength(1);

    fireEvent.press(getByLabelText('Private'));
    expect(getByLabelText('Private').props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
  });

  /** S6-07. Footer copy and disabled state follow the required fields. */
  it('derives the footer copy and disabled state from the required fields', () => {
    const screen = render(<NewGroupRoute />);
    expect(screen.getByTestId('footer-submit').props.accessibilityState.disabled).toBe(true);
    fillValidGroup(screen);
    expect(screen.getByTestId('footer-submit').props.accessibilityState.disabled).toBe(false);
  });
});
