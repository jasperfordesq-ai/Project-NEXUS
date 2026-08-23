// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, Animated } from 'react-native';
import { Ionicons } from '@/components/ui/Icon';
import { Chip } from 'heroui-native';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';

import { voteFeedPoll, type PollData } from '@/lib/api/feed';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import NativePressable from '@/components/ui/NativePressable';

interface PollCardProps {
  pollData: PollData;
  itemId: number;
  onVoted?: (updated: PollData) => void;
  /**
   * A feed card already prints the poll's question as its own title, so the card asks for
   * it to be left out here. Without this the question appeared twice, one line under
   * itself (seen on a device, 2026-08-22).
   */
  showQuestion?: boolean;
}

export default function PollCard({ pollData, itemId, onVoted, showQuestion = true }: PollCardProps) {
  const { t } = useTranslation('home');
  const primary = usePrimaryColor();
  const theme = useTheme();

  const safePollData = pollData && pollData.options ? pollData : null;
  const [poll, setPoll] = useState<PollData | null>(safePollData);
  const [isVoting, setIsVoting] = useState(false);

  // Keep local poll in sync if parent updates pollData prop
  useEffect(() => {
    if (pollData && pollData.options) {
      setPoll(pollData);
    }
  }, [pollData]);

  const selectedOptionId = poll?.user_vote_option_id ?? null;
  const hasVoted = selectedOptionId !== null;

  /**
   * 🔴 The server WITHHOLDS the tallies from anyone but the poll's creator while the poll
   * is still open, so nobody's vote is swayed by the running result. `FeedService` sends
   * `total_votes: null` and every option's `vote_count`/`percentage` as `null`.
   *
   * Measured on a device on 2026-08-22 with a second account: this card did not handle
   * that at all. The chip rendered the label with no number in it — just "votes" — and
   * after voting it drew percentage bars from `null`, so the member saw a result that was
   * not a result. `null + 1` is `1` in JavaScript, which is why the optimistic total also
   * looked plausible instead of failing loudly.
   *
   * The website has always handled it (`react-frontend/src/components/feed/FeedCard.tsx`):
   * "Vote to see results" while you can still vote, "Results revealed when poll closes"
   * once you have. The same two lines are used here, from the same wording.
   */
  const resultsWithheld = poll ? poll.results_visible === false || poll.total_votes == null : false;
  const showResults = !resultsWithheld && (hasVoted || (poll ? !poll.is_active : false));
  // Participation volume is public even when the split is not, so show the count whenever
  // the server actually sent one.
  const knownTotal = poll && poll.total_votes != null ? poll.total_votes : null;

  const handleVote = useCallback(async (optionId: number) => {
    if (!poll || isVoting || hasVoted || !poll.is_active) return;

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsVoting(true);

    // Optimistic update. With the tallies withheld there is no number to add to, so the
    // counts are left exactly as the server sent them (null) and only the member's own
    // choice is recorded — never `null + 1`, which would invent a total of 1.
    const previousPoll = poll;
    const previousTotal = poll.total_votes;
    const newTotalVotes = previousTotal == null ? null : previousTotal + 1;
    const optimisticOptions = poll.options.map((opt) => {
      if (newTotalVotes == null || opt.vote_count == null) return opt;
      const newCount = opt.id === optionId ? opt.vote_count + 1 : opt.vote_count;
      return {
        ...opt,
        vote_count: newCount,
        percentage: newTotalVotes > 0 ? Math.round((newCount / newTotalVotes) * 100) : 0,
      };
    });
    const optimisticPoll: PollData = {
      ...poll,
      options: optimisticOptions,
      total_votes: newTotalVotes,
      user_vote_option_id: optionId,
    };
    setPoll(optimisticPoll);

    try {
      const result = await voteFeedPoll(itemId, optionId);
      setPoll(result.data);
      onVoted?.(result.data);
    } catch {
      // Revert on error
      setPoll(previousPoll);
    } finally {
      setIsVoting(false);
    }
  }, [isVoting, hasVoted, poll, itemId, onVoted]);

  if (!poll || !poll.options?.length) return null;

  return (
    <View className="gap-3">
      {showQuestion ? (
        <Text className="text-base font-semibold leading-6 text-foreground" numberOfLines={3}>{poll.question}</Text>
      ) : null}

      {poll.options.map((option) => (
        <PollOptionRow
          key={option.id}
          option={option}
          showResults={showResults}
          isUserVote={selectedOptionId === option.id}
          primary={primary}
          theme={theme}
          onPress={() => handleVote(option.id)}
          disabled={isVoting || hasVoted || !poll.is_active}
        />
      ))}

      <View className="mt-0.5 flex-row flex-wrap items-center gap-2">
        {resultsWithheld ? (
          <>
            {knownTotal != null && (
              <Chip size="sm" variant="soft">
                <Ionicons name="bar-chart-outline" size={12} color={theme.textSecondary} />
                <Chip.Label>{t('poll.totalVotes', { count: knownTotal })}</Chip.Label>
              </Chip>
            )}
            <Chip size="sm" variant="soft">
              <Ionicons name="eye-off-outline" size={12} color={theme.textSecondary} />
              <Chip.Label>
                {hasVoted ? t('poll.resultsHiddenUntilClose') : t('poll.voteToSeeResults')}
              </Chip.Label>
            </Chip>
          </>
        ) : (
          <Chip size="sm" variant="soft">
            <Ionicons name="bar-chart-outline" size={12} color={theme.textSecondary} />
            <Chip.Label>{t('poll.totalVotes', { count: poll.total_votes ?? 0 })}</Chip.Label>
          </Chip>
        )}
        {hasVoted && (
          <Chip size="sm" variant="secondary" color="accent">
            <Ionicons name="checkmark-circle" size={14} color={primary} />
            <Chip.Label>{t('poll.voted')}</Chip.Label>
          </Chip>
        )}
        {!poll.is_active && (
          <Chip size="sm" variant="soft">
            <Ionicons name="lock-closed-outline" size={12} color={theme.textSecondary} />
            <Chip.Label>{t('poll.closed')}</Chip.Label>
          </Chip>
        )}
      </View>
    </View>
  );
}

