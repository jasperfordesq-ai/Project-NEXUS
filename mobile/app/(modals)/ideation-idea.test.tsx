// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockToast = jest.fn();
let mockParams: Record<string, string> = {};
let mockFeatures: Record<string, boolean> = { ideation_challenges: true };
let mockUser: { id: number } | null = { id: 7 };

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => ({
      'ideation:idea_detail.page_title': 'Idea',
      'ideation:idea_detail.submitted_by': `Submitted by ${String(values?.name ?? '')}`,
      'ideation:ideaStatus.submitted': 'Submitted',
      'ideation:votesCount': `${String(values?.count ?? 0)} votes`,
      'ideation:vote': 'Vote',
      'ideation:voted': 'Voted',
      'ideation:voteFailed': 'Your vote could not be saved',
      'ideation:ideas.edit': 'Edit idea',
      'ideation:ideas.load_error': 'The idea could not be loaded.',
      'ideation:actions.retry': 'Retry',
      'ideation:disabledTitle': 'Ideation is not enabled for your community.',
      'ideation:disabledSubtitle': 'Ask a coordinator to turn it on.',
      'ideation:form.title_label': 'Title',
      'ideation:form.description_label': 'Description',
      'ideation:form.cancel': 'Cancel',
      'ideation:form.save': 'Save',
      'ideation:form.saving': 'Saving…',
      'ideation:comments.title': 'Comments',
      'ideation:comments.add_label': 'Add a comment',
      'ideation:comments.add_placeholder': 'Share your thoughts',
      'ideation:comments.add_button': 'Post comment',
      'ideation:comments.empty_title': 'No comments yet.',
      'ideation:comments.empty_description': 'Be the first to reply.',
      'ideation:comments.load_error': 'Comments could not be loaded.',
      'ideation:toast.vote_added': 'Vote added',
      'ideation:toast.vote_removed': 'Vote removed',
      'ideation:toast.comment_added': 'Comment added',
      'ideation:toast.idea_updated': 'Idea updated',
      'ideation:toast.error_generic': 'Something went wrong',
      'common:back': 'Back',
      'common:unknown': 'Unknown',
    } as Record<string, string>)[key] ?? key,
  }),
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => ({ hasFeature: (name: string) => Boolean(mockFeatures[name]) }),
}));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ bg: '#fff', text: '#111', textSecondary: '#555', textMuted: '#777' }),
}));
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: (...args: unknown[]) => mockToast(...args) }) }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/lib/api/ideation', () => ({
  getIdeationIdea: jest.fn(),
  getIdeationComments: jest.fn(),
  addIdeationComment: jest.fn(),
  voteIdeationIdea: jest.fn(),
  updateIdeationIdea: jest.fn(),
}));

import IdeationIdeaScreen from './ideation-idea';
import {
  addIdeationComment,
  getIdeationComments,
  getIdeationIdea,
  updateIdeationIdea,
  voteIdeationIdea,
} from '@/lib/api/ideation';
import { ApiResponseError } from '@/lib/api/client';

const idea = (overrides: Record<string, unknown> = {}) => ({
  id: 31,
  challenge_id: 21,
  user_id: 7,
  title: 'Orchard on the green',
  description: '<p>Plant fruit trees   on the green.</p>',
  votes_count: 5,
  status: 'submitted',
  has_voted: false,
  creator: { id: 7, name: 'Ada Member' },
  ...overrides,
});

