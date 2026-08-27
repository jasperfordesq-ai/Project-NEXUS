// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';

import CommentSheet from './CommentSheet';
import type { ConfirmOptions } from '@/components/ui/useConfirm';

const mockGetComments = jest.fn();
const mockSubmitComment = jest.fn();
const mockEditComment = jest.fn();
const mockDeleteComment = jest.fn();
const mockToggleCommentReaction = jest.fn();
const mockConfirm = jest.fn();
const mockShowToast = jest.fn();
const mockAwareOnBlur = jest.fn();
const mockAwareOnFocus = jest.fn();
const bottomSheetRootProps: Record<string, unknown>[] = [];
const bottomSheetContentProps: Record<string, unknown>[] = [];
const bottomSheetFlatListProps: Record<string, unknown>[] = [];
const bottomSheetFooterProps: Record<string, unknown>[] = [];

jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const { View } = require('react-native');

  return {
    BottomSheetFlatList: (props: {
      data?: unknown[];
      renderItem?: (info: { item: unknown }) => React.ReactElement;
      ListEmptyComponent?: unknown;
    }) => {
      bottomSheetFlatListProps.push(props);
      const { data, renderItem, ListEmptyComponent } = props;
      const items = Array.isArray(data) ? data : [];

      return (
        <View testID="comment-list">
          {items.length === 0
            ? typeof ListEmptyComponent === 'function'
              ? React.createElement(ListEmptyComponent as React.ComponentType)
              : (ListEmptyComponent as React.ReactElement | null)
            : items.map((item, index) => (
                <React.Fragment key={index}>{renderItem?.({ item })}</React.Fragment>
              ))}
        </View>
      );
    },
    BottomSheetFooter: (props: { children: React.ReactNode; bottomInset?: number }) => {
      bottomSheetFooterProps.push(props);
      return <View testID="comment-footer">{props.children}</View>;
    },
  };
});

jest.mock('heroui-native', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');

  const BottomSheet = (props: { children: React.ReactNode; isOpen: boolean }) => {
    bottomSheetRootProps.push(props);
    return <View testID="comment-bottom-sheet">{props.children}</View>;
  };
  BottomSheet.Portal = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  BottomSheet.Overlay = () => <View />;
  BottomSheet.Content = (props: Record<string, unknown> & { children: React.ReactNode }) => {
    bottomSheetContentProps.push(props);
    const FooterComponent = props.footerComponent as React.ComponentType<Record<string, unknown>> | undefined;

    return (
      <View>
        {props.children}
        {FooterComponent ? <FooterComponent animatedFooterPosition={{}} /> : null}
      </View>
    );
  };
  BottomSheet.Title = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  BottomSheet.Close = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;

  const Button = ({
    children,
    onPress,
    accessibilityLabel,
    isDisabled,
  }: {
    children: React.ReactNode;
    onPress?: () => void;
    accessibilityLabel?: string;
    isDisabled?: boolean;
  }) => (
    <Pressable accessibilityLabel={accessibilityLabel} disabled={isDisabled} onPress={onPress}>
      {children}
    </Pressable>
  );

  return {
    BottomSheet,
    Button,
    Spinner: () => <View />,
    Surface: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    useBottomSheetAwareHandlers: () => ({ onBlur: mockAwareOnBlur, onFocus: mockAwareOnFocus }),
  };
});

jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/Input', () => {
  const React = require('react');
  const { TextInput } = require('react-native');
  return function MockInput(props: Record<string, unknown>) {
    return <TextInput testID="legacy-comment-input" {...props} />;
  };
});
jest.mock('@/components/ui/TextArea', () => {
  const React = require('react');
  const { TextInput } = require('react-native');
  return function MockTextArea(props: Record<string, unknown>) {
    return <TextInput testID="native-comment-text-area" {...props} />;
  };
});
jest.mock('@/components/ui/ActionSheet', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return function MockActionSheet({
    visible,
    actions,
  }: {
    visible: boolean;
    actions: { label: string; onPress: () => void; destructive?: boolean }[];
  }) {
    if (!visible) return null;
    return (
      <View testID="comment-action-sheet">
        {actions.map((action) => (
          <Pressable key={action.label} testID={`comment-action-${action.label}`} onPress={action.onPress}>
            <Text>{action.label}</Text>
          </Pressable>
        ))}
      </View>
    );
  };
});
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({ confirm: mockConfirm, confirmDialog: null }),
}));
jest.mock('@/components/ui/AppToast', () => ({
  useAppToast: () => ({ show: mockShowToast }),
}));
// NOTE: the factory can run before the const mock fns above are assigned
// (requireActual defeats babel's lazy-import deferral), so reference them
// lazily through wrapper functions instead of by value.
jest.mock('@/lib/api/comments', () => ({
  ...jest.requireActual('@/lib/api/comments'),
  getComments: (...args: unknown[]) => mockGetComments(...args),
  submitComment: (...args: unknown[]) => mockSubmitComment(...args),
  editComment: (...args: unknown[]) => mockEditComment(...args),
  deleteComment: (...args: unknown[]) => mockDeleteComment(...args),
  toggleCommentReaction: (...args: unknown[]) => mockToggleCommentReaction(...args),
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#0F0F0F',
    surface: '#18181B',
    text: '#F4F4F5',
    textMuted: '#A1A1AA',
    textSecondary: '#D4D4D8',
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 24, left: 0, right: 0, top: 0 }),
}));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

const baseStrings = {
  actionFailedTitle: 'Comment failed',
  authorFallback: 'Member',
  empty: 'No comments yet',
  loadFailed: 'Could not load comments',
  placeholder: 'Write a comment',
  send: 'Send',
  submitFailed: 'Could not send comment',
  title: 'Comments',
  reply: 'Reply',
  replyingTo: 'Replying to {name}',
  edit: 'Edit',
  editing: 'Editing',
  delete: 'Delete',
  deleteConfirmTitle: 'Delete comment',
  deleteConfirmMessage: 'Delete this comment? Any replies will also be deleted.',
  edited: '(edited)',
  cancel: 'Cancel',
  like: 'Like',
  editFailed: 'Could not update comment',
  deleteFailed: 'Could not delete comment',
  reactionFailed: 'Could not update comment reaction',
};

function makeComment(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    content: 'First comment',
    created_at: '2026-06-01T10:00:00Z',
    edited: false,
    is_own: true,
    author: { id: 3, name: 'Sam', avatar: null },
    reactions: { love: 1 },
    user_reactions: [],
    replies: [],
    ...overrides,
  };
}

async function openSheetWithComments(comments: unknown[]) {
  mockGetComments.mockResolvedValue({ data: { comments, count: comments.length } });
  const utils = render(
    <CommentSheet
      visible
      targetType="listing"
      targetId={213}
      strings={baseStrings}
      onClose={jest.fn()}
      onCountChange={jest.fn()}
    />,
  );
  await waitFor(() => {
    expect(mockGetComments).toHaveBeenCalled();
  });
  return utils;
}

async function longPressRow(getByTestId: (id: string) => unknown, rowTestId: string) {
  jest.useFakeTimers();
  fireEvent(getByTestId(rowTestId) as never, 'pressIn');
  act(() => {
    jest.advanceTimersByTime(500);
  });
  fireEvent(getByTestId(rowTestId) as never, 'pressOut');
  jest.useRealTimers();
}

