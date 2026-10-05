// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for the five kinds of group exchange on the create form: the choice of
 * kind, the inputs each kind needs, keeping people when the kind changes, and
 * the review step that shows what the SERVER says everyone will earn or pay.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, userEvent } from '@/test/test-utils';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));
import { api } from '@/lib/api';

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Mary', name: 'Mary Byrne' },
    isAuthenticated: true,
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
  })),
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock('@/contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url) => url || '/default-avatar.png'),
  resolveThumbnailUrl: vi.fn((url) => url || null),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

vi.mock('@/lib/motion', async () => {
  const { framerMotionMock } = await import('@/test/mocks');
  return framerMotionMock;
});

vi.mock('@/components/navigation', () => ({
  Breadcrumbs: ({ items }: { items: { label: string }[] }) => (
    <nav>{items.map((i) => <span key={i.label}>{i.label}</span>)}</nav>
  ),
}));

import { CreateGroupExchangePage } from './CreateGroupExchangePage';

const PREVIEW_URL = '/v2/group-exchanges/preview';

// A number field's +/- buttons are labelled by the same label as its input, so
// look the input up by role (an input of type text is a textbox) rather than by label.
const box = (name: string | RegExp) => screen.getByRole('textbox', { name });
const maybeBox = (name: string | RegExp) => screen.queryByRole('textbox', { name });

interface PreviewData {
  lines: { user_id: number; name: string | null; role: 'provider' | 'receiver'; hours: number; verb: 'earns' | 'pays' }[];
  community_fund_hours: number;
  totals: { earned: number; paid: number; to_fund: number };
  problem: { code: string; message: string } | null;
}

const workshopPreview: PreviewData = {
  lines: [
    { user_id: 1, name: 'Mary Byrne', role: 'provider', hours: 2, verb: 'earns' },
    { user_id: 2, name: 'Tom Archer', role: 'receiver', hours: 2, verb: 'pays' },
    { user_id: 3, name: null, role: 'receiver', hours: 2, verb: 'pays' },
    { user_id: 4, name: 'Ann Doyle', role: 'receiver', hours: 2, verb: 'pays' },
    { user_id: 5, name: 'Ben Walsh', role: 'receiver', hours: 2, verb: 'pays' },
  ],
  community_fund_hours: 6,
  totals: { earned: 2, paid: 8, to_fund: 6 },
  problem: null,
};

function mockPreview(data: PreviewData) {
  vi.mocked(api.post).mockImplementation(async (url: string) => {
    if (url === PREVIEW_URL) return { success: true, data } as never;
    return { success: true, data: { id: 55 } } as never;
  });
}

function previewCalls() {
  return vi.mocked(api.post).mock.calls.filter(([url]) => url === PREVIEW_URL);
}

async function fillStepOne(hours: string, hoursLabel: string | RegExp = /How long was the session/) {
  fireEvent.change(screen.getByPlaceholderText('e.g., Community Garden Workday'), {
    target: { value: 'Pottery class' },
  });
  const field = box(hoursLabel);
  fireEvent.change(field, { target: { value: hours } });
  fireEvent.blur(field);
}

async function addPeople() {
  // The organiser gives time; Tom Archer receives it.
  fireEvent.click(screen.getAllByRole('button', { name: 'Giving time' })[0]);
  fireEvent.change(screen.getByPlaceholderText('Search members by name...'), { target: { value: 'Tom' } });
  await screen.findByText('Tom Archer');
  fireEvent.click(screen.getAllByRole('button', { name: 'Receiving time' })[0]);
  await screen.findByText('Giving time (1)');
}

async function reachStep(step: 2 | 3 | 4, hours = '2') {
  await fillStepOne(hours);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('Add Participants');
  await addPeople();
  if (step === 2) return;
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  if (step === 3) return;
  // The review button waits for the server's answer.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Review' }));
}

describe('CreateGroupExchangePage — kinds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [{ id: 2, name: 'Tom Archer' }],
    } as never);
    mockPreview(workshopPreview);
  });

  it('offers the five kinds in order with "Workshop or class" chosen to start with', () => {
    render(<CreateGroupExchangePage />);

    expect(screen.getByText('What kind of group exchange is this?')).toBeInTheDocument();
    expect(
      screen.getByText('One hour of time is one time credit. People giving time earn credits; people receiving time pay them.'),
    ).toBeInTheDocument();

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(5);
    const titles = [
      'Workshop or class',
      'A team helping someone',
      'Share equally',
      'Share by amount of effort',
      "Type each person's hours",
    ];
    radios.forEach((radio, i) => {
      expect(radio.closest('label')).toHaveTextContent(titles[i]);
    });
    expect(radios[0]).toBeChecked();
    expect(radios[1]).not.toBeChecked();

    // Only the chosen kind shows its worked example.
    expect(screen.getByText(/Mary runs a 2-hour class for 4 people/)).toBeInTheDocument();
    expect(screen.queryByText(/Two volunteers spend 1 hour moving furniture/)).not.toBeInTheDocument();
  });

  it('asks the question that belongs to the chosen kind', async () => {
    render(<CreateGroupExchangePage />);
    expect(box(/How long was the session/)).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('radio')[1]);
    expect(box(/How many hours did each helper spend/)).toBeInTheDocument();
    expect(screen.getByText(/Two volunteers spend 1 hour moving furniture/)).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('radio')[2]);
    expect(
      screen.getByText('6 hours, 2 people giving and 3 receiving: each person giving time earns 3 hours and each person receiving time pays 2.'),
    ).toBeInTheDocument();
    expect(box('Total Hours')).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('radio')[4]);
    expect(maybeBox('Total Hours')).not.toBeInTheDocument();
    expect(maybeBox(/How long was the session/)).not.toBeInTheDocument();
  });

  it('pre-fills everyone\'s hours from the session length in a workshop', async () => {
    render(<CreateGroupExchangePage />);
    await reachStep(2, '2');

    expect((box('Hours for Mary Byrne') as HTMLInputElement).value).toBe('2');
    expect((box('Hours for Tom Archer') as HTMLInputElement).value).toBe('2');
  });

  it('hides the hours of the people helped when a team is helping someone', async () => {
    render(<CreateGroupExchangePage />);
    await userEvent.click(screen.getAllByRole('radio')[1]);
    await fillStepOne('1', /How many hours did each helper spend/);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Add Participants');
    await addPeople();

    expect((box('Hours for Mary Byrne') as HTMLInputElement).value).toBe('1');
    expect(maybeBox('Hours for Tom Archer')).not.toBeInTheDocument();
  });

  it('keeps the people already added, and their hours, when the kind is changed', async () => {
    render(<CreateGroupExchangePage />);
    await reachStep(2, '2');

    // Mary gave less time than the session.
    const maryHours = box('Hours for Mary Byrne');
    fireEvent.change(maryHours, { target: { value: '1.5' } });
    fireEvent.blur(maryHours);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await userEvent.click((await screen.findAllByRole('radio'))[4]);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Add Participants');

    expect(screen.getByText('Mary Byrne')).toBeInTheDocument();
    expect(screen.getByText('Tom Archer')).toBeInTheDocument();
    expect((box('Hours for Mary Byrne') as HTMLInputElement).value).toBe('1.5');
    expect((box('Hours for Tom Archer') as HTMLInputElement).value).toBe('2');
  });

  it('shows the weights only for "Share by amount of effort"', async () => {
    render(<CreateGroupExchangePage />);
    await userEvent.click(screen.getAllByRole('radio')[3]);
    fireEvent.change(screen.getByPlaceholderText('e.g., Community Garden Workday'), { target: { value: 'Move' } });
    const total = box('Total Hours');
    fireEvent.change(total, { target: { value: '6' } });
    fireEvent.blur(total);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Add Participants');
    await addPeople();

    expect(box('Share of the effort for Mary Byrne')).toBeInTheDocument();
    expect(box('Share of the effort for Tom Archer')).toBeInTheDocument();
    expect(maybeBox('Hours for Mary Byrne')).not.toBeInTheDocument();
  });

  it('shows what everyone will earn or pay from the server, including the community fund', async () => {
    render(<CreateGroupExchangePage />);
    await reachStep(3, '2');

    expect(await screen.findByText('Mary Byrne earns 2 hours')).toBeInTheDocument();
    expect(screen.getByText('Tom Archer pays 2 hours')).toBeInTheDocument();
    // A member with no name on record.
    expect(screen.getByText('A member pays 2 hours')).toBeInTheDocument();
    expect(screen.getByText('6 hours go to the community time fund')).toBeInTheDocument();
    expect(
      screen.getByText('8 hours paid · 2 hours earned · 6 hours to the community time fund'),
    ).toBeInTheDocument();

    const calls = previewCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({
      split_type: 'workshop',
      total_hours: 2,
      participants: [
        { user_id: 1, role: 'provider', hours: 2, weight: 1 },
        { user_id: 2, role: 'receiver', hours: 2, weight: 1 },
      ],
    });
  });

  it('leaves out the fund line when nothing goes to the fund', async () => {
    mockPreview({
      lines: [
        { user_id: 1, name: 'Mary Byrne', role: 'provider', hours: 1, verb: 'earns' },
        { user_id: 2, name: 'Tom Archer', role: 'receiver', hours: 1, verb: 'pays' },
      ],
      community_fund_hours: 0,
      totals: { earned: 1, paid: 1, to_fund: 0 },
      problem: null,
    });
    render(<CreateGroupExchangePage />);
    await reachStep(3, '1');

    expect(await screen.findByText('Mary Byrne earns 1 hour')).toBeInTheDocument();
    expect(screen.queryByText(/community time fund/)).not.toBeInTheDocument();
    expect(screen.getByText('1 hour paid · 1 hour earned')).toBeInTheDocument();
  });

  it('shows the server\'s problem in an alert and will not create while it stands', async () => {
    mockPreview({
      lines: workshopPreview.lines.slice(0, 2),
      community_fund_hours: 0,
      totals: { earned: 2, paid: 1, to_fund: 0 },
      problem: { code: 'EARNED_EXCEEDS_PAID', message: 'The people giving time would earn more than the people receiving time pay.' },
    });
    render(<CreateGroupExchangePage />);
    await reachStep(4, '2');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The people giving time would earn more than the people receiving time pay.');
    expect(screen.getByRole('button', { name: 'Create Group Exchange' })).toBeDisabled();
    expect(api.post).not.toHaveBeenCalledWith('/v2/group-exchanges', expect.anything());
  });

  it('creates the exchange with each person\'s hours once the preview is clean', async () => {
    render(<CreateGroupExchangePage />);
    await reachStep(4, '2');

    const create = screen.getByRole('button', { name: 'Create Group Exchange' });
    await waitFor(() => expect(create).toBeEnabled());
    fireEvent.click(create);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/v2/group-exchanges', {
        title: 'Pottery class',
        description: null,
        split_type: 'workshop',
        total_hours: 2,
        participants: [
          { user_id: 1, role: 'provider', hours: 2, weight: 1 },
          { user_id: 2, role: 'receiver', hours: 2, weight: 1 },
        ],
      }),
    );
  });

  it('ignores a preview answer that arrives after a newer one', async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    let calls = 0;
    vi.mocked(api.post).mockImplementation(((url: string) => {
      if (url !== PREVIEW_URL) return Promise.resolve({ success: true, data: { id: 55 } });
      calls += 1;
      if (calls === 1) return first;
      return Promise.resolve({ success: true, data: workshopPreview });
    }) as never);

    render(<CreateGroupExchangePage />);
    await reachStep(3, '2');
    await waitFor(() => expect(previewCalls()).toHaveLength(1));

    // Leave the review and come back: a second request is made and answered first.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByText('Add Participants');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Mary Byrne earns 2 hours')).toBeInTheDocument();

    // The slow first answer finally lands. It must not replace the newer one.
    resolveFirst({
      success: true,
      data: {
        ...workshopPreview,
        lines: [{ user_id: 1, name: 'Stale Person', role: 'provider', hours: 9, verb: 'earns' }],
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Stale Person earns 9 hours')).not.toBeInTheDocument();
    expect(screen.getByText('Mary Byrne earns 2 hours')).toBeInTheDocument();
  });

  it('never shows the words provider, receiver or transfer to a member', async () => {
    render(<CreateGroupExchangePage />);
    const forbidden = /provider|receiver|transfer/i;

    expect(document.body.textContent).not.toMatch(forbidden);
    await fillStepOne('2');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Add Participants');
    expect(document.body.textContent).not.toMatch(forbidden);

    await addPeople();
    expect(document.body.textContent).not.toMatch(forbidden);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Mary Byrne earns 2 hours');
    expect(document.body.textContent).not.toMatch(forbidden);

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    await screen.findByRole('button', { name: 'Create Group Exchange' });
    expect(document.body.textContent).not.toMatch(forbidden);
    // The kind is named, never its raw value.
    expect(document.body.textContent).toContain('Workshop or class');
    expect(document.body.textContent).not.toMatch(/\bworkshop\b(?! or class)/);
  });
});
