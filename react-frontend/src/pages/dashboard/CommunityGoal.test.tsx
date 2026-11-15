// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import type { User } from '@/types/api';

const { mockApi } = vi.hoisted(() => ({ mockApi: { get: vi.fn() } }));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/contexts', () => createMockContexts({
  useAuth: () => ({
    user: { id: 7 } as unknown as User,
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    updateUser: vi.fn(),
    refreshUser: vi.fn(),
    status: 'idle' as const,
    error: null,
  }),
  useTenant: () => ({
    tenant: { id: 106, name: 'Riverside Timebank', slug: 'riverside' },
    branding: { name: 'Riverside Timebank' },
    tenantPath: (p: string) => `/riverside${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  }),
}));

import { CELEBRATION_MS, CommunityGoal, type CommunityGoalRunning, type CommunityGoalDone } from './CommunityGoal';

/** Where the celebration of the default goal is remembered: community 106, member 7, goal id, metric, target. */
const CELEBRATED = 'nexus_goal_celebrated_106_7_b0a1c2d3e4f5_hours_500';

function running(overrides: Partial<CommunityGoalRunning> = {}): CommunityGoalRunning {
  return {
    id: 'b0a1c2d3e4f5',
    title: "Let's share 500 hours by spring",
    metric: 'hours',
    target: 500,
    current: 3.5,
    starts_on: '2026-11-01',
    ends_on: '2027-03-31',
    days_left: 77,
    reached: false,
    ...overrides,
  };
}

function done(i: number, overrides: Partial<CommunityGoalDone> = {}): CommunityGoalDone {
  return {
    id: `abc00000000${i}`,
    title: `Goal ${i}`,
    metric: 'exchanges',
    target: 20,
    final_count: 12,
    reached: false,
    starts_on: '2026-01-01',
    ends_on: '2026-03-01',
    ...overrides,
  };
}

const reply = (goal: CommunityGoalRunning | null, finished: CommunityGoalDone[] = []) => ({
  success: true,
  data: { month: '2026-11', hours_shared: 0, community_goal: goal, community_goals_done: finished },
});

function reduceMotion(on: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: on && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

/** An IntersectionObserver that reports the card as visible (or never does). */
function cardVisible(visible: boolean) {
  class Observer {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe = (target: Element) => {
      if (visible) this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    };
    unobserve = () => {};
    disconnect = () => {};
    takeRecords = () => [];
  }
  vi.stubGlobal('IntersectionObserver', Observer);
}

describe('CommunityGoal', () => {
  beforeEach(() => {
    mockApi.get.mockReset();
    localStorage.clear();
    reduceMotion(false);
    cardVisible(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the community's progress towards its goal", async () => {
    mockApi.get.mockResolvedValueOnce(reply(running()));
    render(<CommunityGoal />);

    const card = await screen.findByTestId('community-goal');
    expect(mockApi.get).toHaveBeenCalledWith('/v2/community/this-month');
    expect(within(card).getByRole('heading', { name: "Let's share 500 hours by spring" })).toBeInTheDocument();
    expect(card).toHaveTextContent('Our shared goal');
    expect(card).toHaveTextContent('3.5 of 500 hours shared');
    expect(card).toHaveTextContent('77 days to go');
    expect(within(card).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0.7');
    expect(screen.queryByTestId('community-goal-confetti')).toBeNull();
    expect(card).not.toHaveTextContent(/\{\{/);
  });

  it.each([
    ['exchanges', '12 of 40 exchanges completed'],
    ['offers', '12 of 40 offers and requests posted'],
    ['events', '12 of 40 events held'],
  ] as const)('words the %s goal for what it counts', async (metric, text) => {
    mockApi.get.mockResolvedValueOnce(reply(running({ metric, current: 12, target: 40 })));
    render(<CommunityGoal />);
    expect(await screen.findByTestId('community-goal')).toHaveTextContent(text);
  });

  it('says so on the last day and for one day left', async () => {
    mockApi.get.mockResolvedValueOnce(reply(running({ days_left: 0 })));
    const first = render(<CommunityGoal />);
    expect(await screen.findByTestId('community-goal')).toHaveTextContent('Today is the last day');
    first.unmount();

    mockApi.get.mockResolvedValueOnce(reply(running({ days_left: 1 })));
    render(<CommunityGoal />);
    expect(await screen.findByTestId('community-goal')).toHaveTextContent('1 day to go');
  });

  it('shows the goal title as text, never as markup', async () => {
    mockApi.get.mockResolvedValueOnce(reply(running({ title: '<b>500</b> & "more"' })));
    render(<CommunityGoal />);
    const card = await screen.findByTestId('community-goal');
    expect(within(card).getByRole('heading', { name: '<b>500</b> & "more"' })).toBeInTheDocument();
    expect(card.querySelector('b')).toBeNull();
  });

  it('celebrates once per member when the goal is reached, then just says it was reached', async () => {
    mockApi.get.mockResolvedValue(reply(running({ current: 512, reached: true })));
    const first = render(<CommunityGoal />);

    const card = await screen.findByTestId('community-goal');
    expect(card).toHaveTextContent('We did it!');
    expect(card).toHaveTextContent('512 of 500 hours shared');
    expect(within(card).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByTestId('community-goal-confetti')).toBeInTheDocument();
    // Counted as seen once it has had time to play.
    await waitFor(() => expect(localStorage.getItem(CELEBRATED)).toBe('1'), { timeout: CELEBRATION_MS + 1500 });
    first.unmount();

    render(<CommunityGoal />);
    expect(await screen.findByTestId('community-goal')).toHaveTextContent('We did it!');
    expect(screen.queryByTestId('community-goal-confetti')).toBeNull();
  });

  it('still celebrates next time if the card was gone before the confetti could play', async () => {
    mockApi.get.mockResolvedValue(reply(running({ current: 512, reached: true })));
    const first = render(<CommunityGoal />);
    await screen.findByTestId('community-goal-confetti');
    first.unmount();
    expect(localStorage.getItem(CELEBRATED)).toBeNull();

    render(<CommunityGoal />);
    expect(await screen.findByTestId('community-goal-confetti')).toBeInTheDocument();
  });

  it('waits until the card can be seen before celebrating', async () => {
    cardVisible(false);
    mockApi.get.mockResolvedValueOnce(reply(running({ current: 512, reached: true })));
    render(<CommunityGoal />);
    expect(await screen.findByTestId('community-goal')).toHaveTextContent('We did it!');
    await new Promise((resolve) => setTimeout(resolve, CELEBRATION_MS + 200));
    expect(screen.queryByTestId('community-goal-confetti')).toBeNull();
    expect(localStorage.getItem(CELEBRATED)).toBeNull();
  });

  it('a changed target is a new goal to celebrate', async () => {
    mockApi.get.mockResolvedValueOnce(reply(running({ current: 512, reached: true })));
    const first = render(<CommunityGoal />);
    await screen.findByTestId('community-goal-confetti');
    await waitFor(() => expect(localStorage.getItem(CELEBRATED)).toBe('1'), { timeout: CELEBRATION_MS + 1500 });
    first.unmount();

    mockApi.get.mockResolvedValueOnce(reply(running({ current: 612, target: 600, reached: true })));
    render(<CommunityGoal />);
    expect(await screen.findByTestId('community-goal-confetti')).toBeInTheDocument();
  });

  it('never throws confetti for a member who asks for less motion', async () => {
    reduceMotion(true);
    mockApi.get.mockResolvedValueOnce(reply(running({ current: 512, reached: true })));
    render(<CommunityGoal />);
    expect(await screen.findByTestId('community-goal')).toHaveTextContent('We did it!');
    expect(screen.queryByTestId('community-goal-confetti')).toBeNull();
  });

  it("lists up to three finished goals as what we've done together when none is running", async () => {
    mockApi.get.mockResolvedValueOnce(reply(null, [done(1, { reached: true, final_count: 20 }), done(2), done(3), done(4)]));
    render(<CommunityGoal />);

    const card = await screen.findByTestId('community-goals-done');
    expect(within(card).getByRole('heading', { name: "What we've done together" })).toBeInTheDocument();
    const items = within(card).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Goal 1');
    expect(items[0]).toHaveTextContent('20 of 20 exchanges completed');
    expect(items[0]).toHaveTextContent('Goal reached');
    expect(items[1]).not.toHaveTextContent('Goal reached');
    expect(screen.queryByTestId('community-goal')).toBeNull();
  });

  it('shows the running goal rather than the finished ones', async () => {
    mockApi.get.mockResolvedValueOnce(reply(running(), [done(1)]));
    render(<CommunityGoal />);
    await screen.findByTestId('community-goal');
    expect(screen.queryByTestId('community-goals-done')).toBeNull();
  });

  it('shows nothing for a community without a goal, or when the month cannot be loaded', async () => {
    mockApi.get.mockResolvedValueOnce(reply(null, []));
    const first = render(<CommunityGoal />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('community-goal')).toBeNull();
    expect(screen.queryByTestId('community-goals-done')).toBeNull();
    first.unmount();

    mockApi.get.mockRejectedValueOnce(new Error('offline'));
    render(<CommunityGoal />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('community-goal')).toBeNull();
  });
});
