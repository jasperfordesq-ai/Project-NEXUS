// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render } from '@testing-library/react-native';

// --- Mocks ---

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => ({ id: '7' }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'detail.title': 'Blog Post',
        'detail.invalidId': 'Invalid post ID.',
        'detail.invalidIdHint': 'We could not identify which article to open.',
        'detail.notFound': 'Post not found.',
        'detail.notFoundHint': 'This article may have been removed.',
        'detail.goBack': 'Go Back',
        'detail.backToBlog': 'Back to blog',
        'detail.share': 'Share post',
        'detail.readFull': 'Read the full post on the web.',
        'detail.tags': 'Topics',
        'detail.article': 'Article',
        'publishedOn': opts ? String(opts.date ?? '') : '',
        'by': opts ? `By ${String(opts.name ?? '')}` : 'By',
        'readingTime': opts ? `${String(opts.minutes ?? 0)} min read` : '0 min read',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
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
    info: '#3182ce',
    infoBg: '#ebf8ff',
  }),
}));

const mockUseApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/api/blog', () => ({
  getBlogPost: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => () => null);

// --- Tests ---

import BlogPostScreen from './blog-post';

const mockPost = {
  id: 7,
  title: 'Building Community Through Timebanking',
  slug: 'building-community-timebanking',
  excerpt: 'An exploration of how timebanking brings communities together.',
  content: 'Full content here. Timebanking is a reciprocal service exchange...',
  featured_image: null,
  published_at: '2026-03-01T10:00:00Z',
  reading_time: 5,
  category: { id: 3, name: 'Community', color: 'blue' },
};

beforeEach(() => {
  mockUseApi.mockReturnValue({ data: null, isLoading: false, error: null, refresh: jest.fn() });
});

describe('BlogPostScreen', () => {
  it('renders without crashing when data is loaded', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockPost },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { toJSON } = render(<BlogPostScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders the post title when loaded', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockPost },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<BlogPostScreen />);
    expect(getByText('Building Community Through Timebanking')).toBeTruthy();
  });

  it('renders the API category name', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockPost },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<BlogPostScreen />);
    expect(getByText('Community')).toBeTruthy();
  });

  it('renders the post content', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockPost },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<BlogPostScreen />);
    expect(getByText('Full content here. Timebanking is a reciprocal service exchange...')).toBeTruthy();
  });

  it('resolves relative cover image URLs', () => {
    mockUseApi.mockReturnValue({
      data: { data: { ...mockPost, featured_image: '/uploads/blog/community.jpg' } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByLabelText } = render(<BlogPostScreen />);
    expect(getByLabelText('Building Community Through Timebanking').props.source.uri).toBe(
      'https://api.project-nexus.ie/uploads/blog/community.jpg',
    );
  });

  it('renders loading state without crashing', () => {
    mockUseApi.mockReturnValue({ data: null, isLoading: true, error: null, refresh: jest.fn() });

    expect(() => render(<BlogPostScreen />)).not.toThrow();
  });

  it('renders not found state when data is null after loading', () => {
    mockUseApi.mockReturnValue({ data: null, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<BlogPostScreen />);
    expect(getByText('Post not found.')).toBeTruthy();
    expect(getByText('Back to blog')).toBeTruthy();
  });
});
