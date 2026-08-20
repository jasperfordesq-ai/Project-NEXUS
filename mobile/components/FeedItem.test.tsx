// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import type { FeedItem as FeedItemType } from '@/lib/api/feed';
import FeedItem from './FeedItem';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => opts?.defaultValue ? String(opts.defaultValue) : key,
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    surface: '#FFFFFF',
    border: '#E4E4E7',
    borderSubtle: '#F0F0F0',
    text: '#11181C',
    textSecondary: '#687076',
    textMuted: '#9BA1A6',
    onPrimary: '#FFFFFF',
  }),
}));

jest.mock('@/lib/api/feed', () => ({
  getFeedAuthor: () => ({ id: 1, name: 'Alice Smith', avatar: null }),
  toggleBookmark: jest.fn(),
  toggleLike: jest.fn(),
  toggleReaction: jest.fn(),
}));

jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  return { useAppToast: () => ({ show }) };
});

jest.mock('@/lib/haptics', () => ({
  ImpactFeedbackStyle: { Light: 'Light', Medium: 'Medium' },
  NotificationFeedbackType: { Success: 'Success' },
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('expo-image', () => ({
  Image: 'View',
}));

jest.mock('heroui-native', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');

  const Button = ({ children, onPress, onPressIn, onPressOut, accessibilityLabel }: { children?: React.ReactNode; onPress?: () => void; onPressIn?: () => void; onPressOut?: () => void; accessibilityLabel?: string }) => (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut}>
      {children}
    </Pressable>
  );
  Button.Label = ({ children }: { children?: React.ReactNode }) => <Text>{children}</Text>;

  const Card = ({ children }: { children?: React.ReactNode }) => <View>{children}</View>;
  Card.Header = ({ children }: { children?: React.ReactNode }) => <View>{children}</View>;
  Card.Body = ({ children }: { children?: React.ReactNode }) => <View>{children}</View>;
  Card.Footer = ({ children }: { children?: React.ReactNode }) => <View>{children}</View>;

  const Chip = ({ children }: { children?: React.ReactNode }) => <View>{children}</View>;
  Chip.Label = ({ children }: { children?: React.ReactNode }) => <Text>{children}</Text>;

  return {
    Button,
    Card,
    Chip,
    Separator: () => <View />,
    Surface: ({ children }: { children?: React.ReactNode }) => <View>{children}</View>,
  };
});

jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/ImageCarousel', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');

  return function MockImageCarousel({ onImagePress }: { onImagePress?: (index: number) => void }) {
    return (
      <Pressable accessibilityRole="imagebutton" accessibilityLabel="carousel image" onPress={() => onImagePress?.(0)}>
        <Text>carousel image</Text>
      </Pressable>
    );
  };
});
jest.mock('@/components/ui/ActionSheet', () => 'View');
jest.mock('@/components/reactions/ReactorsSheet', () => 'View');
jest.mock('@/components/PollCard', () => 'View');
jest.mock('@/components/comments/CommentSheet', () => {
  const React = require('react');
  const { Text } = require('react-native');

  return function MockCommentSheet({
    visible,
    targetType,
    targetId,
  }: {
    visible: boolean;
    targetType: string;
    targetId: number;
  }) {
    return visible ? <Text>{`comments-${targetType}-${targetId}`}</Text> : null;
  };
});