describe('IdeationIdeaScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { id: '31' };
    mockFeatures = { ideation_challenges: true };
    mockUser = { id: 7 };
    jest.mocked(getIdeationIdea).mockResolvedValue(idea() as never);
    jest.mocked(getIdeationComments).mockResolvedValue({ items: [], nextCursor: null, hasMore: false } as never);
    jest.mocked(voteIdeationIdea).mockResolvedValue({ voted: true, votes_count: 6 } as never);
    jest.mocked(addIdeationComment).mockResolvedValue({ id: 1 } as never);
    jest.mocked(updateIdeationIdea).mockResolvedValue(idea() as never);
  });

  it('renders the idea with its HTML description stripped to plain text', async () => {
    const { getByText } = render(<IdeationIdeaScreen />);
    await waitFor(() => expect(getByText('Orchard on the green')).toBeTruthy());
    expect(getIdeationIdea).toHaveBeenCalledWith(31);
    expect(getByText('Plant fruit trees on the green.')).toBeTruthy();
    expect(getByText('Submitted by Ada Member')).toBeTruthy();
    expect(getByText('5 votes')).toBeTruthy();
    expect(getByText('No comments yet.')).toBeTruthy();
  });

  it('votes on the idea and refreshes it', async () => {
    const { getByText } = render(<IdeationIdeaScreen />);
    await waitFor(() => expect(getByText('Vote')).toBeTruthy());
    fireEvent.press(getByText('Vote'));
    await waitFor(() => expect(voteIdeationIdea).toHaveBeenCalledWith(31));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith({ title: 'Vote added', variant: 'success' }));
    await waitFor(() => expect(getIdeationIdea).toHaveBeenCalledTimes(2));
  });

  it('reports a vote that could not be saved', async () => {
    jest.mocked(voteIdeationIdea).mockRejectedValue(new ApiResponseError(422, 'Voting has closed'));
    const { getByText } = render(<IdeationIdeaScreen />);
    await waitFor(() => expect(getByText('Vote')).toBeTruthy());
    fireEvent.press(getByText('Vote'));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Your vote could not be saved', description: 'Voting has closed', variant: 'danger' }),
    ));
  });

  it('posts a comment, clears the field and reloads the thread', async () => {
    const { getByText, getByPlaceholderText } = render(<IdeationIdeaScreen />);
    await waitFor(() => expect(getByText('Post comment')).toBeTruthy());
    const field = getByPlaceholderText('Share your thoughts');
    fireEvent.changeText(field, '  Great idea  ');
    fireEvent.press(getByText('Post comment'));
    await waitFor(() => expect(addIdeationComment).toHaveBeenCalledWith(31, 'Great idea'));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith({ title: 'Comment added', variant: 'success' }));
    await waitFor(() => expect(getIdeationComments).toHaveBeenCalledTimes(2));
  });

  it('does not post an empty comment', async () => {
    const { getByText, getByPlaceholderText } = render(<IdeationIdeaScreen />);
    await waitFor(() => expect(getByText('Post comment')).toBeTruthy());
    fireEvent.changeText(getByPlaceholderText('Share your thoughts'), '   ');
    fireEvent.press(getByText('Post comment'));
    expect(addIdeationComment).not.toHaveBeenCalled();
  });

  it('lets the author edit their own idea and save it', async () => {
    const { getByText, getByDisplayValue } = render(<IdeationIdeaScreen />);
    await waitFor(() => expect(getByText('Edit idea')).toBeTruthy());
    fireEvent.press(getByText('Edit idea'));
    fireEvent.changeText(getByDisplayValue('Orchard on the green'), 'Community orchard');
    fireEvent.press(getByText('Save'));
    await waitFor(() => expect(updateIdeationIdea).toHaveBeenCalledWith(31, {
      title: 'Community orchard',
      description: '<p>Plant fruit trees   on the green.</p>',
    }));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith({ title: 'Idea updated', variant: 'success' }));
  });

  it('does not offer editing to anyone but the author', async () => {
    mockUser = { id: 99 };
    const { getByText, queryByText } = render(<IdeationIdeaScreen />);
    await waitFor(() => expect(getByText('Vote')).toBeTruthy());
    expect(queryByText('Edit idea')).toBeNull();
  });

  it('lists the comments that exist', async () => {
    jest.mocked(getIdeationComments).mockResolvedValue({
      items: [{ id: 1, idea_id: 31, user_id: 8, body: 'Love this', author: { id: 8, name: 'Bram' } }],
      nextCursor: null,
      hasMore: false,
    } as never);
    const { getByText } = render(<IdeationIdeaScreen />);
    await waitFor(() => expect(getByText('Love this')).toBeTruthy());
    expect(getByText('Bram')).toBeTruthy();
  });

  it('says so, and calls nothing, when the community has no ideation module', async () => {
    mockFeatures = { ideation_challenges: false };
    const { getByText } = render(<IdeationIdeaScreen />);
    await waitFor(() => expect(getByText('Ideation is not enabled for your community.')).toBeTruthy());
    expect(getIdeationIdea).not.toHaveBeenCalled();
  });

  it('offers a retry when the idea cannot be loaded', async () => {
    jest.mocked(getIdeationIdea).mockRejectedValue(new ApiResponseError(404, 'Idea not found'));
    const { getByText } = render(<IdeationIdeaScreen />);
    await waitFor(() => expect(getByText('Idea not found')).toBeTruthy());
    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(getIdeationIdea).toHaveBeenCalledTimes(2));
  });
});
