// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import type { PollData } from '@/lib/api/feed';
import PollCard from './PollCard';

const mockVoteFeedPoll = jest.fn();

jest.mock('@/lib/api/feed', () => ({
  voteFeedPoll: (...args: unknown[]) => mockVoteFeedPoll(...args),
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
