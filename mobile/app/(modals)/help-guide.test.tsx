// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { getMembersGuide } from '@/lib/help/guides';
import HelpGuideRoute from './help-guide';

jest.mock('@/lib/help/guides', () => ({
  ...jest.requireActual('@/lib/help/guides'),
  getMembersGuide: jest.fn(),
}));
let mockParams: Record<string, string> = {};
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#0ea5e9',
  useTenant: () => ({ hasFeature: () => true, hasModule: (name: string) => name !== 'wallet' }),
}));
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppTopBar', () => {
  const { Text } = require('react-native');
  return function MockAppTopBar({ title }: { title: string }) {
    return <Text testID="top-bar-title">{title}</Text>;
  };
});

const mockGetMembersGuide = getMembersGuide as jest.MockedFunction<typeof getMembersGuide>;

const GUIDE = {
  sections: {
    getting_started: {
      title: 'Getting started',
      summary: 'First steps on the platform.',
      articles: {
        what_is_timebanking: {
          title: 'What is timebanking?',
          summary: 'An hour for an hour.',
          body: 'Everyone\'s time is **equal**.\n\n## How it works\n1. Offer help\n2. Earn an hour on [your wallet](/wallet)\n\n> Ask a coordinator if you are unsure.',
        },
        how_time_credits_work: { title: 'How time credits work', summary: 'Credits.', body: 'Text.' },
      },
    },
  },
};

describe('HelpGuideRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMembersGuide.mockResolvedValue(GUIDE as never);
  });

  it('lists a topic\'s articles and opens one inside the app', async () => {
    mockParams = { section: 'getting_started' };
    const { findByTestId, queryByTestId } = render(<HelpGuideRoute />);

    fireEvent.press(await findByTestId('help-guide-article-what_is_timebanking'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(modals)/help-guide',
      params: { section: 'getting_started', article: 'what_is_timebanking' },
    });
    // `how_time_credits_work` depends on the wallet module, which is off here.
    expect(queryByTestId('help-guide-article-how_time_credits_work')).toBeNull();
  });

  it('renders an article as readable text, with steps and tips, and no website links', async () => {
    mockParams = { section: 'getting_started', article: 'what_is_timebanking' };
    const openURL = jest.spyOn(Linking, 'openURL');
    const { findByText, getByText, queryByText } = render(<HelpGuideRoute />);

    expect(await findByText('How it works')).toBeTruthy();
    expect(getByText('Offer help')).toBeTruthy();
    expect(getByText('Ask a coordinator if you are unsure.')).toBeTruthy();
    expect(getByText(/Earn an hour on your wallet/)).toBeTruthy();
    expect(queryByText(/\(\/wallet\)/)).toBeNull();
    expect(queryByText(/\*\*/)).toBeNull();
    expect(openURL).not.toHaveBeenCalled();
  });

  it('says so plainly when a guide is switched off or missing', async () => {
    mockParams = { section: 'getting_started', article: 'how_time_credits_work' };
    const { findByTestId } = render(<HelpGuideRoute />);

    expect(await findByTestId('help-guide-not-found')).toBeTruthy();
  });

  it('offers a retry when the guides cannot be loaded', async () => {
    mockParams = { section: 'getting_started' };
    mockGetMembersGuide.mockRejectedValue(new Error('offline'));
    const { findByTestId } = render(<HelpGuideRoute />);

    expect(await findByTestId('help-guide-error', {}, { timeout: 8000 })).toBeTruthy();
  });
});
