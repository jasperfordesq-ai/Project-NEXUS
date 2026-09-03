// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import type { FeedItem as FeedItemType } from '@/lib/api/feed';
import FeedItem from './FeedItem';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  // The card renders a report sheet, and BottomSheet closes itself on screen blur.
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => cb(), [cb]);
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => opts?.defaultValue ? String(opts.defaultValue) : key,
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
}));

// The card now offers mute, which is only shown on someone else's content — so it needs to
// know who is signed in. Mocked rather than wrapped in a provider: these tests render the
// card in isolation on purpose.
jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 999 } }),
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
  // 🔴 Derived from the item, like the real helper. A fixed id here made "your own post"
  // indistinguishable from someone else's, and the mute test failed against working code.
  getFeedAuthor: (item: { user_id?: number; author_name?: string }) => ({
    id: item?.user_id ?? 1,
    name: item?.author_name ?? 'Alice Smith',
    avatar: null,
  }),
  toggleBookmark: jest.fn(),
  toggleLike: jest.fn(),
  toggleReaction: jest.fn(),
  // Real behaviour, not a stub: the card must actually refuse to render a
  // gamification milestone, and a stub returning false would hide a regression.
  isGamificationMilestone: (item: { type?: string }) =>
    item?.type === 'badge_earned' || item?.type === 'level_up',
}));

const mockHide = jest.fn();
const mockNotInterested = jest.fn();
const mockMute = jest.fn();
const mockReport = jest.fn();

