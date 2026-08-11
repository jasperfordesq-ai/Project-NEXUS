// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

// --- Mocks ---

// 🔴 Spies inside the factory: declared outside, jest's hoisting can evaluate the
// factory while they are still in the temporal dead zone.
jest.mock('expo-router', () => {
  const routerMock = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
  return {
    useRouter: () => routerMock,
    router: routerMock,
    useLocalSearchParams: () => ({ type: 'terms' }),
    useNavigation: () => ({ setOptions: jest.fn() }),
    Link: 'View',
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'legal:document.versionLabel': 'Version',
        'legal:document.summaryTitle': 'What has changed',
        'legal:document.effectiveFrom': 'Comes into effect',
        'legal:document.lastUpdated': 'Last updated',
        'legal:document.notYetInForce': 'This version is not yet in force.',
        'legal:document.back': 'Back to legal',
        'common:buttons.back': 'Back',
        'common:buttons.retry': 'Retry',
        'common:errors.generic': 'Something went wrong. Please try again.',
        'common:errors.notFound': 'Not found.',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ hasFeature: () => true }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
    borderSubtle: '#eeeeee',
    error: '#e53e3e',
    success: '#22c55e',
    warning: '#f59e0b',
    info: '#3b82f6',
    errorBg: '#fef2f2',
    successBg: '#f0fdf4',
    infoBg: '#eff6ff',
    warningBg: '#fffbeb',
  }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

const mockGetDocument = jest.fn();

jest.mock('@/lib/api/legal', () => ({
  getLegalDocument: (...args: unknown[]) => mockGetDocument(...args),
}));

jest.mock('@/components/ui/AppTopBar', () => () => null);
jest.mock('@/components/OfflineBanner', () => () => null);

// --- Tests ---

import LegalDocumentScreen from './legal-document';

const DOCUMENT = {
  data: {
    id: 6,
    document_id: 11,
    type: 'terms',
    title: 'Community Terms',
    content:
      '<h2>Using this service</h2><p>Use time credits fairly.</p><ul><li>Be kind</li></ul>',
    version_number: '2.1',
    effective_date: '2026-07-01T00:00:00Z',
    summary_of_changes: 'Clarified how credits are returned.',
    has_previous_versions: false,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetDocument.mockResolvedValue(DOCUMENT);
});

describe('LegalDocumentScreen', () => {
  it('renders without crashing', () => {
    const { toJSON } = render(<LegalDocumentScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('reads the document named in the route params', async () => {
    render(<LegalDocumentScreen />);

    await waitFor(() => expect(mockGetDocument).toHaveBeenCalledWith('terms'));
  });

  it('keeps the document structure rather than flattening it', async () => {
    // 🔴 A heading and a list item are separate blocks. The app's older stripHtml
    // helper merges all of this into one paragraph, which is fine for a blog
    // excerpt and not for a document somebody is asked to agree to.
    const { getByText } = render(<LegalDocumentScreen />);

    await waitFor(() => expect(getByText('Using this service')).toBeTruthy());
    expect(getByText('Use time credits fairly.')).toBeTruthy();
    expect(getByText('Be kind')).toBeTruthy();
  });

  it('shows the summary of changes', async () => {
    const { getByText } = render(<LegalDocumentScreen />);

    await waitFor(() => expect(getByText('What has changed')).toBeTruthy());
    expect(getByText('Clarified how credits are returned.')).toBeTruthy();
  });

  it('labels a past effective date as last updated', async () => {
    const { getByText } = render(<LegalDocumentScreen />);

    await waitFor(() => expect(getByText(/Last updated/)).toBeTruthy());
  });

  it('says a future-dated version is not yet in force', async () => {
    // 🔴 effective_date is routinely future-dated. Calling it "Last updated" would
    // claim terms apply that do not yet.
    mockGetDocument.mockResolvedValue({
      data: { ...DOCUMENT.data, effective_date: '2099-01-15T00:00:00Z' },
    });

    const { getByText } = render(<LegalDocumentScreen />);

    await waitFor(() => expect(getByText('This version is not yet in force.')).toBeTruthy());
    expect(getByText(/Comes into effect/)).toBeTruthy();
  });

  it('offers a retry when the document cannot be read', async () => {
    mockGetDocument.mockRejectedValue(new Error('offline'));

    const { getByText } = render(<LegalDocumentScreen />);

    await waitFor(() => expect(getByText('Retry')).toBeTruthy());
  });

  it('says so plainly when the community has published no such document', async () => {
    mockGetDocument.mockResolvedValue({ data: null });

    const { getByText } = render(<LegalDocumentScreen />);

    await waitFor(() => expect(getByText('Not found.')).toBeTruthy());
  });
});