describe('CommentSheet', () => {
  const originalPlatformOS = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAwareOnBlur.mockReset();
    mockAwareOnFocus.mockReset();
    bottomSheetRootProps.length = 0;
    bottomSheetContentProps.length = 0;
    bottomSheetFlatListProps.length = 0;
    bottomSheetFooterProps.length = 0;
    jest.useRealTimers();
    mockGetComments.mockResolvedValue({ data: { comments: [], count: 0 } });
    mockSubmitComment.mockResolvedValue({ data: {} });
    mockEditComment.mockResolvedValue({ data: {} });
    mockDeleteComment.mockResolvedValue({ data: {} });
    mockToggleCommentReaction.mockResolvedValue({ data: {} });
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalPlatformOS });
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalPlatformOS });
  });

  it('uses the shared HeroUI Native text area composer', async () => {
    const { getByTestId, queryByTestId } = render(
      <CommentSheet
        visible
        targetType="listing"
        targetId={213}
        strings={baseStrings}
        onClose={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByTestId('native-comment-text-area')).toBeTruthy();
      expect(queryByTestId('legacy-comment-input')).toBeNull();
    });
  });

  it('does not mount a closed sheet portal over the feed', () => {
    const { queryByTestId } = render(
      <CommentSheet
        visible={false}
        targetType="listing"
        targetId={213}
        strings={baseStrings}
        onClose={jest.fn()}
      />,
    );

    expect(queryByTestId('comment-bottom-sheet')).toBeNull();
  });

  it('shows a native toast if comments cannot load', async () => {
    mockGetComments.mockRejectedValueOnce(new Error('Network failed'));

    render(
      <CommentSheet
        visible
        targetType="listing"
        targetId={213}
        strings={baseStrings}
        onClose={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
        description: 'Could not load comments',
        title: 'Comment failed',
        variant: 'danger',
      }));
    });
  });

  it('mounts closed before opening so HeroUI Native can snap comments into view', () => {
    jest.useFakeTimers();
    const props = {
      targetType: 'listing' as const,
      targetId: 213,
      strings: baseStrings,
      onClose: jest.fn(),
    };
    const { rerender } = render(<CommentSheet {...props} visible={false} />);

    rerender(<CommentSheet {...props} visible />);

    expect(bottomSheetRootProps.at(-1)?.isOpen).toBe(false);

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(bottomSheetRootProps.at(-1)?.isOpen).toBe(true);
  });

  it('keeps the full-screen sheet container transparent', async () => {
    render(
      <CommentSheet
        visible
        targetType="listing"
        targetId={213}
        strings={baseStrings}
        onClose={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(bottomSheetContentProps[0]?.backgroundClassName).toEqual(expect.stringContaining('bg-background'));
    });
    expect(bottomSheetContentProps[0]?.className).toBeUndefined();
    expect(bottomSheetContentProps[0]?.containerClassName).toBeUndefined();
  });

  it('pins the composer in the native bottom sheet footer above the safe area', async () => {
    const { getByTestId } = render(
      <CommentSheet
        visible
        targetType="listing"
        targetId={213}
        strings={baseStrings}
        onClose={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByTestId('comment-footer')).toBeTruthy();
      expect(getByTestId('native-comment-text-area')).toBeTruthy();
    });

    expect(bottomSheetContentProps[0]?.footerComponent).toEqual(expect.any(Function));
    expect(bottomSheetFooterProps[0]?.bottomInset).toBe(24);
    expect(bottomSheetFlatListProps[0]?.contentContainerStyle).toEqual(expect.objectContaining({
      paddingBottom: expect.any(Number),
    }));
    expect((bottomSheetFlatListProps[0]?.contentContainerStyle as { paddingBottom: number }).paddingBottom).toBeGreaterThanOrEqual(120);
  });

  it('does not attach the native bottom sheet blur handler on web preview', async () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'web' });
    mockAwareOnBlur.mockImplementation(() => {
      throw new Error('currentlyFocusedInput is not a function');
    });

    const { getByTestId } = render(
      <CommentSheet
        visible
        targetType="listing"
        targetId={213}
        strings={baseStrings}
        onClose={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByTestId('native-comment-text-area')).toBeTruthy();
    });

    expect(() => {
      fireEvent(getByTestId('native-comment-text-area'), 'blur', { nativeEvent: { target: 1 } });
    }).not.toThrow();
    expect(mockAwareOnBlur).not.toHaveBeenCalled();
  });

  it('submits a reply with the parent comment id and shows a cancellable pill', async () => {
    const { getByTestId, getByText, queryByTestId, getByLabelText } = await openSheetWithComments([makeComment()]);

    await waitFor(() => {
      expect(getByTestId('comment-reply-7')).toBeTruthy();
    });

    fireEvent.press(getByTestId('comment-reply-7'));
    expect(getByTestId('comment-composer-context')).toBeTruthy();
    expect(getByText('Replying to Sam')).toBeTruthy();

    fireEvent.changeText(getByTestId('native-comment-text-area'), 'A threaded reply');
    await act(async () => {
      fireEvent.press(getByLabelText('Send'));
    });

    await waitFor(() => {
      expect(mockSubmitComment).toHaveBeenCalledWith('listing', 213, 'A threaded reply', 7);
    });
    // The pill clears after a successful reply.
    await waitFor(() => {
      expect(queryByTestId('comment-composer-context')).toBeNull();
    });
  });

  it('cancels reply mode from the pill X without submitting', async () => {
    const { getByTestId, queryByTestId } = await openSheetWithComments([makeComment()]);

    await waitFor(() => {
      expect(getByTestId('comment-reply-7')).toBeTruthy();
    });

    fireEvent.press(getByTestId('comment-reply-7'));
    expect(getByTestId('comment-composer-context')).toBeTruthy();

    fireEvent.press(getByTestId('comment-composer-context-cancel'));
    expect(queryByTestId('comment-composer-context')).toBeNull();
    expect(mockSubmitComment).not.toHaveBeenCalled();
  });

  it('does not offer reply on max-depth comments', async () => {
    const nested = makeComment({
      id: 1,
      replies: [
        makeComment({
          id: 2,
          replies: [makeComment({ id: 3, replies: [] })],
        }),
      ],
    });
    const { getByTestId, queryByTestId } = await openSheetWithComments([nested]);

    await waitFor(() => {
      expect(getByTestId('comment-reply-1')).toBeTruthy();
    });
    expect(getByTestId('comment-reply-2')).toBeTruthy();
    expect(queryByTestId('comment-reply-3')).toBeNull();
  });

  it('edits an own comment through long-press → Edit → submit', async () => {
    const { getByTestId, getByText, getByLabelText } = await openSheetWithComments([makeComment()]);

    await waitFor(() => {
      expect(getByTestId('comment-row-7')).toBeTruthy();
    });

    await longPressRow(getByTestId, 'comment-row-7');

    await waitFor(() => {
      expect(getByTestId('comment-action-sheet')).toBeTruthy();
    });

    fireEvent.press(getByTestId('comment-action-Edit'));

    // Composer is pre-filled with the existing content and shows the Editing pill.
    expect(getByTestId('native-comment-text-area').props.value).toBe('First comment');
    expect(getByText('Editing')).toBeTruthy();

    fireEvent.changeText(getByTestId('native-comment-text-area'), 'Updated comment');
    await act(async () => {
      fireEvent.press(getByLabelText('Send'));
    });

    await waitFor(() => {
      expect(mockEditComment).toHaveBeenCalledWith(7, 'Updated comment');
    });
    expect(mockSubmitComment).not.toHaveBeenCalled();
  });

  it('deletes an own comment after confirmation and refetches', async () => {
    const onCountChange = jest.fn();
    mockGetComments.mockResolvedValue({ data: { comments: [makeComment()], count: 1 } });
    const { getByTestId } = render(
      <CommentSheet
        visible
        targetType="listing"
        targetId={213}
        strings={baseStrings}
        onClose={jest.fn()}
        onCountChange={onCountChange}
      />,
    );

    await waitFor(() => {
      expect(getByTestId('comment-row-7')).toBeTruthy();
    });

    await longPressRow(getByTestId, 'comment-row-7');

    await waitFor(() => {
      expect(getByTestId('comment-action-sheet')).toBeTruthy();
    });

    fireEvent.press(getByTestId('comment-action-Delete'));

    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Delete comment',
      message: 'Delete this comment? Any replies will also be deleted.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    }));
    expect(mockDeleteComment).not.toHaveBeenCalled();

    mockGetComments.mockResolvedValue({ data: { comments: [], count: 0 } });
    const options = mockConfirm.mock.calls[0][0] as ConfirmOptions;
    await act(async () => {
      await options.onConfirm();
    });

    expect(mockDeleteComment).toHaveBeenCalledWith(7);
    expect(onCountChange).toHaveBeenLastCalledWith(0);
  });

  it('hides Edit/Delete for comments that are not own', async () => {
    const { getByTestId, queryByTestId } = await openSheetWithComments([makeComment({ is_own: false })]);

    await waitFor(() => {
      expect(getByTestId('comment-row-7')).toBeTruthy();
    });

    await longPressRow(getByTestId, 'comment-row-7');

    await waitFor(() => {
      expect(getByTestId('comment-action-sheet')).toBeTruthy();
    });
    expect(getByTestId('comment-action-Reply')).toBeTruthy();
    expect(queryByTestId('comment-action-Edit')).toBeNull();
    expect(queryByTestId('comment-action-Delete')).toBeNull();
  });

  it('optimistically toggles a comment like and calls the reaction endpoint', async () => {
    const { getByTestId, getByText } = await openSheetWithComments([
      makeComment({ reactions: { love: 1 }, user_reactions: [] }),
    ]);

    await waitFor(() => {
      expect(getByTestId('comment-like-7')).toBeTruthy();
    });
    // love(1) only before toggling.
    expect(getByText('1')).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId('comment-like-7'));
    });

    expect(mockToggleCommentReaction).toHaveBeenCalledWith(7, 'like');
    // Optimistic: love(1) + like(1) = 2 without waiting for a refetch.
    expect(getByText('2')).toBeTruthy();
  });

  it('removes an existing like optimistically when tapped again', async () => {
    const { getByTestId, queryByText } = await openSheetWithComments([
      makeComment({ reactions: { like: 1 }, user_reactions: ['like'] }),
    ]);

    await waitFor(() => {
      expect(getByTestId('comment-like-7')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByTestId('comment-like-7'));
    });

    expect(mockToggleCommentReaction).toHaveBeenCalledWith(7, 'like');
    expect(queryByText('1')).toBeNull();
  });

  it('shows visible feedback and reloads comments when a reaction fails', async () => {
    mockToggleCommentReaction.mockRejectedValueOnce(new Error('Network failed'));
    const { getByTestId } = await openSheetWithComments([
      makeComment({ reactions: {}, user_reactions: [] }),
    ]);

    await act(async () => {
      fireEvent.press(getByTestId('comment-like-7'));
    });

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Comment failed',
        description: 'Could not update comment reaction',
        variant: 'danger',
      }));
      expect(mockGetComments).toHaveBeenCalledTimes(2);
    });
  });

  it('renders the edited indicator on edited comments', async () => {
    const { getByTestId, getByText } = await openSheetWithComments([makeComment({ edited: true })]);

    await waitFor(() => {
      expect(getByTestId('comment-edited-7')).toBeTruthy();
    });
    expect(getByText('(edited)')).toBeTruthy();
  });

  it('shows the character counter only near the limit', async () => {
    const { getByTestId, queryByTestId } = await openSheetWithComments([]);

    await waitFor(() => {
      expect(getByTestId('native-comment-text-area')).toBeTruthy();
    });
    expect(getByTestId('native-comment-text-area').props.maxLength).toBe(10000);
    expect(queryByTestId('comment-composer-counter')).toBeNull();

    fireEvent.changeText(getByTestId('native-comment-text-area'), 'a'.repeat(9420));

    expect(getByTestId('comment-composer-counter')).toBeTruthy();
    expect(getByTestId('comment-composer-counter').props.children).toBe(
      `${(9420).toLocaleString()} / ${(10000).toLocaleString()}`,
    );
  });
});
