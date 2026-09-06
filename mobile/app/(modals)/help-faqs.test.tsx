// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { ApiResponseError } from '@/lib/api/client';
import { getHelpFaqs } from '@/lib/api/help';
import HelpFaqsRoute from './help-faqs';

jest.mock('@/lib/api/help', () => ({ getHelpFaqs: jest.fn() }));
jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#0ea5e9',
  useTenant: () => ({ tenant: { slug: 'hour-timebank' } }),
}));
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppTopBar', () => {
  const { Text } = require('react-native');
  return function MockAppTopBar({ title }: { title: string }) {
    return <Text>{title}</Text>;
  };
});

const mockGetHelpFaqs = getHelpFaqs as jest.MockedFunction<typeof getHelpFaqs>;

const FAQS = [
  {
    category: 'Getting started',
    faqs: [
      { id: 1, question: 'How do I earn time credits?', answer: '<p>Give an hour, earn an hour.</p>' },
      { id: 2, question: 'How do I find a listing?', answer: 'Browse the listings tab.' },
    ],
  },
  {
    category: 'Wallet',
    faqs: [{ id: 3, question: 'Where is my balance?', answer: 'On the wallet screen.' }],
  },
];

async function renderScreen() {
  const view = render(<HelpFaqsRoute />);
  await waitFor(() => expect(mockGetHelpFaqs).toHaveBeenCalled());
  return view;
}

describe('HelpFaqsRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetHelpFaqs.mockResolvedValue(FAQS);
  });

  it('shows every published question, grouped by its category', async () => {
    const { getByText } = await renderScreen();

    await waitFor(() => expect(getByText('How do I earn time credits?')).toBeTruthy());
    expect(getByText('Getting started')).toBeTruthy();
    expect(getByText('Wallet')).toBeTruthy();
    expect(getByText('Where is my balance?')).toBeTruthy();
  });

  /*
    🔴 Answers are composed in a rich-text editor and stored as HTML. `<Text>`
    renders whatever string it is handed, so an unstripped answer would reach a
    member as literal markup — the same defect a member reported on the feed with
    a screenshot on 2026-08-24.
  */
  it('reveals the answer as readable text, not as HTML markup', async () => {
    const { getByText, queryByText } = await renderScreen();

    await waitFor(() => expect(getByText('How do I earn time credits?')).toBeTruthy());
    expect(queryByText('Give an hour, earn an hour.')).toBeNull();

    fireEvent.press(getByText('How do I earn time credits?'));

    expect(getByText('Give an hour, earn an hour.')).toBeTruthy();
    expect(queryByText(/<p>/)).toBeNull();
  });

  it('collapses an answer again when the question is pressed twice', async () => {
    const { getByText, queryByText } = await renderScreen();

    await waitFor(() => expect(getByText('Where is my balance?')).toBeTruthy());
    fireEvent.press(getByText('Where is my balance?'));
    expect(getByText('On the wallet screen.')).toBeTruthy();

    fireEvent.press(getByText('Where is my balance?'));
    expect(queryByText('On the wallet screen.')).toBeNull();
  });

  it('filters on the device without re-asking the server', async () => {
    const { getByPlaceholderText, getByText, queryByText } = await renderScreen();

    await waitFor(() => expect(getByText('Where is my balance?')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('Search questions and answers'), 'balance');

    expect(getByText('Where is my balance?')).toBeTruthy();
    expect(queryByText('How do I earn time credits?')).toBeNull();
    // One call, from mount. The endpoint's `q` is deliberately unused — see lib/api/help.ts.
    expect(mockGetHelpFaqs).toHaveBeenCalledTimes(1);
  });

  it('searches the answer text too, not only the question', async () => {
    const { getByPlaceholderText, getByText, queryByText } = await renderScreen();

    await waitFor(() => expect(getByText('How do I find a listing?')).toBeTruthy());

    fireEvent.changeText(getByPlaceholderText('Search questions and answers'), 'listings tab');

    expect(getByText('How do I find a listing?')).toBeTruthy();
    expect(queryByText('Where is my balance?')).toBeNull();
  });

  it('offers a way out of a search that matched nothing', async () => {
    const { getByPlaceholderText, getByTestId, getByText } = await renderScreen();

    await waitFor(() => expect(getByText('Where is my balance?')).toBeTruthy());
    fireEvent.changeText(getByPlaceholderText('Search questions and answers'), 'zzzz');

    expect(getByTestId('help-faqs-no-matches')).toBeTruthy();

    fireEvent.press(getByText('Clear search'));

    expect(getByText('Where is my balance?')).toBeTruthy();
  });

  it('says so plainly when the community has published nothing', async () => {
    mockGetHelpFaqs.mockResolvedValue([]);

    const { getByTestId, getByText, queryByPlaceholderText } = await renderScreen();

    await waitFor(() => expect(getByTestId('help-faqs-empty')).toBeTruthy());
    expect(getByText('No help answers yet')).toBeTruthy();
    // No point offering a search box over an empty list.
    expect(queryByPlaceholderText('Search questions and answers')).toBeNull();
  });

  it('offers a retry that actually re-asks the server after a failure', async () => {
    /*
      A 403 rather than a bare Error on purpose: `useApi` treats anything that is
      not an `ApiResponseError`, and any 5xx, as transient and silently retries
      once after two seconds. Only a non-retryable refusal surfaces immediately,
      which is the state this test is about.
    */
    mockGetHelpFaqs.mockRejectedValueOnce(new ApiResponseError(403, 'Help is not available for this community.'));

    const { getByTestId, getByText } = await renderScreen();

    await waitFor(() => expect(getByTestId('help-faqs-error')).toBeTruthy());

    mockGetHelpFaqs.mockResolvedValue(FAQS);
    await act(async () => {
      fireEvent.press(getByText('Retry'));
    });

    await waitFor(() => expect(getByText('Where is my balance?')).toBeTruthy());
    expect(mockGetHelpFaqs).toHaveBeenCalledTimes(2);
  });
});