jest.mock('@/lib/api/feedModeration', () => ({
  hideFeedItem: (...args: unknown[]) => mockHide(...args),
  markFeedItemNotInterested: (...args: unknown[]) => mockNotInterested(...args),
  muteFeedAuthor: (...args: unknown[]) => mockMute(...args),
  reportFeedItem: (...args: unknown[]) => mockReport(...args),
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
// 🔴 Rendered for real, not stubbed to 'View'. The moderation actions the card offers ARE
// the capability under test — a stub would let the menu be empty and the tests still pass,
// which is exactly how a member ended up with no way to hide or report anything.
// The report sheet is a real BottomSheet, and this file's heroui mock has no BottomSheet of
// its own. Stubbed to render its children when open — the chips and the submit button are the
// card's content, which is what these tests assert.
jest.mock('@/components/ui/BottomSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return function BottomSheet({ visible, children }: { visible: boolean; children: React.ReactNode }) {
    return visible ? <View>{children}</View> : null;
  };
});

jest.mock('@/components/ui/ActionSheet', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return function ActionSheet({
    visible,
    actions,
  }: {
    visible: boolean;
    actions: { label: string; onPress: () => void }[];
  }) {
    if (!visible) return null;
    return (
      <View>
        {actions.map((action) => (
          <Text key={action.label} onPress={action.onPress}>
            {action.label}
          </Text>
        ))}
      </View>
    );
  };
});
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

  /**
   * 🔴 A member's bug report, 2026-08-24, with a screenshot of her own post open in the app:
   *
   *   "It won't let me read more"   — the post's own page clipped the body to four lines and
   *                                   the only control was a "Read more" that goes to the
   *                                   page she was already on, so it was disabled and grey.
   *   "Writing also garbled"        — the post is stored as HTML (written on the website) and
   *                                   the app rendered the markup literally, starting
   *                                   `<p class="mb-1 leading-relaxed …"><span>So I had…`.
   *
   * Both halves are pinned here. The server half — the detail endpoint returning a
   * 500-character preview — is pinned in tests/Laravel/Feature/Feed/.
   */
  function postAs(overrides: Record<string, unknown>) {
    return {
      id: 210,
      type: 'post',
      title: null,
      content: 'A post.',
      image_url: null,
      user_id: 1,
      author_name: 'Alan',
      author_avatar: null,
      is_liked: false,
      likes_count: 0,
      comments_count: 0,
      created_at: '2026-07-13T09:00:00Z',
      location: null,
      rating: null,
      start_date: null,
      job_type: null,
      commitment: null,
      submission_deadline: null,
      receiver: null,
      ...overrides,
    } as unknown as FeedItemType;
  }

  const REPORTED_POST =
    '<p class="mb-1 leading-relaxed text-[var(--text-primary)]"><span>So I had meeting booked in this '
    + 'morning for 10am to chat with a Time Bank member about what they need.</span></p>';

  it('shows a post written on the website as words, not as markup', () => {
    const { getByText, queryByText } = render(<FeedItem item={postAs({ content: REPORTED_POST })} />);

    expect(
      getByText('So I had meeting booked in this morning for 10am to chat with a Time Bank member about what they need.'),
    ).toBeTruthy();
    expect(queryByText(/<p class=/)).toBeNull();
    expect(queryByText(/<span>/)).toBeNull();
  });

  it('shows the whole post on the post\'s own page, with no dead Read more', () => {
    const long = `${'This is the body of a long post. '.repeat(20)}`;
    const { queryByText, getByText } = render(
      <FeedItem item={postAs({ content: long, content_truncated: false })} disableDetailNavigation />,
    );

    // 🔴 The load-bearing assertion: no line clamp on the detail view. `numberOfLines`
    // undefined means the reader gets all of it.
    expect(getByText(long.trim()).props.numberOfLines).toBeUndefined();
    // And the control that led nowhere is gone rather than merely disabled.
    expect(queryByText('readMore')).toBeNull();
  });

  it('still offers Read more in the feed, where it has somewhere to go', () => {
    const long = `${'This is the body of a long post. '.repeat(20)}`;
    const { getByText } = render(<FeedItem item={postAs({ content: long, content_truncated: true })} />);

    // The translation stub in this file returns the key, so this asserts the control is
    // rendered — the wording itself is covered by the locale content tests.
    expect(getByText('readMore')).toBeTruthy();
    expect(getByText(long.trim()).props.numberOfLines).toBe(4);
  });

  /**
   * 🔴 The stray "..." sitting on a line of its own under a card — photographed by the owner
   * on 2026-08-28 and, reasonably, taken for more left-over markup. It is not.
   *
   * The card clips to four lines. A blank line between two paragraphs spends one of them on
   * nothing, and React Native then draws its own "there is more" ellipsis onto that empty
   * line. So the reader sees three lines of post, a gap, and three dots — which looks exactly
   * like a fragment the server failed to clean up.
   *
   * The preview closes the gaps so its four lines carry words. The detail view keeps them,
   * because there is no line budget there and they are what makes a long post readable.
   */
  const TWO_PARAGRAPHS =
    '<p>First paragraph, long enough to wrap across more than one line on a phone.</p>'
    + '<p>Second paragraph, which the reader should reach before the card runs out of lines.</p>';

  it('does not spend a preview line on the gap between paragraphs', () => {
    const { getByText } = render(
      <FeedItem item={postAs({ content: TWO_PARAGRAPHS, content_truncated: true })} />,
    );

    const shown = getByText(/First paragraph/).props.children as string;

    // A blank line is what the ellipsis was landing on.
    expect(shown).not.toMatch(/\n\s*\n/);
    // The words that gap was displacing are now inside the four-line budget.
    expect(shown).toContain('Second paragraph');
  });

  it("keeps the paragraph breaks on the post's own page", () => {
    const { getByText } = render(
      <FeedItem item={postAs({ content: TWO_PARAGRAPHS })} disableDetailNavigation />,
    );

    const shown = getByText(/First paragraph/).props.children as string;

    expect(shown).toContain('\n\n');
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

describe('gamification milestone cards are not rendered at all', () => {
  /*
   * Removed on the owner's instruction (2026-08-27). A `badge_earned` /
   * `level_up` item used to render a full-width celebratory panel — a large
   * circular icon and a bold headline — inside an otherwise normal card, and on
   * a gamification-heavy feed that was most of the screen.
   *
   * The API no longer serves them and `extractFeedPage` filters them out, so
   * this pins the last line of defence: a phone can hold a cached page for days,
   * and handed a milestone directly the card must render NOTHING — not a
   * smaller card, not an empty shell.
   *
   * The two describes below (no react control, no detail link) are now
   * trivially satisfied by this. They are kept deliberately: if milestone cards
   * are ever brought back, those two guarantees must come back with them.
   */
  it.each(['level_up', 'badge_earned'] as const)('renders nothing for a %s item', (type) => {
    const item = {
      id: 674,
      type,
      title: type === 'level_up' ? 'Level 3' : 'Gift Giver',
      content: 'Reached Level 3!',
      user_id: 1,
      author_name: 'E2E UserA',
      is_liked: false,
      likes_count: 0,
      comments_count: 0,
      created_at: '2026-08-12T10:00:00Z',
    } as unknown as FeedItemType;

    const { toJSON } = render(<FeedItem item={item} />);

    expect(toJSON()).toBeNull();
  });

  it('still renders a real post', () => {
    // The other direction: a guard that removed every card would be a far worse
    // bug than the clutter it was meant to fix.
    const item = {
      id: 675,
      type: 'post',
      title: null,
      content: 'A real post from a real member',
      user_id: 1,
      author_name: 'E2E UserA',
      is_liked: false,
      likes_count: 0,
      comments_count: 0,
      created_at: '2026-08-12T10:00:00Z',
    } as unknown as FeedItemType;

    const { toJSON } = render(<FeedItem item={item} />);

    expect(toJSON()).not.toBeNull();
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

  /**
   * 🔴 A member could not hide, mute or report anything from the phone.
   *
   * The card's "…" menu offered Share, Save and View post — nothing about the content
   * itself — while the website has had hide, not-interested and mute since the V2 feed was
   * built and the server's report endpoint alerts the moderators. Found by opening the menu
   * on a device on 2026-08-22. This is a safeguarding capability, so it is tested by what
   * the member can reach, not by whether the functions exist.
   */
  describe('content moderation from the card', () => {
    beforeEach(() => {
      mockHide.mockReset().mockResolvedValue({ data: { hidden: true } });
      mockNotInterested.mockReset().mockResolvedValue({ data: {} });
      mockMute.mockReset().mockResolvedValue({ data: {} });
      mockReport.mockReset().mockResolvedValue({ data: { reported: true } });
    });

    const basePost = {
      id: 181,
      type: 'post',
      title: null,
      content: 'A post from another member.',
      image_url: null,
      user_id: 1,
      author_name: 'Alice Smith',
      author_avatar: null,
      is_liked: false,
      likes_count: 0,
      comments_count: 0,
      created_at: '2026-08-22T09:00:00Z',
      location: null,
      rating: null,
      start_date: null,
      job_type: null,
      commitment: null,
      submission_deadline: null,
      receiver: null,
    } as unknown as FeedItemType;

    function openMenu(item: FeedItemType = basePost) {
      const view = render(<FeedItem item={item} />);
      fireEvent.press(view.getByLabelText('moreOptions'));
      return view;
    }

    it('offers not interested, hide, mute and report', () => {
      const { getByText } = openMenu();

      expect(getByText('notInterested')).toBeTruthy();
      expect(getByText('hidePost')).toBeTruthy();
      expect(getByText('muteAuthor')).toBeTruthy();
      expect(getByText('reportPost')).toBeTruthy();
    });

    it('hides the card as soon as the server accepts a hide', async () => {
      const { getByText, queryByText } = openMenu();

      fireEvent.press(getByText('hidePost'));

      await waitFor(() => expect(mockHide).toHaveBeenCalledWith(181, 'post'));
      // 🔴 The feed is not re-fetched for one action, so without the local dismissal the post
      // stays exactly where it was and "Hide this" reads as a dead control.
      await waitFor(() => expect(queryByText(String(basePost.content))).toBeNull());
    });

    it('goes back instead of emptying the page when hiding from the detail screen', async () => {
      const { router } = require('expo-router');
      const view = render(<FeedItem item={basePost} disableDetailNavigation />);
      fireEvent.press(view.getByLabelText('moreOptions'));

      fireEvent.press(view.getByText('hidePost'));

      // 🔴 On the detail screen the card IS the page: dismissing it in place leaves a header
      // over an empty screen, which is what a member saw on 2026-08-22.
      await waitFor(() => expect(router.back).toHaveBeenCalled());
    });

    it('does not offer to mute your own post', () => {
      const own = { ...basePost, user_id: 999 };
      const { queryByText } = openMenu(own);

      expect(queryByText('muteAuthor')).toBeNull();
    });

    it('sends a report with the chosen reason', async () => {
      const { getByText } = openMenu();

      fireEvent.press(getByText('reportPost'));
      fireEvent.press(getByText('reportReason.spam'));
      // Pressed by its label: this file's heroui mock does not forward testID, and a test
      // that reaches for one it cannot see fails against working code.
      fireEvent.press(getByText('reportSend'));

      await waitFor(() =>
        expect(mockReport).toHaveBeenCalledWith(181, 'spam', 'post'),
      );
    });
  });
});

/**
 * 🔴 Owner's report, 2026-09-03: "the YouTube video won't play in the native
 * Android app", while the same post played perfectly on the website.
 *
 * The card rendered `image_url` — which for a YouTube link IS the video's own
 * thumbnail — inside a plain View with NO press handler, and ignored
 * `content_type` entirely. So it looked exactly like a player and tapping it
 * did nothing at all. The web build embeds an iframe; this app ships no
 * WebView, so the fix hands the URL to the OS instead.
 *
 * Note this was never YouTube-specific: no link preview of any kind was
 * tappable, so every shared article was a dead end too.
 */
describe('feed link previews', () => {
  const YOUTUBE_URL = 'https://www.youtube.com/watch?v=k0Flh6cuuWs';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function itemWithPreview(overrides: Record<string, unknown> = {}) {
    return {
      id: 163,
      type: 'post',
      title: null,
      content: 'Worth a watch.',
      image_url: null,
      user_id: 1,
      author_name: 'Alan',
      author_avatar: null,
      is_liked: false,
      likes_count: 0,
      comments_count: 0,
      created_at: '2026-07-04T13:03:34Z',
      link_previews: [{
        url: YOUTUBE_URL,
        title: 'Timebanking in the UK',
        description: 'A TEDx talk',
        image_url: 'https://img.youtube.com/vi/k0Flh6cuuWs/hqdefault.jpg',
        site_name: 'YouTube',
        domain: 'youtube.com',
        content_type: 'video',
        ...overrides,
      }],
    } as unknown as FeedItemType;
  }

  it('opens a video link preview outside the app when it is tapped', () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

    const { getByTestId } = render(<FeedItem item={itemWithPreview()} />);
    fireEvent.press(getByTestId('feed-link-preview'));

    expect(openURL).toHaveBeenCalledWith(YOUTUBE_URL);
  });

  it('opens an ordinary article preview too — none of them were tappable', () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

    const { getByTestId } = render(
      <FeedItem item={itemWithPreview({ url: 'https://example.com/news', content_type: 'website' })} />,
    );
    fireEvent.press(getByTestId('feed-link-preview'));

    expect(openURL).toHaveBeenCalledWith('https://example.com/news');
  });

  it('says a video plays outside the app, so a thumbnail is not mistaken for a player', () => {
    const { getByText } = render(<FeedItem item={itemWithPreview()} />);
    expect(getByText('link_preview.opens_externally')).toBeTruthy();
  });

  it('does not claim an article plays outside the app', () => {
    const { queryByText } = render(
      <FeedItem item={itemWithPreview({ content_type: 'website' })} />,
    );
    expect(queryByText('link_preview.opens_externally')).toBeNull();
  });

  /**
   * `url` is member-supplied content echoed back by the API, and
   * Linking.openURL hands any scheme to whatever app claims it.
   */
  it('refuses to hand a non-http url to the operating system', () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);

    const { getByTestId } = render(
      <FeedItem item={itemWithPreview({ url: 'javascript:alert(1)' })} />,
    );
    fireEvent.press(getByTestId('feed-link-preview'));

    expect(openURL).not.toHaveBeenCalled();
  });
});
