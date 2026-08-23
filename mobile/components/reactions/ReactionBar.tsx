// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ReactionBar — emoji reaction picker for feed cards (web ReactionPicker parity).
 *
 * Renders a horizontal pill of the 8 platform reaction types. Opened by
 * long-pressing the like button; a quick tap on the like button still
 * toggles the default 'like' reaction without opening the bar.
 *
 * 🔴 The pill WRAPS on narrow phones, and that is load-bearing rather than cosmetic.
 *
 * Eight 44dp targets need 352dp before a single pixel of gap or padding. That fits a
 * 411dp phone — the emulator, and every Pixel — which is exactly why this was never
 * noticed. On a **360dp** phone, an extremely common Android width, the card's inner
 * width is ~336dp and the pill's is ~312dp: `clap` rendered half off the edge and
 * `time_credit` was entirely off-screen. Not merely ugly — unreachable, with nothing on
 * screen to say two reactions existed. Measured 2026-08-20 by holding one build and one
 * card at two densities.
 *
 * Two alternatives were tried and rejected, in this order:
 *
 *  1. **Shrink the targets.** One row of eight cannot fit 312dp above 35dp per target,
 *     which is under the accessible-target floor — and it would shrink them on every
 *     phone to fix some of them.
 *  2. **Scroll the row horizontally.** Reachable, but verified on the device to read as
 *     "there are six reactions": the pill ends in a tidy rounded edge with the seventh
 *     just past the clip, so nothing suggests a swipe. Trading unreachable for
 *     undiscoverable is not a fix, and undiscoverable is precisely the complaint this
 *     component was already in trouble for.
 *
 * Wrapping keeps all eight visible at the full 44dp on any width: one row of eight where
 * there is room, two rows of four where there is not. A wide screen is unchanged.
 */

import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@/components/ui/Icon';
import { useTranslation } from 'react-i18next';

import type { ReactionType } from '@/lib/api/feed';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';

export const REACTION_CONFIGS: { type: ReactionType; emoji: string; labelKey: string }[] = [
  { type: 'like', emoji: '\u{1F44D}', labelKey: 'reaction.like' },
  { type: 'love', emoji: '❤️', labelKey: 'reaction.love' },
  { type: 'laugh', emoji: '\u{1F602}', labelKey: 'reaction.laugh' },
  { type: 'wow', emoji: '\u{1F62E}', labelKey: 'reaction.wow' },
  { type: 'sad', emoji: '\u{1F622}', labelKey: 'reaction.sad' },
  { type: 'celebrate', emoji: '\u{1F389}', labelKey: 'reaction.celebrate' },
  { type: 'clap', emoji: '\u{1F44F}', labelKey: 'reaction.clap' },
  { type: 'time_credit', emoji: '⏰', labelKey: 'reaction.time_credit' },
];

export const REACTION_EMOJI_MAP: Partial<Record<string, string>> = Object.fromEntries(
  REACTION_CONFIGS.map((config) => [config.type, config.emoji]),
);

/**
 * The pill's own geometry, named so the wrap arithmetic below and the guard test in
 * `components/narrowScreenReach.test.ts` cannot drift apart from what is rendered.
 * TARGET_DP is `size-11`, GAP_DP is `gap-0.5`, PILL_PADDING_DP is `px-2` on both sides.
 */
const TARGET_DP = 44;
const GAP_DP = 2;
const PILL_PADDING_DP = 8 * 2;
/** `left-3 right-3` on this component, plus the feed card's own horizontal margin. */
const HORIZONTAL_INSETS_DP = 12 * 2 + 12 * 2;
/** Absorbs layout rounding so a row that should hold N targets is not clipped to N-1. */
const ROW_SLACK_DP = 2;

export default function ReactionBar({
  visible,
  userReaction,
  primary,
  onSelect,
  onDismiss,
}: {
  visible: boolean;
  userReaction: string | null;
  primary: string;
  onSelect: (type: ReactionType) => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation('home');
  const theme = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.8)).current;

  // How many 44dp targets fit one row here, and therefore how the pill is capped. Whole
  // rows only: a row of 5 and a row of 3 reads as a mistake, so the count is halved rather
  // than left ragged when all eight will not fit.
  const { width: screenWidth } = useWindowDimensions();
  const availableDp = screenWidth - HORIZONTAL_INSETS_DP - PILL_PADDING_DP;
  const fitsPerRow = Math.max(1, Math.floor((availableDp + GAP_DP) / (TARGET_DP + GAP_DP)));
  const perRow = fitsPerRow >= REACTION_CONFIGS.length ? REACTION_CONFIGS.length : Math.ceil(REACTION_CONFIGS.length / 2);
  const rowsNeeded = Math.ceil(REACTION_CONFIGS.length / perRow);

  useEffect(() => {
    if (!visible) return;
    opacity.setValue(0);
    scale.setValue(0.8);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 6, tension: 160, useNativeDriver: true }),
    ]).start();
  }, [opacity, scale, visible]);

  if (!visible) return null;

  return (
    <>
      {/* Backdrop that dismisses the bar when tapping anywhere else on the card */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onDismiss}
        accessibilityLabel={t('reaction.dismiss')}
      />
      <Animated.View
        style={{ opacity, transform: [{ scale }] }}
        className="absolute bottom-14 left-3 right-3 z-10"
        accessibilityRole="menu"
      >
        <View
          className={rowsNeeded > 1 ? 'rounded-3xl px-2 py-1.5' : 'rounded-full px-2 py-1.5'}
          style={{
            alignSelf: 'flex-start',
            // 🔴 `+ ROW_SLACK_DP` is not padding-by-feel. Without it the cap is EXACTLY the
            // content width, and on the device that produced rows of 3-3-2 instead of 4-4:
            // sub-pixel rounding in layout made the last target of each row not quite fit.
            // A cap that is exactly right is a cap that is sometimes one pixel wrong.
            maxWidth: perRow * TARGET_DP + (perRow - 1) * GAP_DP + PILL_PADDING_DP + ROW_SLACK_DP,
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.borderSubtle,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.22,
            shadowRadius: 10,
            elevation: 8,
          }}
        >
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: GAP_DP }}>
            {REACTION_CONFIGS.map((config) => {
              const isActive = userReaction === config.type;
              return (
                <Pressable
                  key={config.type}
                  onPress={() => onSelect(config.type)}
                  accessibilityLabel={t(config.labelKey)}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected: isActive }}
                  className="size-11 items-center justify-center rounded-full"
                  style={isActive ? { backgroundColor: withAlpha(primary, 0.18) } : undefined}
                >
                  {config.type === 'time_credit' ? (
                    <Ionicons name="time-outline" size={20} color={primary} />
                  ) : (
                    <Text style={{ fontSize: 20 }}>{config.emoji}</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Animated.View>
    </>
  );
}
