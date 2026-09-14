// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as ReactNative from 'react-native';

import type { PollData } from '@/lib/api/feed';
import PollCard from './PollCard';

const mockVoteFeedPoll = jest.fn();
const mockRankPoll = jest.fn();
const mockGetRankedPollResults = jest.fn();

jest.mock('@/lib/api/feed', () => ({
  voteFeedPoll: (...args: unknown[]) => mockVoteFeedPoll(...args),
}));
jest.mock('@/lib/api/polls', () => ({
  rankPoll: (...args: unknown[]) => mockRankPoll(...args),
  getRankedPollResults: (...args: unknown[]) => mockGetRankedPollResults(...args),
}));

jest.mock('@/lib/haptics', () => ({
  ImpactFeedbackStyle: { Light: 'Light' },
  NotificationFeedbackType: { Success: 'Success', Warning: 'Warning', Error: 'Error' },
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#006FEE',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    surface: '#FFFFFF',
    border: '#E4E4E7',
    borderSubtle: '#F0F0F0',
    text: '#11181C',
    textSecondary: '#687076',
    onPrimary: '#FFFFFF',
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'poll.totalVotes') return `${String(opts?.count ?? 0)} votes`;
      if (key === 'poll.voted') return 'You voted';
      if (key === 'poll.closed') return 'Poll closed';
      if (key === 'poll.voteToSeeResults') return 'Vote to see results';
      if (key === 'poll.resultsHiddenUntilClose') return 'Results revealed when poll closes';
      if (key === 'poll.rankInstructions') return 'Put every option in your preferred order.';
      if (key === 'poll.rankSubmitted') return 'Your preference order has been submitted.';
      if (key === 'poll.rankingClosed') return 'This ranked poll is closed.';
      if (key === 'poll.moveUp') return `Move ${String(opts?.option ?? '')} up`;
      if (key === 'poll.moveDown') return `Move ${String(opts?.option ?? '')} down`;
      if (key === 'poll.submitRankings') return 'Submit preferences';
      if (key === 'poll.submittingRankings') return 'Submitting';
      if (key === 'poll.ranked') return 'Ranked choice';
      if (key === 'poll.resultsHeading') return 'Ranked results';
      if (key === 'poll.resultsLoading') return 'Loading results';
      if (key === 'poll.resultsLoadFailed') return 'Results could not be loaded.';
      if (key === 'poll.retryResults') return 'Try results again';
      if (key === 'poll.totalVoters') return `${String(opts?.count ?? 0)} voters`;
      if (key === 'poll.firstChoiceVotes') return `${String(opts?.count ?? 0)} first-choice votes`;
      return key;
    },
  }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

const mockToastShow = jest.fn();

jest.mock('heroui-native', () => {
  const React = require('react');
  const { Text, View } = require('react-native');

  const Chip = ({ children }: { children?: React.ReactNode }) => <View>{children}</View>;
  Chip.Label = ({ children }: { children?: React.ReactNode }) => <Text>{children}</Text>;

  return { Chip, useToast: () => ({ toast: { show: mockToastShow, hide: jest.fn() }, isToastVisible: false }) };
});

