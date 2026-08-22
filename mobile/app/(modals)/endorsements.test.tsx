// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

// --- Mocks ---

jest.mock('expo-router', () => ({
  // The sheet closes itself when its screen loses focus; the mock runs the effect and
  // its cleanup so a test still exercises that path.
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => cb(), [cb]);
  },
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) }),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => ({}),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'title': 'Skills & Endorsements',
        'heroEyebrow': 'Trust network',
        'subtitle': 'Show the skills you can offer.',
        'mySkills': 'My Skills',
        'skillsIntro': 'Keep your profile skills current.',
        'endorsementsIntro': 'Endorsements from other members.',
        'discover.title': 'Discover',
        'discover.subtitle': 'Browse skill categories shared by members.',
        'discover.empty': 'No skill categories yet.',
        'discover.emptyHint': 'Skill categories will appear here.',
        'discover.skillsCount': opts ? `${String(opts.count ?? 0)} skills` : '0 skills',
        'discover.subcategoriesCount': opts ? `${String(opts.count ?? 0)} subcategories` : '0 subcategories',
        'discover.viewSkills': 'View skills',
        'discover.skillsInCategory': opts ? `Skills in ${String(opts.category ?? '')}` : 'Skills in category',
        'discover.noSkillsInCategory': 'No skills in this category yet.',
        'discover.memberCount': opts ? `${String(opts.count ?? 0)} members` : '0 members',
        'discover.offeringCount': opts ? `${String(opts.count ?? 0)} offering` : '0 offering',
        'discover.requestingCount': opts ? `${String(opts.count ?? 0)} requesting` : '0 requesting',
        'discover.viewMembers': 'View members',
        'discover.membersWith': opts ? `Members with ${String(opts.skill ?? '')}` : 'Members with skill',
        'discover.noMembers': 'No members found.',
        'discover.profile': 'Profile',
        'discover.offers': 'Offers',
        'discover.wants': 'Wants',
        'discover.memberFallback': 'Member',
        'discover.openMember': opts ? `Open ${String(opts.name ?? 'Member')}` : 'Open member',
        'discover.proficiency': opts ? `${String(opts.level ?? '')} proficiency` : 'Proficiency',
        'discover.loadSkillsError': 'Could not load skills.',
        'discover.loadMembersError': 'Could not load members.',
        'skillsCount': opts ? `${String(opts.count ?? 0)} skills` : '0 skills',
        'endorsementsCount': opts ? `${String(opts.count ?? 0)} endorsements` : '0 endorsements',
        'endorsements': 'Endorsements',
        'noSkills': 'No skills added yet.',
        'noSkillsHint': 'Add skills you can share.',
        'noEndorsements': 'No endorsements yet.',
        'noEndorsementsHint': 'When members endorse your skills, they will appear here.',
        'addSkill': 'Add Skill',
        'removeSkill': 'Remove',
        'skillPlaceholder': 'Enter skill name…',
        'addSkillErrorTitle': 'Skill not added',
        'addSkillError': 'Failed to save skill.',
        'removeSkillTitle': 'Remove skill',
        'removeSkillConfirm': 'Remove this skill?',
        'endorsedBy': opts ? `Endorsed by ${String(opts.count ?? 0)}` : 'Endorsed by 0',
        'common:cancel': 'Cancel',
        'skillRemovedTitle': 'Skill removed',
        'skillRemoved': 'Skill removed.',
        'removeSkillErrorTitle': 'Skill not removed',
        'removeSkillError': 'Could not remove skill.',
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
  }),
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Test User' } }),
}));

const mockUseApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/lib/api/endorsements', () => ({
  addSkill: jest.fn().mockResolvedValue(undefined),
  getSkillCategories: jest.fn(),
  getSkillCategory: jest.fn().mockResolvedValue({
    data: {
      id: 4,
      name: 'Home & Garden',
      skills: [{ skill_name: 'Gardening', user_count: 4, offering_count: 3, requesting_count: 1 }],
    },
  }),
  getMembersWithSkill: jest.fn().mockResolvedValue({
    data: [{ id: 7, first_name: 'Alice', last_name: 'Gardener', avatar: null, proficiency_level: 'advanced', is_offering: 1, is_requesting: 0 }],
  }),
  getMySkills: jest.fn(),
  getUserEndorsements: jest.fn(),
  removeSkill: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => () => null);

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

// Auto-confirm: pressing the destructive button runs the action immediately,
// mirroring the old Alert.alert button-press simulation.
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (opts: { onConfirm: () => void | Promise<void> }) => {
      void opts.onConfirm();
    },
    confirmDialog: null,
  }),
}));

// --- Tests ---

import EndorsementsScreen from './endorsements';
import { useAppToast } from '@/components/ui/AppToast';
import { getMembersWithSkill, getSkillCategory, removeSkill } from '@/lib/api/endorsements';

const defaultApiState = { data: null, isLoading: false, error: null, refresh: jest.fn() };

