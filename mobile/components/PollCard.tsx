// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, Animated, useWindowDimensions } from 'react-native';
import { Ionicons } from '@/components/ui/Icon';
import { Chip } from '@/components/ui/StatusChip';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';

import { voteFeedPoll, type PollData } from '@/lib/api/feed';
import { getRankedPollResults, rankPoll, type RankedPollResults } from '@/lib/api/polls';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import NativePressable from '@/components/ui/NativePressable';
import { useAppToast } from '@/components/ui/AppToast';
import { describeApiError } from '@/lib/api/describeApiError';
import { useReducedMotion } from '@/lib/hooks/useReducedMotion';

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
  const { show: showToast } = useAppToast();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const isLargeText = width < 320 || fontScale > 1.3;
  const scaleKey = isLargeText ? 'large' : 'compact';

  const safePollData = pollData && pollData.options ? pollData : null;
  const [poll, setPoll] = useState<PollData | null>(safePollData);
  const [isVoting, setIsVoting] = useState(false);
  const [rankedResults, setRankedResults] = useState<RankedPollResults | null>(null);
  const [rankedResultsLoading, setRankedResultsLoading] = useState(false);
  const [rankedResultsError, setRankedResultsError] = useState(false);
  const [rankedResultsAttempt, setRankedResultsAttempt] = useState(0);
  const votingRef = useRef(false);
  const [rankOrder, setRankOrder] = useState<number[]>(() => {
    const saved = [...(safePollData?.user_rankings ?? [])].sort((a, b) => a.rank - b.rank).map((ranking) => ranking.option_id);
    return saved.length ? saved : (safePollData?.options ?? []).map((option) => option.id);
  });

  // Keep local poll in sync if parent updates pollData prop
  useEffect(() => {
    if (pollData && pollData.options) {
      setPoll(pollData);
      const saved = [...(pollData.user_rankings ?? [])].sort((a, b) => a.rank - b.rank).map((ranking) => ranking.option_id);
      setRankOrder(saved.length ? saved : pollData.options.map((option) => option.id));
    }
  }, [pollData]);

  const selectedOptionId = poll?.user_vote_option_id ?? null;
  const isRanked = poll?.poll_type === 'ranked';
  const hasVoted = isRanked ? Boolean(poll?.user_rankings?.length) : selectedOptionId !== null;
  const pollId = poll?.id;
  const pollIsActive = poll?.is_active;

  useEffect(() => {
    if (pollId == null || !isRanked || pollIsActive) {
      setRankedResults(null);
      setRankedResultsLoading(false);
      setRankedResultsError(false);
      return undefined;
    }

    let active = true;
    setRankedResultsLoading(true);
    setRankedResultsError(false);
    void getRankedPollResults(pollId)
      .then((response) => {
        if (!active) return;
        if (response.data.results_visible && response.data.ranked_results) {
          setRankedResults(response.data.ranked_results);
          return;
        }
        setRankedResultsError(true);
      })
      .catch(() => {
        if (active) setRankedResultsError(true);
      })
      .finally(() => {
        if (active) setRankedResultsLoading(false);
      });
    return () => { active = false; };
  }, [isRanked, pollId, pollIsActive, rankedResultsAttempt]);

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
    if (!poll || isRanked || votingRef.current || hasVoted || !poll.is_active) return;

    votingRef.current = true;
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
    } catch (err) {
      // Revert, and SAY so. A silent rollback reads as the app ignoring the tap, and it
      // threw away the server's reason (poll closed, already voted).
      setPoll(previousPoll);
      showToast({
        title: t('poll.voteFailedTitle'),
        description: describeApiError(err, t('poll.voteFailed')),
        variant: 'danger',
      });
    } finally {
      votingRef.current = false;
      setIsVoting(false);
    }
  }, [hasVoted, poll, isRanked, itemId, onVoted, showToast, t]);

  const moveRank = useCallback((index: number, direction: -1 | 1) => {
    if (votingRef.current || hasVoted) return;
    setRankOrder((current) => {
      const destination = index + direction;
      if (destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  }, [hasVoted]);

  const handleRankedVote = useCallback(async () => {
    if (!poll || !isRanked || votingRef.current || hasVoted || !poll.is_active || rankOrder.length < 2) return;
    votingRef.current = true;
    setIsVoting(true);
    try {
      const result = await rankPoll(itemId, rankOrder);
      const updated = result.data.poll;
      setPoll(updated);
      onVoted?.(updated);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      showToast({
        title: t('poll.voteFailedTitle'),
        description: describeApiError(err, t('poll.rankFailed')),
        variant: 'danger',
      });
    } finally {
      votingRef.current = false;
      setIsVoting(false);
    }
  }, [hasVoted, isRanked, itemId, onVoted, poll, rankOrder, showToast, t]);

  if (!poll || !poll.options?.length) return null;

  return (
    <View key={`poll-${itemId}-${scaleKey}`} className="gap-3" testID="poll-card-layout">
      {showQuestion ? (
        <Text className="text-base font-semibold leading-6 text-foreground" numberOfLines={isLargeText ? 0 : 3}>{poll.question}</Text>
      ) : null}

      {isRanked ? (
        <View className="gap-2">
          <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
            {!poll.is_active ? t('poll.rankingClosed') : hasVoted ? t('poll.rankSubmitted') : t('poll.rankInstructions')}
          </Text>
          {!poll.is_active ? (
            <View className="gap-2" testID="ranked-poll-results">
              <Text className="text-sm font-semibold" style={{ color: theme.text }}>{t('poll.resultsHeading')}</Text>
              {rankedResultsLoading ? (
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('poll.resultsLoading')}</Text>
              ) : rankedResultsError || !rankedResults ? (
                <View className="gap-2">
                  <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('poll.resultsLoadFailed')}</Text>
                  <NativePressable
                    className="min-h-[48px] items-center justify-center rounded-panel-inner border px-4 py-3"
                    style={{ borderColor: theme.border }}
                    onPress={() => setRankedResultsAttempt((attempt) => attempt + 1)}
                    accessibilityLabel={t('poll.retryResults')}
                  >
                    <Text className="font-semibold" style={{ color: primary }}>{t('poll.retryResults')}</Text>
                  </NativePressable>
                </View>
              ) : (
                <>
                  <Text className="text-xs" style={{ color: theme.textSecondary }}>
                    {t('poll.totalVoters', { count: rankedResults.total_voters })}
                  </Text>
                  {rankedResults.results.map((result) => (
                    <View
                      key={result.option_id}
                      testID={`ranked-result-${result.option_id}`}
                      className={`min-h-[56px] gap-3 rounded-panel-inner border px-3 py-2 ${isLargeText ? 'items-start' : 'flex-row items-center'}`}
                      style={{ borderColor: theme.border }}
                    >
                      <View className="size-8 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                        <Ionicons name="bar-chart-outline" size={16} color={primary} />
                      </View>
                      <Text
                        testID={`ranked-result-label-${result.option_id}`}
                        className={`${isLargeText ? 'w-full' : 'min-w-0 flex-1'} text-sm font-semibold leading-5`}
                        style={{ color: theme.text }}
                        numberOfLines={isLargeText ? 0 : 3}
                      >{result.text}</Text>
                      <Text className={`${isLargeText ? 'w-full' : ''} text-xs font-semibold`} style={{ color: theme.textSecondary }}>
                        {t('poll.firstChoiceVotes', { count: result.votes })}
                      </Text>
                    </View>
                  ))}
                </>
              )}
            </View>
          ) : rankOrder.map((optionId, index) => {
            const option = poll.options.find((candidate) => candidate.id === optionId);
            if (!option) return null;
            return (
              <View key={optionId} className="min-h-[56px] gap-2 rounded-panel-inner border px-3 py-2" style={{ borderColor: theme.border }}>
                <View className="flex-row items-start gap-2">
                  <View className="size-8 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                    <Text className="text-sm font-bold" style={{ color: primary }}>{index + 1}</Text>
                  </View>
                  <Text className={`min-w-0 flex-1 text-sm font-semibold leading-5 ${!isLargeText && !hasVoted && poll.is_active ? 'pr-24' : ''}`} style={{ color: theme.text }} numberOfLines={isLargeText ? 0 : 3}>{option.text}</Text>
                </View>
                {!hasVoted && poll.is_active ? <View className={`flex-row gap-2 ${isLargeText ? 'self-stretch justify-end' : 'absolute right-2 top-1'}`}>
                  <NativePressable
                    className="size-11 items-center justify-center rounded-full"
                    disabled={index === 0 || isVoting}
                    onPress={() => moveRank(index, -1)}
                    accessibilityLabel={t('poll.moveUp', { option: option.text })}
                    style={{ opacity: index === 0 ? 0.35 : 1 }}
                  >
                    <Ionicons name="chevron-up" size={20} color={theme.textSecondary} />
                  </NativePressable>
                  <NativePressable
                    className="size-11 items-center justify-center rounded-full"
                    disabled={index === rankOrder.length - 1 || isVoting}
                    onPress={() => moveRank(index, 1)}
                    accessibilityLabel={t('poll.moveDown', { option: option.text })}
                    style={{ opacity: index === rankOrder.length - 1 ? 0.35 : 1 }}
                  >
                    <Ionicons name="chevron-down" size={20} color={theme.textSecondary} />
                  </NativePressable>
                </View> : null}
              </View>
            );
          })}
          {!hasVoted && poll.is_active ? <NativePressable
            className="min-h-[48px] items-center justify-center rounded-panel-inner px-4 py-3"
            disabled={isVoting}
            onPress={() => void handleRankedVote()}
            accessibilityLabel={t('poll.submitRankings')}
            style={{ backgroundColor: primary, opacity: isVoting ? 0.65 : 1 }}
          >
            <Text className="font-semibold" style={{ color: theme.onPrimary }}>{isVoting ? t('poll.submittingRankings') : t('poll.submitRankings')}</Text>
          </NativePressable> : null}
        </View>
      ) : poll.options.map((option) => (
        <PollOptionRow
          key={option.id}
          option={option}
          showResults={showResults}
          isUserVote={selectedOptionId === option.id}
          primary={primary}
          theme={theme}
          isLargeText={isLargeText}
          onPress={() => handleVote(option.id)}
          disabled={isVoting || hasVoted || !poll.is_active}
        />
      ))}

      <View className="mt-0.5 flex-row flex-wrap items-center gap-2">
        {isRanked ? (
          poll.is_active ? (
            <Chip size="sm" variant="soft">
              <Ionicons name="eye-off-outline" size={12} color={theme.textSecondary} />
              <Chip.Label>{t('poll.resultsHiddenUntilClose')}</Chip.Label>
            </Chip>
          ) : null
        ) : resultsWithheld ? (
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
        {isRanked && (
          <Chip size="sm" variant="soft">
            <Ionicons name="list-outline" size={12} color={theme.textSecondary} />
            <Chip.Label>{t('poll.ranked')}</Chip.Label>
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
  isLargeText: boolean;
}

function PollOptionRow({ option, showResults, isUserVote, primary, theme, onPress, disabled, isLargeText }: PollOptionRowProps) {
  const fillAnim = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();
  // Withheld tallies arrive as null; animating to null leaves the bar in an undefined
  // state, so treat it as an empty bar.
  const percentage = option.percentage ?? 0;

  useEffect(() => {
    if (!showResults) {
      fillAnim.setValue(0);
      return;
    }
    if (reduceMotion) {
      fillAnim.setValue(percentage);
      return;
    }
    Animated.timing(fillAnim, {
      toValue: percentage,
      duration: 500,
      useNativeDriver: false,
    }).start();
  }, [showResults, percentage, fillAnim, reduceMotion]);

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
        <View className={`gap-3 px-3 py-3.5 ${isLargeText ? 'items-start' : 'flex-row items-center justify-between'}`}>
          <View className={`${isLargeText ? 'w-full' : 'min-w-0 flex-1'} flex-row items-start gap-2.5`}>
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
              numberOfLines={isLargeText ? 0 : 3}
            >
              {option.text}
            </Text>
          </View>
          <View className={`${isLargeText ? 'self-start' : 'min-w-[48px]'} rounded-full px-2 py-1`} style={{ backgroundColor: isUserVote ? withAlpha(primary, 0.14) : withAlpha(theme.textSecondary, 0.1) }}>
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
        <Text className="min-w-0 flex-1 text-sm font-semibold leading-5" style={{ color: theme.text }} numberOfLines={isLargeText ? 0 : 3}>
          {option.text}
        </Text>
      </View>
    </NativePressable>
  );
}