describe('PollCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRankedPollResults.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lets members vote when the API omits user_vote_option_id', async () => {
    const updatedPoll: PollData = {
      id: 9,
      question: 'Which session should we run?',
      total_votes: 1,
      user_vote_option_id: 11,
      is_active: true,
      options: [
        { id: 11, text: 'Skill swap clinic', vote_count: 1, percentage: 100 },
        { id: 12, text: 'Repair cafe', vote_count: 0, percentage: 0 },
      ],
    };
    mockVoteFeedPoll.mockResolvedValue({ data: updatedPoll });
    const onVoted = jest.fn();

    const pollWithoutVoteFlag = {
      id: 9,
      question: 'Which session should we run?',
      total_votes: 0,
      is_active: true,
      options: [
        { id: 11, text: 'Skill swap clinic', vote_count: 0, percentage: 0 },
        { id: 12, text: 'Repair cafe', vote_count: 0, percentage: 0 },
      ],
    } as PollData;

    const { getByLabelText } = render(
      <PollCard pollData={pollWithoutVoteFlag} itemId={77} onVoted={onVoted} />,
    );

    fireEvent.press(getByLabelText('Skill swap clinic'));

    await waitFor(() => expect(mockVoteFeedPoll).toHaveBeenCalledWith(77, 11));
    await waitFor(() => expect(onVoted).toHaveBeenCalledWith(updatedPoll));
  });

  it('serializes rapid taps before the voting state renders', async () => {
    let resolveVote!: (value: { data: PollData }) => void;
    const updated = { ...withheld(141), user_vote_option_id: 141 };
    mockVoteFeedPoll.mockImplementationOnce(() => new Promise((resolve) => { resolveVote = resolve; }));

    const { getByLabelText } = render(<PollCard pollData={withheld(null)} itemId={41} />);
    const option = getByLabelText('Saturday morning');
    fireEvent.press(option);
    fireEvent.press(option);

    expect(mockVoteFeedPoll).toHaveBeenCalledTimes(1);
    resolveVote({ data: updated });
    await waitFor(() => expect(mockVoteFeedPoll).toHaveBeenCalledTimes(1));
  });

  it('renders and submits a ranked ballot in the member-selected order', async () => {
    const ranked: PollData = {
      ...withheld(null),
      poll_type: 'ranked',
      options: [
        { id: 141, text: 'Saturday morning', vote_count: null, percentage: null },
        { id: 142, text: 'Thursday evening', vote_count: null, percentage: null },
      ],
    };
    const accepted = { ...ranked, user_rankings: [{ option_id: 142, rank: 1 }, { option_id: 141, rank: 2 }] };
    mockRankPoll.mockResolvedValue({ data: { poll: accepted, ranked_results: { total_voters: 1, results: [] } } });
    const { getByLabelText, getByText } = render(<PollCard pollData={ranked} itemId={41} />);

    fireEvent.press(getByLabelText('Move Thursday evening up'));
    fireEvent.press(getByText('Submit preferences'));

    await waitFor(() => expect(mockRankPoll).toHaveBeenCalledWith(41, [142, 141]));
    await waitFor(() => expect(getByText('Your preference order has been submitted.')).toBeTruthy());
  });

  it('never sends a ranked poll through the single-choice endpoint', () => {
    const ranked: PollData = { ...withheld(null), poll_type: 'ranked' };
    const { queryByLabelText, getByText } = render(<PollCard pollData={ranked} itemId={41} />);

    expect(queryByLabelText('Saturday morning')).toBeNull();
    expect(getByText('Submit preferences')).toBeTruthy();
    expect(mockVoteFeedPoll).not.toHaveBeenCalled();
  });

  it('serializes two same-frame ranked submissions', async () => {
    let resolveRank!: (value: unknown) => void;
    mockRankPoll.mockImplementationOnce(() => new Promise((resolve) => { resolveRank = resolve; }));
    const ranked: PollData = { ...withheld(null), poll_type: 'ranked' };
    const { getByText } = render(<PollCard pollData={ranked} itemId={41} />);
    const submit = getByText('Submit preferences');

    fireEvent.press(submit);
    fireEvent.press(submit);

    expect(mockRankPoll).toHaveBeenCalledTimes(1);
    await act(async () => { resolveRank({ data: { poll: { ...ranked, user_rankings: [{ option_id: 141, rank: 1 }, { option_id: 142, rank: 2 }] }, ranked_results: { total_voters: 1, results: [] } } }); });
    await waitFor(() => expect(mockRankPoll).toHaveBeenCalledTimes(1));
  });

  it('loads and renders authoritative first-choice totals for a closed ranked poll', async () => {
    const ranked: PollData = {
      ...withheld(null),
      is_active: false,
      poll_type: 'ranked',
    };
    mockGetRankedPollResults.mockResolvedValue({
      data: {
        poll: ranked,
        results_visible: true,
        my_rankings: null,
        ranked_results: {
          total_voters: 3,
          results: [
            { option_id: 142, text: 'Thursday evening', votes: 2 },
            { option_id: 141, text: 'Saturday morning', votes: 1 },
          ],
        },
      },
    });

    const { findByText, getByText, queryByText } = render(<PollCard pollData={ranked} itemId={41} />);

    expect(await findByText('3 voters')).toBeTruthy();
    expect(getByText('2 first-choice votes')).toBeTruthy();
    expect(getByText('1 first-choice votes')).toBeTruthy();
    expect(mockGetRankedPollResults).toHaveBeenCalledWith(41);
    expect(queryByText('Submit preferences')).toBeNull();
  });

  it('keeps a closed ranked-results failure visible and retries it', async () => {
    const ranked: PollData = {
      ...withheld(null),
      is_active: false,
      poll_type: 'ranked',
    };
    mockGetRankedPollResults
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({
        data: {
          poll: ranked,
          results_visible: true,
          my_rankings: null,
          ranked_results: {
            total_voters: 3,
            results: [{ option_id: 142, text: 'Thursday evening', votes: 2 }],
          },
        },
      });

    const { findByText, getByText } = render(<PollCard pollData={ranked} itemId={41} />);

    expect(await findByText('Results could not be loaded.')).toBeTruthy();
    fireEvent.press(getByText('Try results again'));

    expect(await findByText('3 voters')).toBeTruthy();
    expect(getByText('2 first-choice votes')).toBeTruthy();
    expect(mockGetRankedPollResults).toHaveBeenCalledTimes(2);
  });

  it('stacks and unclips closed ranked results at large text', async () => {
    jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({
      width: 360,
      height: 800,
      scale: 3,
      fontScale: 2,
    });
    const ranked: PollData = {
      ...withheld(null),
      is_active: false,
      poll_type: 'ranked',
    };
    mockGetRankedPollResults.mockResolvedValue({
      data: {
        poll: ranked,
        results_visible: true,
        my_rankings: null,
        ranked_results: {
          total_voters: 3,
          results: [{ option_id: 142, text: 'Community transport for isolated neighbours', votes: 2 }],
        },
      },
    });

    const { findByText, getByTestId } = render(<PollCard pollData={ranked} itemId={41} />);

    expect(await findByText('3 voters')).toBeTruthy();
    expect(getByTestId('ranked-result-142').props.className).toContain('items-start');
    expect(getByTestId('ranked-result-142').props.className).not.toContain('flex-row');
    expect(getByTestId('ranked-result-label-142')).toHaveProp('numberOfLines', 0);
  });

  /**
   * 🔴 The server withholds the tallies from everyone but the poll's creator while the
   * poll is open — `total_votes` and every `vote_count`/`percentage` arrive as null. Seen
   * on a device with a second account on 2026-08-22: the card rendered its chip with no
   * number in it ("votes") and, after voting, drew percentage bars out of nulls.
   */
  const withheld = (userVote: number | null): PollData => ({
    id: 41,
    question: 'Which day suits the repair cafe best',
    total_votes: null,
    user_vote_option_id: userVote,
    is_active: true,
    options: [
      { id: 141, text: 'Saturday morning', vote_count: null, percentage: null },
      { id: 142, text: 'Thursday evening', vote_count: null, percentage: null },
    ],
  });

  it('says results are hidden instead of showing a number-less "votes" chip', () => {
    const { getByText, queryByText } = render(<PollCard pollData={withheld(null)} itemId={41} />);

    expect(getByText('Vote to see results')).toBeTruthy();
    expect(queryByText('0 votes')).toBeNull();
    expect(queryByText(' votes')).toBeNull();
  });

  it('after voting on an open poll, explains that results come when it closes', () => {
    const { getByText } = render(<PollCard pollData={withheld(141)} itemId={41} />);

    expect(getByText('Results revealed when poll closes')).toBeTruthy();
    // No percentage bar may be drawn from a withheld tally.
    expect(() => getByText('0%')).toThrow();
  });

  it('does not invent a total of 1 out of a withheld tally when voting', async () => {
    mockVoteFeedPoll.mockResolvedValue({ data: withheld(141) });

    const { getByLabelText, queryByText } = render(
      <PollCard pollData={withheld(null)} itemId={41} />,
    );
    fireEvent.press(getByLabelText('Saturday morning'));

    await waitFor(() => expect(mockVoteFeedPoll).toHaveBeenCalledWith(41, 141));
    // `null + 1` is 1 in JavaScript, which is how this shipped looking plausible.
    expect(queryByText('1 votes')).toBeNull();
    expect(queryByText('1 vote')).toBeNull();
  });

  /**
   * 🔴 The vote endpoint (`PollService`) answers differently from the feed: it DOES send a
   * real `total_votes`, because how many people took part is deliberately public, and says
   * the split is secret with `results_visible: false`. Reading only the null total made the
   * card print "2 votes" next to 0% and 0% — measured on a device on 2026-08-22.
   */
  it('shows how many voted but not the split when results_visible is false', () => {
    const voteResponse: PollData = {
      id: 41,
      question: 'Which day suits the repair cafe best',
      total_votes: 2,
      user_vote_option_id: 142,
      is_active: true,
      results_visible: false,
      options: [
        { id: 141, text: 'Saturday morning', vote_count: null, percentage: null },
        { id: 142, text: 'Thursday evening', vote_count: null, percentage: null },
      ],
    };

    const { getByText, queryByText } = render(<PollCard pollData={voteResponse} itemId={41} />);

    expect(getByText('2 votes')).toBeTruthy();
    expect(getByText('Results revealed when poll closes')).toBeTruthy();
    expect(queryByText('0%')).toBeNull();
  });

  it('tells the member when a vote is rejected instead of silently un-selecting it', async () => {
    mockVoteFeedPoll.mockRejectedValueOnce(new Error('offline'));
    const openPoll = {
      id: 9,
      question: 'Which session should we run?',
      total_votes: 0,
      is_active: true,
      options: [
        { id: 11, text: 'Skill swap clinic', vote_count: 0, percentage: 0 },
        { id: 12, text: 'Repair cafe', vote_count: 0, percentage: 0 },
      ],
    } as PollData;

    const { getByLabelText, queryByText } = render(<PollCard pollData={openPoll} itemId={77} />);

    fireEvent.press(getByLabelText('Skill swap clinic'));

    await waitFor(() => expect(mockToastShow).toHaveBeenCalledTimes(1));
    expect(mockToastShow.mock.calls[0][0]).toMatchObject({ variant: 'danger' });
    // The optimistic selection is rolled back — no "You voted" state may remain.
    expect(queryByText('You voted')).toBeNull();
  });
});
