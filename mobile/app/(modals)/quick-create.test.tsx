// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

const mockRouterPush = jest.fn();

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
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

    🔴 Owner's report, 2026-09-06 — the second half of the same fault. Courses and
    podcasts were added, but as links that opened the WEBSITE, which reads as a
    broken app rather than a considered boundary. Both are now native builders.
    The assertions below therefore changed from "hands off to the website" to
    "opens its native builder", and the test that checked the app SAID it was
    leaving is gone, because it no longer does.
  */
  describe('every creatable module is offered', () => {
    it.each([
      ['New job', '/(modals)/new-job'],
      ['New volunteering opportunity', '/(modals)/new-volunteering'],
      ['Register an organisation', '/(modals)/new-organisation'],
      ['New course', '/(modals)/new-course'],
      ['New podcast', '/(modals)/podcast-studio'],
    ])('offers "%s" and opens its native builder', (label, route) => {
      const { getByText } = render(<QuickCreateRoute />);

      fireEvent.press(getByText(label));

      expect(mockRouterPush).toHaveBeenCalledWith(route);
      expect(openURL).not.toHaveBeenCalled();
    });

    /**
     * The regression guard for the 2026-09-06 report. Pressing every option on the
     * menu must keep the member inside the app; a re-introduced web handoff shows
     * up here rather than in a bug report.
     */
    it('never sends the member to a browser, whichever option they press', () => {
      const { getByText } = render(<QuickCreateRoute />);

      [
        'New job', 'New volunteering opportunity', 'Register an organisation',
        'New course', 'New podcast', 'New event', 'New group', 'New poll',
      ].forEach((label) => fireEvent.press(getByText(label)));

      expect(openURL).not.toHaveBeenCalled();
      expect(mockRouterPush).toHaveBeenCalledTimes(8);
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