describe('FeedItem', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('falls back to the default visual config for feed item types not known by the mobile client', () => {
    const item = {
      id: 501,
      type: 'appreciation',
      title: 'Thanks for the lift',
      content: 'A kind note from the community feed.',
      image_url: null,
      user_id: 1,
      author_name: 'Alice Smith',
      author_avatar: null,
      is_liked: false,
      likes_count: 0,
      comments_count: 0,
      created_at: '2026-05-30T10:00:00Z',
      location: null,
      rating: null,
      start_date: null,
      job_type: null,
      commitment: null,
      submission_deadline: null,
      receiver: null,
    } as unknown as FeedItemType;

    const { getByText } = render(<FeedItem item={item} />);

    expect(getByText('Thanks for the lift')).toBeTruthy();
    expect(getByText('A kind note from the community feed.')).toBeTruthy();
  });

  it('opens the native comments sheet instead of navigating when Comment is pressed', () => {
    const item = {
      id: 501,
      type: 'listing',
      title: 'Help with garden planning',
      content: 'Could use some local advice.',
      image_url: null,
      user_id: 1,
      author_name: 'Alice Smith',
      author_avatar: null,
      is_liked: false,
      likes_count: 0,
      comments_count: 0,
      created_at: '2026-05-30T10:00:00Z',
      location: null,
      rating: null,
      start_date: null,
      job_type: null,
      commitment: null,
      submission_deadline: null,
      receiver: null,
    } as FeedItemType;
    const { router } = require('expo-router');

    const { getByText } = render(<FeedItem item={item} />);
    fireEvent.press(getByText('comment'));

    expect(getByText('comments-listing-501')).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('opens the native comments sheet when the visible comment count is pressed', () => {
    const item = {
      id: 502,
      type: 'listing',
      title: 'Garden help',
      content: 'There are comments on this listing.',
      image_url: null,
      user_id: 1,
      author_name: 'Alice Smith',
      author_avatar: null,
      is_liked: false,
      likes_count: 0,
      comments_count: 4,
      created_at: '2026-05-30T10:00:00Z',
      location: null,
      rating: null,
      start_date: null,
      job_type: null,
      commitment: null,
      submission_deadline: null,
      receiver: null,
    } as FeedItemType;
    const { router } = require('expo-router');

    const { getAllByText, getByText } = render(<FeedItem item={item} />);
    fireEvent.press(getAllByText('stats.comments')[0]);

    expect(getByText('comments-listing-502')).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('opens feed item detail instead of the image viewer when a feed image is pressed', () => {
    const item = {
      id: 503,
      type: 'post',
      title: 'Garden photo',
      content: 'A post with an image.',
      image_url: 'https://example.test/photo.jpg',
      user_id: 1,
      author_name: 'Alice Smith',
      author_avatar: null,
      is_liked: false,
      likes_count: 0,
      comments_count: 0,
      created_at: '2026-05-30T10:00:00Z',
      location: null,
      rating: null,
      start_date: null,
      job_type: null,
      commitment: null,
      submission_deadline: null,
      receiver: null,
    } as FeedItemType;
    const { router } = require('expo-router');

    const { getByLabelText } = render(<FeedItem item={item} />);
    fireEvent.press(getByLabelText('feedTypes.post'));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(modals)/feed-item-detail',
      params: { id: '503', type: 'post' },
    });
  });

  it('opens feed item detail instead of the image viewer when carousel media is pressed', () => {
    const item = {
      id: 504,
      type: 'post',
      title: 'Carousel photo',
      content: 'A post with carousel media.',
      image_url: null,
      media: [{ id: 1, media_type: 'image', file_url: 'https://example.test/photo.jpg', display_order: 0 }],
      user_id: 1,
      author_name: 'Alice Smith',
      author_avatar: null,
      is_liked: false,
      likes_count: 0,
      comments_count: 0,
      created_at: '2026-05-30T10:00:00Z',
      location: null,
      rating: null,
      start_date: null,
      job_type: null,
      commitment: null,
      submission_deadline: null,
      receiver: null,
    } as FeedItemType;
    const { router } = require('expo-router');

    const { getByLabelText } = render(<FeedItem item={item} />);
    fireEvent.press(getByLabelText('carousel image'));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(modals)/feed-item-detail',
      params: { id: '504', type: 'post' },
    });
  });

  it('quick-tapping like on a reactable post toggles the default like reaction and stays highlighted', async () => {
    const { toggleReaction } = require('@/lib/api/feed');
    (toggleReaction as jest.Mock).mockResolvedValue({
      data: {
        action: 'added',
        reaction_type: 'like',
        // Server-authoritative summary — the button must stay highlighted
        // after this resolves (regression: the legacy path read a `liked`
        // field that the API never sent and un-highlighted the button).
        reactions: { counts: { like: 3 }, total: 3, user_reaction: 'like' },
      },
    });

    const item = {
      id: 600,
      type: 'post',
      title: 'Reactable post',
      content: 'React to me.',
      image_url: null,
      user_id: 1,
      author_name: 'Alice Smith',
      author_avatar: null,
      is_liked: false,
      likes_count: 2,
      reactions: { counts: { like: 2 }, total: 2, user_reaction: null },
      comments_count: 0,
      created_at: '2026-05-30T10:00:00Z',
      location: null,
      rating: null,
      start_date: null,
      job_type: null,
      commitment: null,
      submission_deadline: null,
      receiver: null,
    } as unknown as FeedItemType;

    const { getByLabelText, findByLabelText, findByText } = render(<FeedItem item={item} />);

    fireEvent.press(getByLabelText('likePost'));

    expect(toggleReaction).toHaveBeenCalledWith('post', 600, 'like');
    // After the server reconciles, the button reflects the reacted state.
    expect(await findByLabelText('unlikePost')).toBeTruthy();
    expect(await findByText('3')).toBeTruthy();
  });

  it('long-pressing like opens the reaction bar and selecting an emoji sends that reaction', async () => {
    const { toggleReaction } = require('@/lib/api/feed');
    (toggleReaction as jest.Mock).mockResolvedValue({
      data: {
        action: 'added',
        reaction_type: 'celebrate',
        reactions: { counts: { celebrate: 1 }, total: 1, user_reaction: 'celebrate' },
      },
    });

    const item = {
      id: 601,
      type: 'post',
      title: 'Celebrate post',
      content: 'Party time.',
      image_url: null,
      user_id: 1,
      author_name: 'Alice Smith',
      author_avatar: null,
      is_liked: false,
      likes_count: 0,
      reactions: { counts: {}, total: 0, user_reaction: null },
      comments_count: 0,
      created_at: '2026-05-30T10:00:00Z',
      location: null,
      rating: null,
      start_date: null,
      job_type: null,
      commitment: null,
      submission_deadline: null,
      receiver: null,
    } as unknown as FeedItemType;

    const { getByLabelText, queryByLabelText } = render(<FeedItem item={item} />);

    expect(queryByLabelText('reaction.celebrate')).toBeNull();

    // Hold-to-react is timed manually from pressIn (the reanimated pressable's
    // own longPress classification swallowed quick taps on-device).
    jest.useFakeTimers();
    fireEvent(getByLabelText('likePost'), 'pressIn');
    act(() => { jest.advanceTimersByTime(500); });
    jest.useRealTimers();
    fireEvent(getByLabelText('likePost'), 'pressOut');
    fireEvent.press(getByLabelText('reaction.celebrate'));

    expect(toggleReaction).toHaveBeenCalledWith('post', 601, 'celebrate');
  });
});