beforeEach(() => {
  mockUseApi.mockReturnValue(defaultApiState);
  (useAppToast() as unknown as { show: jest.Mock }).show.mockClear();
  (removeSkill as jest.Mock).mockClear();
  (getSkillCategory as jest.Mock).mockClear();
  (getMembersWithSkill as jest.Mock).mockClear();
  (router.push as jest.Mock).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const mockSkill = {
  id: 1,
  name: 'JavaScript',
  category: 'Technology',
};

const mockEndorsement = {
  id: 10,
  skill: { id: 1, name: 'JavaScript' },
  endorsed_by: { id: 2, name: 'Alice', avatar: null },
  message: 'Great developer!',
  created_at: '2026-01-20T10:00:00Z',
};

const mockSkillCategory = {
  id: 4,
  name: 'Home & Garden',
  description: 'Practical home, repair, and gardening skills.',
  skills_count: 5,
  children: [{ id: 5, name: 'Gardening', skills_count: 3, children: [] }],
};

describe('EndorsementsScreen', () => {
  it('renders without crashing', () => {
    const { toJSON } = render(<EndorsementsScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders the My Skills and Endorsements tab buttons', () => {
    const { getByText } = render(<EndorsementsScreen />);
    expect(getByText('My Skills')).toBeTruthy();
    expect(getByText('Endorsements')).toBeTruthy();
    expect(getByText('Discover')).toBeTruthy();
  });

  it('renders the empty skills state on the Skills tab', () => {
    const { getByText } = render(<EndorsementsScreen />);
    expect(getByText('No skills added yet.')).toBeTruthy();
  });

  it('renders the Add Skill button on the Skills tab', () => {
    const { getByText } = render(<EndorsementsScreen />);
    expect(getByText('Add Skill')).toBeTruthy();
  });

  it('renders skill cards when skills data is available', () => {
    mockUseApi
      .mockReturnValueOnce({ data: { data: { skills: [mockSkill] } }, isLoading: false, error: null, refresh: jest.fn() })
      .mockReturnValueOnce({ data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<EndorsementsScreen />);
    expect(getByText('JavaScript')).toBeTruthy();
    expect(getByText('Technology')).toBeTruthy();
  });

  it('switches to the Endorsements tab and renders endorsement cards', () => {
    mockUseApi.mockImplementation((loader: unknown) => {
      const source = String(loader);
      if (source.includes('getMySkills')) {
        return { data: { data: { skills: [] } }, isLoading: false, error: null, refresh: jest.fn() };
      }
      if (source.includes('getUserEndorsements')) {
        return { data: { data: [mockEndorsement] }, isLoading: false, error: null, refresh: jest.fn() };
      }
      return { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    });

    const { getByText } = render(<EndorsementsScreen />);
    fireEvent.press(getByText('Endorsements'));
    expect(getByText('Alice')).toBeTruthy();
    expect(getByText('Great developer!')).toBeTruthy();
  });

  it('renders empty endorsements state when switching to Endorsements tab with no data', () => {
    const { getByText } = render(<EndorsementsScreen />);
    fireEvent.press(getByText('Endorsements'));
    expect(getByText('No endorsements yet.')).toBeTruthy();
  });

  it('switches to Discover and renders skill category cards', () => {
    mockUseApi.mockImplementation((loader: unknown) => {
      const source = String(loader);
      if (source.includes('getMySkills')) {
        return { data: { data: { skills: [] } }, isLoading: false, error: null, refresh: jest.fn() };
      }
      if (source.includes('getUserEndorsements')) {
        return { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
      }
      return { data: { data: [mockSkillCategory] }, isLoading: false, error: null, refresh: jest.fn() };
    });

    const { getByText } = render(<EndorsementsScreen />);
    fireEvent.press(getByText('Discover'));

    expect(getByText('Home & Garden')).toBeTruthy();
    expect(getByText('Practical home, repair, and gardening skills.')).toBeTruthy();
    expect(getByText('5 skills')).toBeTruthy();
    expect(getByText('1 subcategories')).toBeTruthy();
  });

  it('opens a category, lists its skills, and opens members with that skill', async () => {
    mockUseApi.mockImplementation((loader: unknown) => {
      const source = String(loader);
      if (source.includes('getMySkills')) {
        return { data: { data: { skills: [] } }, isLoading: false, error: null, refresh: jest.fn() };
      }
      if (source.includes('getUserEndorsements')) {
        return { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
      }
      return { data: { data: [mockSkillCategory] }, isLoading: false, error: null, refresh: jest.fn() };
    });

    const { findByText, getByLabelText, getByText } = render(<EndorsementsScreen />);
    fireEvent.press(getByText('Discover'));
    fireEvent.press(getByText('View skills'));

    expect(getSkillCategory).toHaveBeenCalledWith(4);
    expect(await findByText('Gardening')).toBeTruthy();
    expect(getByText('4 members')).toBeTruthy();
    expect(getByText('3 offering')).toBeTruthy();
    expect(getByText('1 requesting')).toBeTruthy();

    fireEvent.press(getByText('View members'));

    await waitFor(() => expect(getMembersWithSkill).toHaveBeenCalledWith('Gardening'));
    expect(await findByText('Alice Gardener')).toBeTruthy();
    expect(getByText('advanced proficiency')).toBeTruthy();
    expect(getByText('Offers')).toBeTruthy();

    fireEvent.press(getByLabelText('Open Alice Gardener'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/(modals)/member-profile', params: { id: '7' } });
  });

  it('uses translated titles when confirming and completing skill removal', async () => {
    const refresh = jest.fn();
    mockUseApi
      .mockReturnValueOnce({ data: { data: { skills: [mockSkill] } }, isLoading: false, error: null, refresh })
      .mockReturnValueOnce({ data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() });
    const { show } = useAppToast() as unknown as { show: jest.Mock };

    const { getByLabelText } = render(<EndorsementsScreen />);
    // The auto-confirm mock runs onConfirm immediately, mirroring the user
    // tapping the destructive button in the branded ConfirmDialog.
    fireEvent.press(getByLabelText('Remove'));

    await waitFor(() => expect(removeSkill).toHaveBeenCalledWith(1));
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Skill removed', description: 'Skill removed.', variant: 'success' }),
    );
  });
});
