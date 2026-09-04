// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

const mockRouterPush = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

const mockModules = { current: ['listings'] as string[] };
const ALL_FEATURES = [
  'events', 'groups', 'goals', 'marketplace', 'polls',
  'job_vacancies', 'volunteering', 'organisations', 'courses', 'podcasts',
];
const mockFeatures = { current: [...ALL_FEATURES] as string[] };

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => ({
    tenant: { slug: 'hour-timebank' },
    hasFeature: (feature: string) => mockFeatures.current.includes(feature),
    hasModule: (module: string) => mockModules.current.includes(module),
  }),
}));

jest.mock('@/lib/constants', () => ({
  ...jest.requireActual('@/lib/constants'),
  APP_URL: 'https://app.example.test',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
  }),
}));

import QuickCreateRoute from './quick-create';

describe('QuickCreateRoute', () => {
  let openURL: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockModules.current = ['listings'];
    mockFeatures.current = [...ALL_FEATURES];
    openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });

  afterEach(() => {
    openURL.mockRestore();
  });

  /*
    🔴 This screen loads only the `common` namespace, and the composer's label lives in
    `home`. The assertion on the rendered English is therefore load-bearing: it proves the
    explicit `home:newPost.title` key resolves here rather than rendering the key itself,
    which is what a missing namespace looks like on screen.
  */
  it('offers writing a post when the community has a feed, and opens the composer', () => {
    mockModules.current = ['listings', 'feed'];

    const { getByText } = render(<QuickCreateRoute />);
    const option = getByText('Create post');
    expect(option).toBeTruthy();

    fireEvent.press(option);
    expect(mockRouterPush).toHaveBeenCalledWith('/(modals)/new-post');
  });

  it('leaves the post option out when the community has no feed', () => {
    const { queryByText } = render(<QuickCreateRoute />);

    expect(queryByText('Create post')).toBeNull();
  });

  it('renders source-of-truth quick-create options without caring community', () => {
    const { getByText } = render(<QuickCreateRoute />);

    expect(getByText('New listing')).toBeTruthy();
    expect(getByText('Sell item')).toBeTruthy();
    expect(getByText('New message')).toBeTruthy();
    expect(getByText('New event')).toBeTruthy();
    expect(getByText('New poll')).toBeTruthy();
    expect(getByText('New group')).toBeTruthy();
    expect(getByText('New goal')).toBeTruthy();
  });

  it('opens the selected create flow', () => {
    const { getByText } = render(<QuickCreateRoute />);

    fireEvent.press(getByText('New event'));

    expect(mockRouterPush).toHaveBeenCalledWith('/(modals)/new-event');
  });

  it('opens the native message composer from quick-create', () => {
    const { getByText } = render(<QuickCreateRoute />);

    fireEvent.press(getByText('New message'));

    expect(mockRouterPush).toHaveBeenCalledWith('/(modals)/new-message');
  });

  it('opens the marketplace listing creator from quick-create', () => {
    const { getByText } = render(<QuickCreateRoute />);

    fireEvent.press(getByText('Sell item'));

    expect(mockRouterPush).toHaveBeenCalledWith('/(modals)/new-marketplace-listing');
  });

  it('opens the native poll composer from quick-create', () => {
    const { getByText } = render(<QuickCreateRoute />);

    fireEvent.press(getByText('New poll'));

    expect(mockRouterPush).toHaveBeenCalledWith('/(modals)/polls?create=1');
  });

  /*
    🔴 Owner's report, 2026-09-04: with courses and podcasts switched on, this menu
    showed nothing for either. The audit that followed found three native builders
    that already existed but were never offered here, and two modules with no
    native builder at all. Every module a member can create in must now appear.
  */
  describe('every creatable module is offered', () => {
    it.each([
      ['New job', '/(modals)/new-job'],
      ['New volunteering opportunity', '/(modals)/new-volunteering'],
      ['Register an organisation', '/(modals)/new-organisation'],
    ])('offers "%s" and opens its native builder', (label, route) => {
      const { getByText } = render(<QuickCreateRoute />);

      fireEvent.press(getByText(label));

      expect(mockRouterPush).toHaveBeenCalledWith(route);
      expect(openURL).not.toHaveBeenCalled();
    });

    it.each([
      ['New course', 'https://app.example.test/hour-timebank/courses/instructor/new'],
      ['New podcast', 'https://app.example.test/hour-timebank/podcasts/studio'],
    ])('offers "%s" and hands off to the website inside the member’s community', (label, url) => {
      const { getByText } = render(<QuickCreateRoute />);

      fireEvent.press(getByText(label));

      // The slug in the URL is load-bearing: slug-less, the shared host renders
      // the platform landing page and the builder is never reached.
      expect(openURL).toHaveBeenCalledWith(url);
      expect(mockRouterPush).not.toHaveBeenCalled();
    });

    it('says on its face which options leave the app', () => {
      const { getAllByText, getByLabelText } = render(<QuickCreateRoute />);

      expect(getAllByText('Opens on the website')).toHaveLength(2);
      expect(getByLabelText('New course. Opens on the website')).toBeTruthy();
      expect(getByLabelText('New podcast. Opens on the website')).toBeTruthy();
    });

    it.each([
      ['job_vacancies', 'New job'],
      ['volunteering', 'New volunteering opportunity'],
      ['organisations', 'Register an organisation'],
      ['courses', 'New course'],
      ['podcasts', 'New podcast'],
    ])('hides the option when the %s feature is switched off', (feature, label) => {
      mockFeatures.current = ALL_FEATURES.filter((f) => f !== feature);

      const { queryByText } = render(<QuickCreateRoute />);

      expect(queryByText(label)).toBeNull();
    });
  });
});
