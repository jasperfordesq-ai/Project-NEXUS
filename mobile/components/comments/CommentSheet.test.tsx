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
const mockScrollToIndex = jest.fn();
const mockScrollToOffset = jest.fn();

jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const { View } = require('react-native');

  return {
    BottomSheetFlatList: React.forwardRef((props: {
      data?: unknown[];
      renderItem?: (info: { item: unknown }) => React.ReactElement;
      ListEmptyComponent?: unknown;
      ListHeaderComponent?: React.ReactElement;
    }, ref: unknown) => {
      React.useImperativeHandle(ref, () => ({
        scrollToIndex: mockScrollToIndex,
        scrollToOffset: mockScrollToOffset,
      }));
      bottomSheetFlatListProps.push(props);
      const { data, renderItem, ListEmptyComponent } = props;
      const items = Array.isArray(data) ? data : [];

      return (
        <View testID="comment-list">
          {props.ListHeaderComponent}
          {items.length === 0
            ? typeof ListEmptyComponent === 'function'
              ? React.createElement(ListEmptyComponent as React.ComponentType)
              : (ListEmptyComponent as React.ReactElement | null)
            : items.map((item, index) => (
                <React.Fragment key={index}>{renderItem?.({ item })}</React.Fragment>
              ))}
        </View>
      );
    }),
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
    Button: Object.assign(Button, { Label: Text }),
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
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
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
  it.each([true, false])('preserves a newer reaction across an overlapping reload (reactionFirst=%s)', async (reactionFirst) => {
    let finishRead!: (value: unknown) => void;
    let finishReaction!: (value: unknown) => void;
    const screen = await openSheetWithComments([makeComment()]);
    mockGetComments.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
    fireEvent.changeText(screen.getByTestId('native-comment-text-area'), 'Another comment');
    await act(async () => { fireEvent.press(screen.getByLabelText('Send')); });
    mockToggleCommentReaction.mockImplementationOnce(() => new Promise((resolve) => { finishReaction = resolve; }));
    fireEvent.press(screen.getByTestId('comment-like-7'));
    const reaction = { data: { action: 'added', reaction_type: 'like', reactions: { counts: { love: 1, like: 1 }, total: 2, user_reaction: 'like' } } };
    if (reactionFirst) await act(async () => { finishReaction(reaction); });
    await act(async () => { finishRead({ data: { comments: [makeComment({ content: 'Fresh content' })], count: 1 } }); });
    expect(screen.getByText('Fresh content')).toBeTruthy();
    expect(screen.getByTestId('comment-like-7').props.accessibilityState.selected).toBe(true);
    expect(screen.getByText('2')).toBeTruthy();
    if (!reactionFirst) await act(async () => { finishReaction(reaction); });
    mockGetComments.mockResolvedValueOnce({ data: {
      comments: [makeComment({ reactions: { like: 5 }, user_reactions: ['like'] })], count: 1,
    } });
    fireEvent.changeText(screen.getByTestId('native-comment-text-area'), 'Later comment');
    await act(async () => { fireEvent.press(screen.getByLabelText('Send')); });
    expect(screen.getByText('5')).toBeTruthy();
  });
  it.each(['open', 'closed', 'departed'])('guards repeated retained reaction callbacks (%s)', async (state) => {
    mockToggleCommentReaction.mockImplementationOnce(() => new Promise(() => {}));
    const screen = await openSheetWithComments([makeComment()]);
    let button = screen.getByTestId('comment-like-7');
    while (!button.props.onPress && button.parent) button = button.parent;
    const press = button.props.onPress;
    if (state === 'departed') screen.unmount();
    if (state === 'closed') screen.rerender(<CommentSheet visible={false} targetType="listing" targetId={213} strings={baseStrings} onClose={jest.fn()} />);
    await act(async () => { press(); press(); });
    expect(mockToggleCommentReaction).toHaveBeenCalledTimes(state === 'open' ? 1 : 0);
  });

  it('suppresses a pending reaction failure after departure', async () => {
    let rejectReaction!: (error: Error) => void;
    mockToggleCommentReaction.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectReaction = reject; }));
    const screen = await openSheetWithComments([makeComment()]);
    fireEvent.press(screen.getByTestId('comment-like-7'));
    screen.unmount();
    await act(async () => { rejectReaction(new Error('Offline')); });
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockGetComments).toHaveBeenCalledTimes(1);
  });
  it('keeps unrelated reactions available and unlocks a completed reaction', async () => {
    let finish!: (value: unknown) => void;
    mockToggleCommentReaction.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const screen = await openSheetWithComments([makeComment(), makeComment({ id: 8 })]);
    fireEvent.press(screen.getByTestId('comment-like-7'));
    expect(screen.getByTestId('comment-like-7').props.accessibilityState.busy).toBe(true);
    expect(screen.getByTestId('comment-like-8').props.accessibilityState.disabled).toBe(false);
    await act(async () => { fireEvent.press(screen.getByTestId('comment-like-8')); });
    expect(mockToggleCommentReaction).toHaveBeenCalledTimes(2);
    await act(async () => { finish({ data: {} }); });
    expect(screen.getByTestId('comment-like-7').props.accessibilityState.busy).toBe(false);
    await act(async () => { fireEvent.press(screen.getByTestId('comment-like-7')); });
    expect(mockToggleCommentReaction).toHaveBeenCalledTimes(3);
  });
  it.each(['open', 'closed', 'reopened', 'departed'])('guards retained delete confirmations (%s)', async (state) => {
    mockDeleteComment.mockImplementationOnce(() => new Promise(() => {}));
    const screen = await openSheetWithComments([makeComment()]);
    await longPressRow(screen.getByTestId, 'comment-row-7');
    fireEvent.press(screen.getByTestId('comment-action-Delete'));
    const options = mockConfirm.mock.calls[0][0] as ConfirmOptions;
    if (state === 'departed') screen.unmount();
    if (state === 'closed' || state === 'reopened') {
      screen.rerender(<CommentSheet visible={false} targetType="listing" targetId={213} strings={baseStrings} onClose={jest.fn()} />);
      if (state === 'reopened') screen.rerender(<CommentSheet visible targetType="listing" targetId={213} strings={baseStrings} onClose={jest.fn()} />);
    }
    await act(async () => { void options.onConfirm?.(); void options.onConfirm?.(); });
    expect(mockDeleteComment).toHaveBeenCalledTimes(state === 'open' ? 1 : 0);
  });
  it.each(['open', 'closed', 'reopened', 'changed', 'departed'])('guards retained send callbacks (%s)', async (state) => {
    mockSubmitComment.mockImplementationOnce(() => new Promise(() => {}));
    const screen = await openSheetWithComments([]);
    fireEvent.changeText(screen.getByTestId('native-comment-text-area'), 'Draft comment');
    let button = screen.getByLabelText('Send');
    while (!button.props.onPress && button.parent) button = button.parent;
    const press = button.props.onPress;
    if (state === 'departed') screen.unmount();
    if (state === 'changed') fireEvent.changeText(screen.getByTestId('native-comment-text-area'), 'Replacement draft');
    if (state === 'closed' || state === 'reopened') {
      screen.rerender(<CommentSheet visible={false} targetType="listing" targetId={213} strings={baseStrings} onClose={jest.fn()} />);
      if (state === 'reopened') screen.rerender(<CommentSheet visible targetType="listing" targetId={213} strings={baseStrings} onClose={jest.fn()} />);
    }
    await act(async () => { void press(); void press(); });
    expect(mockSubmitComment).toHaveBeenCalledTimes(state === 'open' ? 1 : 0);
    if (state === 'changed' || state === 'reopened') {
      fireEvent.changeText(screen.getByTestId('native-comment-text-area'), 'Current draft');
      await act(async () => { fireEvent.press(screen.getByLabelText('Send')); });
      expect(mockSubmitComment).toHaveBeenCalledWith('listing', 213, 'Current draft', undefined);
    }
  });
  it('refreshes after a send completes during the initial read and ignores that older snapshot', async () => {
    let finishInitial!: (value: unknown) => void;
    mockGetComments.mockImplementationOnce(() => new Promise(resolve => { finishInitial = resolve; }));
    const screen = render(<CommentSheet visible targetType="listing" targetId={213} strings={baseStrings} onClose={jest.fn()} />);
    fireEvent.changeText(screen.getByTestId('native-comment-text-area'), 'Newly sent');
    mockGetComments.mockResolvedValueOnce({ data: { comments: [makeComment({ content: 'Newly sent' })], count: 1 } });
    await act(async () => { fireEvent.press(screen.getByLabelText('Send')); });
    expect(mockGetComments).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Newly sent')).toBeTruthy();
    await act(async () => { finishInitial({ data: { comments: [], count: 0 } }); });
    expect(screen.getByText('Newly sent')).toBeTruthy();
  });

  it('preserves text typed while a comment send is pending', async () => {
    let finish!: () => void;
    mockSubmitComment.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ data: {} }); }));
    const screen = await openSheetWithComments([]);
    fireEvent.changeText(screen.getByTestId('native-comment-text-area'), 'First comment draft');
    fireEvent.press(screen.getByLabelText('Send'));
    fireEvent.changeText(screen.getByTestId('native-comment-text-area'), 'Next comment draft');
    await act(async () => { finish(); });
    expect(screen.getByTestId('native-comment-text-area').props.value).toBe('Next comment draft');
  });
  it.each([false, true])('ignores submitted-comment completion after departure (refused=%s)', async (refused) => {
    let finish!: () => void;
    mockSubmitComment.mockImplementationOnce(() => new Promise((resolve, reject) => {
      finish = () => refused ? reject(new Error('Refused')) : resolve({ data: {} });
    }));
    const onCountChange = jest.fn();
    const screen = render(<CommentSheet visible targetType="blog" targetId={7} strings={baseStrings} onCountChange={onCountChange} onClose={jest.fn()} />);
    await waitFor(() => expect(onCountChange).toHaveBeenCalled());
    fireEvent.changeText(screen.getByTestId('native-comment-text-area'), 'Submitted comment');
    fireEvent.press(screen.getByLabelText('Send'));
    onCountChange.mockClear();
    screen.unmount();
    await act(async () => { finish(); });
    expect(onCountChange).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockGetComments).toHaveBeenCalledTimes(1);
  });
  it('keeps existing comments and offers read-only retry after a post-send reload fails', async () => {
    const screen = await openSheetWithComments([makeComment()]);
    mockGetComments.mockRejectedValueOnce(new Error('Offline'));
    fireEvent.changeText(screen.getByTestId('native-comment-text-area'), 'New comment');
    fireEvent.press(screen.getByLabelText('Send'));
    await waitFor(() => expect(screen.getByTestId('refresh-failed-notice')).toBeTruthy());
    expect(screen.getByTestId('comment-row-7')).toBeTruthy();
    mockGetComments.mockResolvedValueOnce({ data: { comments: [makeComment({ content: 'Refreshed comment' })], count: 1 } });
    fireEvent.press(screen.getByLabelText('Retry'));
    await waitFor(() => expect(screen.getByText('Refreshed comment')).toBeTruthy());
    expect(screen.queryByTestId('refresh-failed-notice')).toBeNull();
    expect(mockGetComments).toHaveBeenCalledTimes(3);
    expect(mockSubmitComment).toHaveBeenCalledTimes(1);
  });

  it('preserves a refused draft and allows an explicit retry', async () => {
    mockSubmitComment.mockRejectedValueOnce(new Error('Refused'));
    const screen = await openSheetWithComments([]);
    fireEvent.changeText(screen.getByTestId('native-comment-text-area'), 'Keep this draft');
    fireEvent.press(screen.getByLabelText('Send'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    expect(screen.getByTestId('native-comment-text-area').props.value).toBe('Keep this draft');
    fireEvent.press(screen.getByLabelText('Send'));
    await waitFor(() => expect(mockSubmitComment).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('native-comment-text-area').props.value).toBe(''));
  });
  it('starts the new target read immediately and ignores a late previous-target response', async () => {
    let finishPrevious!: () => void;
    let finishCurrent!: () => void;
    mockGetComments.mockImplementationOnce(() => new Promise((resolve) => {
      finishPrevious = () => resolve({ data: { comments: [makeComment({ content: 'Old article comment' })], count: 9 } });
    })).mockImplementationOnce(() => new Promise((resolve) => {
      finishCurrent = () => resolve({ data: { comments: [makeComment({ id: 8, content: 'New article comment' })], count: 1 } });
    }));
    const onCountChange = jest.fn();
    const screen = render(<CommentSheet visible targetType="blog" targetId={7} strings={baseStrings} onCountChange={onCountChange} onClose={jest.fn()} />);
    screen.rerender(<CommentSheet visible targetType="blog" targetId={8} strings={baseStrings} onCountChange={onCountChange} onClose={jest.fn()} />);
    expect(mockGetComments).toHaveBeenLastCalledWith('blog', 8);
    await act(async () => { finishCurrent(); });
    await act(async () => { finishPrevious(); });
    expect(screen.getByText('New article comment')).toBeTruthy();
    expect(screen.queryByText('Old article comment')).toBeNull();
    expect(onCountChange.mock.calls).toEqual([[1]]);
  });
  it('does not report a read failure after the sheet unmounts', async () => {
    let fail!: () => void;
    mockGetComments.mockImplementationOnce(() => new Promise((_, reject) => { fail = () => reject(new Error('Offline')); }));
    const screen = render(<CommentSheet visible targetType="blog" targetId={7} strings={baseStrings} onClose={jest.fn()} />);
    screen.unmount();
    await act(async () => { fail(); });
    expect(mockShowToast).not.toHaveBeenCalled();
  });
  it('stops after a failed initial read instead of immediately requesting again', async () => {
    mockGetComments.mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce({ data: { comments: [makeComment()], count: 1 } });
    const screen = render(<CommentSheet visible targetType="blog" targetId={7} strings={baseStrings} onClose={jest.fn()} />);
    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    expect(mockGetComments).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('No comments yet')).toBeNull();
    expect(screen.getAllByText('Could not load comments').length).toBeGreaterThan(0);
    fireEvent.press(screen.getByText('Retry'));
    await screen.findByText('First comment');
    expect(mockGetComments).toHaveBeenCalledTimes(2);
  });
  const originalPlatformOS = Platform.OS;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAwareOnBlur.mockReset();
    mockAwareOnFocus.mockReset();
    mockScrollToIndex.mockReset();
    mockScrollToOffset.mockReset();
    bottomSheetRootProps.length = 0;
    bottomSheetContentProps.length = 0;
    bottomSheetFlatListProps.length = 0;
    bottomSheetFooterProps.length = 0;
    jest.useRealTimers();
    mockGetComments.mockReset().mockResolvedValue({ data: { comments: [], count: 0 } });
    mockSubmitComment.mockReset().mockResolvedValue({ data: {} });
    mockEditComment.mockResolvedValue({ data: {} });
    mockDeleteComment.mockReset().mockResolvedValue({ data: {} });
    mockToggleCommentReaction.mockReset().mockResolvedValue({ data: {} });
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

  it('mounts closed before opening so HeroUI Native can snap comments into view', async () => {
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
    await act(async () => { await mockGetComments.mock.results[0].value; });
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
    await act(async () => {
      await options.onConfirm();
    });
    expect(mockDeleteComment).toHaveBeenCalledTimes(1);
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

  it('replaces the viewers previous reaction and accepts authoritative reaction counts', async () => {
    let resolveReaction!: (value: unknown) => void;
    mockToggleCommentReaction.mockImplementationOnce(() => new Promise((resolve) => { resolveReaction = resolve; }));
    const screen = await openSheetWithComments([makeComment({ reactions: { love: 2 }, user_reactions: ['love'] })]);
    fireEvent.press(screen.getByTestId('comment-like-7'));
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.queryByText('3')).toBeNull();
    await act(async () => { resolveReaction({ data: {
      action: 'updated', reaction_type: 'like',
      reactions: { counts: { love: 3, like: 1 }, total: 4, user_reaction: 'like' },
    } }); });
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByTestId('comment-like-7').props.accessibilityState.selected).toBe(true);
  });

  it('accepts authoritative removal with a null viewer reaction', async () => {
    mockToggleCommentReaction.mockResolvedValueOnce({ data: {
      action: 'removed', reaction_type: null,
      reactions: { counts: { love: 5 }, total: 5, user_reaction: null },
    } });
    const screen = await openSheetWithComments([makeComment({ reactions: { like: 1 }, user_reactions: ['like'] })]);
    await act(async () => { fireEvent.press(screen.getByTestId('comment-like-7')); });
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByTestId('comment-like-7').props.accessibilityState.selected).toBe(false);
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

  it('scrolls to and marks the exact comment named by a notification link', async () => {
    mockGetComments.mockResolvedValue({
      data: { comments: [makeComment(), makeComment({ id: 8, content: 'Linked comment' })], count: 2 },
    });
    const { getByTestId } = render(
      <CommentSheet
        visible
        targetType="listing"
        targetId={213}
        focusCommentId={8}
        strings={baseStrings}
        onClose={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByTestId('comment-row-8').props.accessibilityState).toEqual({ selected: true });
      expect(getByTestId('comment-row-7').props.accessibilityState).toEqual({ selected: false });
      expect(mockScrollToIndex).toHaveBeenCalledWith({ animated: true, index: 1, viewPosition: 0.3 });
    });
  });

  it('recovers when the virtual list has not measured the linked comment yet', async () => {
    const { getByTestId } = await openSheetWithComments([makeComment(), makeComment({ id: 8 })]);
    await waitFor(() => expect(getByTestId('comment-row-8')).toBeTruthy());

    const listProps = bottomSheetFlatListProps[bottomSheetFlatListProps.length - 1] as {
      onScrollToIndexFailed: (info: { averageItemLength: number; index: number }) => void;
    };
    jest.useFakeTimers();
    act(() => listProps.onScrollToIndexFailed({ averageItemLength: 80, index: 1 }));
    expect(mockScrollToOffset).toHaveBeenCalledWith({ animated: false, offset: 80 });

    act(() => jest.advanceTimersByTime(150));
    expect(mockScrollToIndex).toHaveBeenCalledWith({ animated: true, index: 1, viewPosition: 0.3 });
    jest.useRealTimers();
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