describe('the heart on cards nothing can be reacted to', () => {
  /**
   * 🔴 The bug this pins, reported from a real phone as "the emojis are shit, there's
   * just a heart, and it fails to save my reactions".
   *
   * The footer heart was rendered for EVERY feed item type. On a milestone card
   * (`level_up`, `badge_earned`) there is no entity to react to, and BOTH endpoints
   * refuse it — measured against the local API on 2026-08-20:
   *
   *   POST /api/v2/reactions  {target_type:"level_up"}     -> 400 Invalid target_type
   *   POST /api/v2/feed/like  {target_type:"badge_earned"} -> 400 Invalid target_type
   *
   * So the tap flipped the icon optimistically, the request failed, the state reverted
   * and a "reaction failed" toast appeared. On a gamification-heavy feed that is most
   * cards — 3 of the first 4 in the local fixture — which reads as "the app cannot save
   * my reactions".
   *
   * The web fixed this by rendering no control at all (Sentry NEXUS-PHP-1Y). Mobile
   * never got the fix. A rendering test cannot catch it by accident, because the button
   * renders perfectly well; only the request it would make is impossible.
   */
  function milestone(type: 'level_up' | 'badge_earned') {
    return {
      id: 674,
      type,
      title: type === 'level_up' ? 'Level 3' : 'Gift Giver',
      content: 'Reached Level 3!',
      image_url: null,
      user_id: 1,
      author_name: 'E2E UserA',
      author_avatar: null,
      is_liked: false,
      likes_count: 0,
      comments_count: 0,
      created_at: '2026-08-12T10:00:00Z',
      location: null,
      rating: null,
      start_date: null,
      job_type: null,
      commitment: null,
      submission_deadline: null,
      receiver: null,
    } as unknown as FeedItemType;
  }

  // 🔴 Queried by accessibilityLabel, not testID. HeroUI's Button does NOT forward
  // `testID` to the rendered node — the same class of dropped-prop trap as it dropping
  // `role`. A testID-based assertion here passed for the milestone cases and failed for
  // the control cases, i.e. it would have "proved" the fix while actually proving that
  // no button exists under any circumstances. `t` is mocked to return the key, so the
  // label is the raw key.
  it.each(['level_up', 'badge_earned'] as const)(
    '🔴 shows no react/like control on a %s card',
    (type) => {
      const { queryByLabelText } = render(<FeedItem item={milestone(type)} />);

      expect(queryByLabelText('likePost')).toBeNull();
      expect(queryByLabelText('unlikePost')).toBeNull();
    }
  );

  it('still shows the control on a card that CAN be reacted to', () => {
    // The other half of the guard: gating too aggressively would remove reactions from
    // real content, which is a worse bug than the one being fixed.
    const item = { ...milestone('level_up'), type: 'post' } as unknown as FeedItemType;

    const { queryByLabelText } = render(<FeedItem item={item} />);

    expect(queryByLabelText('likePost')).not.toBeNull();
  });

  it('keeps the control on a likeable-but-not-reactable type', () => {
    // `resource` is in the server's like list; the point of the two sets is that either
    // one is enough to justify a control.
    const item = { ...milestone('level_up'), type: 'resource' } as unknown as FeedItemType;

    const { queryByLabelText } = render(<FeedItem item={item} />);

    expect(queryByLabelText('likePost')).not.toBeNull();
  });
});