interface PollOptionRowProps {
  option: { id: number; text: string; vote_count: number | null; percentage: number | null };
  showResults: boolean;
  isUserVote: boolean;
  primary: string;
  theme: {
    surface: string;
    border: string;
    borderSubtle: string;
    text: string;
    textSecondary: string;
    onPrimary: string;
  };
  onPress: () => void;
  disabled: boolean;
}

function PollOptionRow({ option, showResults, isUserVote, primary, theme, onPress, disabled }: PollOptionRowProps) {
  const fillAnim = useRef(new Animated.Value(0)).current;
  // Withheld tallies arrive as null; animating to null leaves the bar in an undefined
  // state, so treat it as an empty bar.
  const percentage = option.percentage ?? 0;

  useEffect(() => {
    if (showResults) {
      Animated.timing(fillAnim, {
        toValue: percentage,
        duration: 500,
        useNativeDriver: false,
      }).start();
    } else {
      fillAnim.setValue(0);
    }
  }, [showResults, percentage, fillAnim]);

  const fillWidth = fillAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  if (showResults) {
    const resultBorderColor = isUserVote ? withAlpha(primary, 0.65) : theme.border;
    const resultFillColor = isUserVote ? withAlpha(primary, 0.18) : withAlpha(theme.textSecondary, 0.12);

    return (
      <View
        className="min-h-[56px] justify-center overflow-hidden rounded-panel-inner"
        style={{
          borderWidth: 1,
          borderColor: resultBorderColor,
          backgroundColor: withAlpha(theme.surface, 0.82),
        }}
      >
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: fillWidth,
            backgroundColor: resultFillColor,
            borderRadius: 11,
          }}
        />
        <View className="flex-row items-center justify-between gap-3 px-3 py-3.5">
          <View className="min-w-0 flex-1 flex-row items-center gap-2.5">
            <View
              className="size-7 items-center justify-center rounded-full"
              style={{
                backgroundColor: isUserVote ? withAlpha(primary, 0.16) : withAlpha(theme.textSecondary, 0.08),
                borderWidth: 1,
                borderColor: isUserVote ? withAlpha(primary, 0.45) : theme.borderSubtle,
              }}
            >
              <Ionicons
                name={isUserVote ? 'checkmark' : 'ellipse-outline'}
                size={14}
                color={isUserVote ? primary : theme.textSecondary}
              />
            </View>
            <Text
              className="min-w-0 flex-1 text-sm leading-5"
              style={{ color: isUserVote ? primary : theme.text, fontWeight: isUserVote ? '700' : '500' }}
              numberOfLines={3}
            >
              {option.text}
            </Text>
          </View>
          <View className="min-w-[48px] rounded-full px-2 py-1" style={{ backgroundColor: isUserVote ? withAlpha(primary, 0.14) : withAlpha(theme.textSecondary, 0.1) }}>
            <Text
              className="text-center text-xs font-bold"
              style={{ color: isUserVote ? primary : theme.textSecondary }}
            >
              {percentage}%
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <NativePressable
      className="min-h-[56px] w-full justify-center rounded-panel-inner border px-3 py-3"
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={option.text}
      style={{
        backgroundColor: withAlpha(primary, 0.07),
        borderColor: withAlpha(primary, 0.28),
        opacity: disabled ? 0.65 : 1,
      }}
    >
      <View className="flex-row items-center gap-3">
        <View
          className="size-8 items-center justify-center rounded-full"
          style={{
            backgroundColor: withAlpha(primary, 0.12),
            borderWidth: 1,
            borderColor: withAlpha(primary, 0.32),
          }}
        >
          <Ionicons name="ellipse-outline" size={16} color={primary} />
        </View>
        <Text className="min-w-0 flex-1 text-sm font-semibold leading-5" style={{ color: theme.text }} numberOfLines={3}>
          {option.text}
        </Text>
      </View>
    </NativePressable>
  );
}