describe('the "View post" link on milestone cards', () => {
  /**
   * 🔴 Found by walking the app on a device, 2026-08-20. Tapping "View post" on a badge
   * card opened a screen reading "Not found. Something went wrong. Please try again." with
   * a Retry button that fails identically for ever.
   *
   * The detail screen calls `getFeedItem(type, id)`, and `POLYMORPHIC_FEED_TYPES` does not
   * include `badge_earned` / `level_up` — so the type silently falls back to `'post'` and
   * it fetches a POST using a gamification event id:
   *
   *   GET /api/v2/feed/posts/674         -> 404 "Post not found"
   *   GET /api/v2/feed/items/listing/515 -> 200 (real content, for contrast)
   *
   * There is no post behind a milestone. Same family as the react/like control being
   * offered on these cards.
   */
  function milestoneCard(type: 'level_up' | 'badge_earned') {
    return {
      id: 674,
      type,
      title: 'Level 3',
      content: 'Reached Level 3!',
      image_url: null,
      user_id: 1,
      author_name: 'E2E UserA',
      author_avatar: null,
      is_liked: false,
      likes_count: 0,
      comments_count: 0,
      created_at: '2026-08-12T10:00:00Z',
      location: null,
      rating: null,
      start_date: null,
      job_type: null,
      commitment: null,
      submission_deadline: null,
      receiver: null,
    } as unknown as FeedItemType;
  }

  // 🔴 Asserted on the VISIBLE TEXT, not accessibilityLabel. That button carries no
  // accessibilityLabel at all, so a queryByLabelText assertion passed for the milestone
  // cases AND failed for the control case — i.e. it "proved" the fix while really proving
  // that no such label exists anywhere. Second time today that a query that matches
  // nothing looked like a passing test. `t` is mocked to return the key.
  it.each(['level_up', 'badge_earned'] as const)(
    '🔴 offers no detail link on a %s card',
    (type) => {
      const { queryByText } = render(<FeedItem item={milestoneCard(type)} />);

      expect(queryByText('detail.post')).toBeNull();
    }
  );

  it('still offers the detail link on a real post', () => {
    // The other direction: removing the link everywhere would be a worse bug.
    const item = { ...milestoneCard('level_up'), type: 'post' } as unknown as FeedItemType;

    const { queryByText } = render(<FeedItem item={item} />);

    expect(queryByText('detail.post')).not.toBeNull();
  });
});
