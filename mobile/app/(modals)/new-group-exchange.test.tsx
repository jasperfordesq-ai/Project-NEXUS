// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockCreateGroupExchange = jest.fn();
const mockPreviewGroupExchange = jest.fn();
const mockGetMembers = jest.fn();
const mockRouterReplace = jest.fn();
const mockReserveCreation = jest.fn();
const mockCompleteCreation = jest.fn();
const mockShowToast = jest.fn();
// The signed-in organiser. The member directory never returns the viewer, so the
// screen has to offer "add yourself" from the auth context instead.
type MockAuthUser = { id: number; first_name: string | null; last_name: string | null; avatar_url: string | null };
const mockOrganiser: MockAuthUser = { id: 42, first_name: 'Olive', last_name: 'Organiser', avatar_url: null };
let mockAuthUser: MockAuthUser | null = mockOrganiser;

jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockRouterReplace(...args) },
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn() }),
  useFocusEffect: jest.fn(),
}));
// Confirmations resolve immediately so the guarded action runs in the test.
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (options: { onConfirm: () => void }) => options.onConfirm(),
    confirmDialog: null,
  }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: mockAuthUser !== null, user: mockAuthUser }),
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#6366f1' }));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#000',
    textSecondary: '#666',
  }),
}));
jest.mock('@/lib/api/groupExchanges', () => ({
  createGroupExchange: (...args: unknown[]) => mockCreateGroupExchange(...args),
  previewGroupExchange: (...args: unknown[]) => mockPreviewGroupExchange(...args),
}));
jest.mock('@/lib/api/members', () => ({
  getMembers: (...args: unknown[]) => mockGetMembers(...args),
}));
jest.mock('@/lib/groupExchangeCreationOperation', () => ({
  reserveGroupExchangeCreationOperation: (...args: unknown[]) => mockReserveCreation(...args),
  completeGroupExchangeCreationOperation: (...args: unknown[]) => mockCompleteCreation(...args),
}));

// Stable AppToast mock — fns created inside the factory closure.
jest.mock('@/components/ui/AppToast', () => {
  const hide = jest.fn();
  return { useAppToast: () => ({ show: mockShowToast, hide, isToastVisible: false }) };
});

import NewGroupExchangeRoute from './new-group-exchange';

const okPreview = {
  data: {
    lines: [],
    community_fund_hours: 0,
    totals: { earned: 0, paid: 0, to_fund: 0 },
    problem: null,
  },
};

// The preview is asked for after a short pause in typing, and Create stays disabled until the
// answer for the CURRENT numbers has arrived. Tests wait that out rather than reaching round it.
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 450)); });
}

beforeEach(() => {
  mockCreateGroupExchange.mockReset().mockResolvedValue({ data: { id: 55 } });
  mockPreviewGroupExchange.mockReset().mockResolvedValue(okPreview);
  mockGetMembers.mockReset().mockResolvedValue({
    data: [
      {
        id: 7,
        name: 'Alice Provider',
        first_name: 'Alice',
        last_name: 'Provider',
        avatar: null,
        avatar_url: null,
        tagline: null,
        location: 'Northside',
        latitude: null,
        longitude: null,
        created_at: '2026-01-01T00:00:00Z',
        is_verified: true,
        rating: null,
        total_hours_given: 0,
        total_hours_received: 0,
      },
      {
        id: 8,
        name: 'Riley Receiver',
        first_name: 'Riley',
        last_name: 'Receiver',
        avatar: null,
        avatar_url: null,
        tagline: null,
        location: 'Southside',
        latitude: null,
        longitude: null,
        created_at: '2026-01-01T00:00:00Z',
        is_verified: false,
        rating: null,
        total_hours_given: 0,
        total_hours_received: 0,
      },
    ],
  });
  mockRouterReplace.mockReset();
  mockReserveCreation.mockReset().mockResolvedValue({
    storageKey: 'saved-group-exchange',
    key: 'mobile-group-exchange-create-123',
    createdAt: 1,
  });
  mockCompleteCreation.mockReset().mockResolvedValue(undefined);
  mockShowToast.mockReset();
  mockAuthUser = mockOrganiser;
});

describe('NewGroupExchangeRoute', () => {
  const member = (id: number, name: string) => ({
    id,
    name,
    first_name: name,
    last_name: '',
    avatar: null,
    avatar_url: null,
    tagline: null,
    location: null,
    latitude: null,
    longitude: null,
    created_at: '2026-01-01T00:00:00Z',
    is_verified: true,
    rating: null,
    total_hours_given: 0,
    total_hours_received: 0,
  });

  it('keeps the latest member search when an earlier response finishes last', async () => {
    let finishEarlier!: (value: unknown) => void;
    let finishLatest!: (value: unknown) => void;
    mockGetMembers
      .mockReset()
      .mockImplementationOnce(() => new Promise(resolve => { finishEarlier = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishLatest = resolve; }));
    const screen = render(<NewGroupExchangeRoute />);
    const input = screen.getByPlaceholderText('Search by name or skill');

    fireEvent.changeText(input, 'al');
    fireEvent(input, 'submitEditing');
    fireEvent.changeText(input, 'ri');
    fireEvent(input, 'submitEditing');
    await waitFor(() => expect(mockGetMembers).toHaveBeenCalledTimes(2));

    await act(async () => { finishLatest({ data: [member(8, 'Riley Receiver')] }); });
    expect(screen.getByText('Riley Receiver')).toBeTruthy();
    await act(async () => { finishEarlier({ data: [member(7, 'Alice Provider')] }); });
    expect(screen.queryByText('Alice Provider')).toBeNull();
    expect(screen.getByText('Riley Receiver')).toBeTruthy();
  });

  it('ignores an obsolete member-search failure after a newer search succeeds', async () => {
    let rejectEarlier!: (reason: Error) => void;
    mockGetMembers
      .mockReset()
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectEarlier = reject; }))
      .mockResolvedValueOnce({ data: [member(8, 'Riley Receiver')] });
    const screen = render(<NewGroupExchangeRoute />);
    const input = screen.getByPlaceholderText('Search by name or skill');

    fireEvent.changeText(input, 'al');
    fireEvent(input, 'submitEditing');
    fireEvent.changeText(input, 'ri');
    fireEvent(input, 'submitEditing');
    await screen.findByText('Riley Receiver');
    await act(async () => { rejectEarlier(new Error('Late failure')); });

    expect(screen.getByText('Riley Receiver')).toBeTruthy();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  /** Search "garden", then add Alice (id 7) as giving time and Riley (id 8) as receiving time. */
  async function addTwoPeople(screen: ReturnType<typeof render>) {
    fireEvent.changeText(screen.getByPlaceholderText('Search by name or skill'), 'garden');
    fireEvent.press(screen.getByText('Search members'));
    await waitFor(() => expect(mockGetMembers).toHaveBeenCalledWith(0, 'garden'));
    await screen.findByText('Alice Provider');
    fireEvent.press(screen.getAllByText('Add to giving time')[0]);
    fireEvent.press(screen.getAllByText('Add to receiving time')[0]);
  }

  const kindTitles = [
    'Workshop or class',
    'A team helping someone',
    'Share equally',
    'Share by amount of effort',
    "Type each person's hours",
  ];
  const kindRadio = (screen: ReturnType<typeof render>, title: string) =>
    screen.getByLabelText(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  it('serializes submit events before a rerender', async () => {
    let finish!: (value: unknown) => void;
    mockCreateGroupExchange.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const screen = render(<NewGroupExchangeRoute />);
    await addTwoPeople(screen);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. Community garden workday'), 'Shared exchange');
    fireEvent.changeText(screen.getByPlaceholderText('e.g. 6'), '6');
    await settle();
    act(() => { fireEvent.press(screen.getByText('Create exchange')); fireEvent.press(screen.getByText('Create exchange')); });
    await waitFor(() => expect(mockCreateGroupExchange).toHaveBeenCalledTimes(1));
    await act(async () => { finish({ data: { id: 55 } }); });
  });

  it('ignores a create response after departure', async () => {
    let finish!: (value: unknown) => void;
    mockCreateGroupExchange.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const screen = render(<NewGroupExchangeRoute />);
    await addTwoPeople(screen);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. Community garden workday'), 'Shared exchange');
    fireEvent.changeText(screen.getByPlaceholderText('e.g. 6'), '6');
    await settle();
    fireEvent.press(screen.getByText('Create exchange'));
    await waitFor(() => expect(mockCreateGroupExchange).toHaveBeenCalledTimes(1));
    screen.unmount();
    await act(async () => { finish({ data: { id: 55 } }); await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it('offers the five kinds in order, with a workshop chosen to start with', () => {
    const screen = render(<NewGroupExchangeRoute />);

    expect(screen.getByText('What kind of group exchange is this?')).toBeTruthy();
    expect(screen.getByText(
      'One hour of time is one time credit. People giving time earn credits; people receiving time pay them.',
    )).toBeTruthy();

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(5);
    radios.forEach((radio, index) => {
      expect(String(radio.props.accessibilityLabel).startsWith(kindTitles[index])).toBe(true);
    });
    expect(radios[0].props.accessibilityState).toMatchObject({ selected: true });
    expect(radios[1].props.accessibilityState).toMatchObject({ selected: false });

    // Each kind carries its own sentence and its own worked example.
    expect(screen.getByText(/^Someone runs a session for a group\./)).toBeTruthy();
    expect(screen.getByText('Mary runs a 2-hour class for 4 people. Mary earns 2 hours. Each person pays 2 hours. The other 6 hours go to the community time fund.')).toBeTruthy();
    expect(screen.getByText('Two volunteers spend 1 hour moving furniture for Tom. Each volunteer earns 1 hour. Tom pays 2 hours.')).toBeTruthy();
    expect(screen.getByText('Ann earns 3, Ben earns 1, and Cara pays 4.')).toBeTruthy();
  });

  it('asks for the session length in a workshop and fills it in for everyone', async () => {
    const screen = render(<NewGroupExchangeRoute />);
    await addTwoPeople(screen);

    expect(screen.getByText('How long was the session (in hours)?')).toBeTruthy();
    expect(screen.getAllByPlaceholderText('0')).toHaveLength(2);

    fireEvent.changeText(screen.getByPlaceholderText('e.g. 6'), '2');
    expect(screen.getAllByPlaceholderText('0').map(input => input.props.value)).toEqual(['2', '2']);

    // Someone who came for less time can be changed on their own; a later change to the session
    // length moves only the people still on the old figure.
    fireEvent.changeText(screen.getAllByPlaceholderText('0')[1], '1');
    fireEvent.changeText(screen.getByPlaceholderText('e.g. 6'), '3');
    expect(screen.getAllByPlaceholderText('0').map(input => input.props.value)).toEqual(['3', '1']);
  });

  it('selecting a team removes the hours box for the people receiving time', async () => {
    const screen = render(<NewGroupExchangeRoute />);
    await addTwoPeople(screen);
    expect(screen.getAllByPlaceholderText('0')).toHaveLength(2);

    fireEvent.press(kindRadio(screen, 'A team helping someone'));

    expect(screen.getByText('How many hours did each helper spend?')).toBeTruthy();
    expect(screen.getAllByPlaceholderText('0')).toHaveLength(1);
  });

  it('keeps every person and their hours when the kind is switched', async () => {
    const screen = render(<NewGroupExchangeRoute />);
    await addTwoPeople(screen);
    fireEvent.changeText(screen.getAllByPlaceholderText('0')[0], '2');
    fireEvent.changeText(screen.getAllByPlaceholderText('0')[1], '3');

    fireEvent.press(kindRadio(screen, "Type each person's hours"));
    expect(screen.getByText('Alice Provider')).toBeTruthy();
    expect(screen.getByText('Riley Receiver')).toBeTruthy();
    expect(screen.getAllByPlaceholderText('0').map(input => input.props.value)).toEqual(['2', '3']);

    fireEvent.press(kindRadio(screen, 'Share by amount of effort'));
    expect(screen.getByText('Alice Provider')).toBeTruthy();
    expect(screen.getByText('Riley Receiver')).toBeTruthy();
    expect(screen.getByText('Share of the effort for Alice Provider')).toBeTruthy();
    expect(screen.queryAllByPlaceholderText('0')).toHaveLength(0);

    fireEvent.press(kindRadio(screen, "Type each person's hours"));
    expect(screen.getAllByPlaceholderText('0').map(input => input.props.value)).toEqual(['2', '3']);
  });

  it('shows what the server says everyone will earn or pay, and the community fund line', async () => {
    mockPreviewGroupExchange.mockResolvedValue({
      data: {
        lines: [
          { user_id: 7, name: 'Mary Byrne', role: 'provider', hours: 2, verb: 'earns' },
          { user_id: 8, name: 'Tom Doyle', role: 'receiver', hours: 2, verb: 'pays' },
          { user_id: 9, name: null, role: 'receiver', hours: 6.5, verb: 'pays' },
        ],
        community_fund_hours: 6,
        totals: { earned: 2, paid: 8, to_fund: 6 },
        problem: null,
      },
    });
    const screen = render(<NewGroupExchangeRoute />);
    await addTwoPeople(screen);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. 6'), '2');
    await settle();

    expect(screen.getByText('What everyone will earn or pay')).toBeTruthy();
    expect(screen.getByText('Mary Byrne earns 2 hours')).toBeTruthy();
    expect(screen.getByText('Tom Doyle pays 2 hours')).toBeTruthy();
    expect(screen.getByText('A member pays 6.5 hours')).toBeTruthy();
    expect(screen.getByText('6 hours go to the community time fund')).toBeTruthy();
    expect(screen.getByText('8 hours paid · 2 hours earned · 6 hours to the community time fund')).toBeTruthy();

    // What was asked of the server is exactly what is on the form.
    expect(mockPreviewGroupExchange).toHaveBeenLastCalledWith({
      split_type: 'workshop',
      total_hours: 2,
      participants: [
        { user_id: 7, role: 'provider', hours: 2, weight: 1 },
        { user_id: 8, role: 'receiver', hours: 2, weight: 1 },
      ],
    });
  });

  it('leaves out the fund line when nothing goes to the fund', async () => {
    mockPreviewGroupExchange.mockResolvedValue({
      data: {
        lines: [{ user_id: 7, name: 'Mary Byrne', role: 'provider', hours: 3, verb: 'earns' }],
        community_fund_hours: 0,
        totals: { earned: 3, paid: 3, to_fund: 0 },
        problem: null,
      },
    });
    const screen = render(<NewGroupExchangeRoute />);
    await addTwoPeople(screen);
    await settle();

    expect(screen.getByText('3 hours paid · 3 hours earned')).toBeTruthy();
    expect(screen.queryByText(/^\d+(\.\d+)? hours? go(es)? to the community time fund$/)).toBeNull();
  });

  it('shows the problem and will not create while the server says the numbers do not work', async () => {
    mockPreviewGroupExchange.mockResolvedValue({
      data: {
        lines: [],
        community_fund_hours: 0,
        totals: { earned: 4, paid: 2, to_fund: 0 },
        problem: { code: 'EARNED_EXCEEDS_PAID', message: 'The people giving time would earn more than the people receiving time pay.' },
      },
    });
    const screen = render(<NewGroupExchangeRoute />);
    await addTwoPeople(screen);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. Community garden workday'), 'Pottery class');
    fireEvent.changeText(screen.getByPlaceholderText('e.g. 6'), '2');
    await settle();

    expect(screen.getByText('The people giving time would earn more than the people receiving time pay.')).toBeTruthy();
    fireEvent.press(screen.getByText('Create exchange'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(mockCreateGroupExchange).not.toHaveBeenCalled();
  });

  it('will not create until the answer for the current numbers has arrived', async () => {
    let answer!: (value: unknown) => void;
    mockPreviewGroupExchange.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    const screen = render(<NewGroupExchangeRoute />);
    await addTwoPeople(screen);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. Community garden workday'), 'Pottery class');
    fireEvent.changeText(screen.getByPlaceholderText('e.g. 6'), '2');
    await settle();

    expect(screen.getByText('Working out the hours…')).toBeTruthy();
    fireEvent.press(screen.getByText('Create exchange'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(mockCreateGroupExchange).not.toHaveBeenCalled();

    await act(async () => { answer(okPreview); });
    expect(screen.queryByText('Working out the hours…')).toBeNull();
  });

  it('says so, and will not create, when the preview cannot be fetched', async () => {
    mockPreviewGroupExchange.mockRejectedValue(new Error('offline'));
    const screen = render(<NewGroupExchangeRoute />);
    await addTwoPeople(screen);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. Community garden workday'), 'Pottery class');
    fireEvent.changeText(screen.getByPlaceholderText('e.g. 6'), '2');
    await settle();

    expect(screen.getByText('We could not work out the hours. Please try again.')).toBeTruthy();
    fireEvent.press(screen.getByText('Create exchange'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(mockCreateGroupExchange).not.toHaveBeenCalled();
  });

  it('creates a weighted exchange with the typed total and each person\'s weight', async () => {
    const screen = render(<NewGroupExchangeRoute />);

    fireEvent.changeText(screen.getByPlaceholderText('e.g. Community garden workday'), 'Community garden workday');
    fireEvent.changeText(screen.getByPlaceholderText('Describe the shared work and expected outcome.'), 'Prepare the beds and paths together.');
    fireEvent.press(kindRadio(screen, 'Share by amount of effort'));
    fireEvent.changeText(screen.getByPlaceholderText('e.g. 6'), '6');
    await addTwoPeople(screen);
    fireEvent.changeText(screen.getAllByPlaceholderText('1')[0], '1.5');
    fireEvent.changeText(screen.getAllByPlaceholderText('1')[1], '2');
    await settle();
    fireEvent.press(screen.getByText('Create exchange'));

    const expected = {
      title: 'Community garden workday',
      description: 'Prepare the beds and paths together.',
      split_type: 'weighted',
      total_hours: 6,
      participants: [
        { user_id: 7, role: 'provider', hours: 0, weight: 1.5 },
        { user_id: 8, role: 'receiver', hours: 0, weight: 2 },
      ],
    };
    await waitFor(() => {
      expect(mockCreateGroupExchange).toHaveBeenCalledWith(expected, 'mobile-group-exchange-create-123');
    });
    expect(mockReserveCreation).toHaveBeenCalledWith(JSON.stringify(expected));
    expect(mockCompleteCreation).toHaveBeenCalledWith(expect.objectContaining({ key: 'mobile-group-exchange-create-123' }));
    expect(mockRouterReplace).toHaveBeenCalledWith({
      pathname: '/(modals)/group-exchange-detail',
      params: { id: '55' },
    });
  });

  it('creates a workshop with each person\'s own hours and the session length as the total', async () => {
    const screen = render(<NewGroupExchangeRoute />);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. Community garden workday'), 'Pottery class');
    await addTwoPeople(screen);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. 6'), '2');
    fireEvent.changeText(screen.getAllByPlaceholderText('0')[1], '1.5');
    await settle();
    fireEvent.press(screen.getByText('Create exchange'));

    await waitFor(() => {
      expect(mockCreateGroupExchange).toHaveBeenCalledWith({
        title: 'Pottery class',
        description: null,
        split_type: 'workshop',
        total_hours: 2,
        participants: [
          { user_id: 7, role: 'provider', hours: 2, weight: 1 },
          { user_id: 8, role: 'receiver', hours: 1.5, weight: 1 },
        ],
      }, 'mobile-group-exchange-create-123');
    });
  });

  it('creates a team with the hours each helper spent and nothing typed for the person helped', async () => {
    const screen = render(<NewGroupExchangeRoute />);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. Community garden workday'), 'Moving furniture');
    fireEvent.press(kindRadio(screen, 'A team helping someone'));
    await addTwoPeople(screen);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. 6'), '1');
    await settle();
    fireEvent.press(screen.getByText('Create exchange'));

    await waitFor(() => {
      expect(mockCreateGroupExchange).toHaveBeenCalledWith({
        title: 'Moving furniture',
        description: null,
        split_type: 'team',
        total_hours: 1,
        participants: [
          { user_id: 7, role: 'provider', hours: 1, weight: 1 },
          { user_id: 8, role: 'receiver', hours: 0, weight: 1 },
        ],
      }, 'mobile-group-exchange-create-123');
    });
  });

  it('creates a custom exchange with the hours earned as the total', async () => {
    const screen = render(<NewGroupExchangeRoute />);
    fireEvent.changeText(screen.getByPlaceholderText('e.g. Community garden workday'), 'Odd jobs');
    fireEvent.press(kindRadio(screen, "Type each person's hours"));
    expect(screen.queryByPlaceholderText('e.g. 6')).toBeNull();
    await addTwoPeople(screen);
    fireEvent.changeText(screen.getAllByPlaceholderText('0')[0], '3');
    fireEvent.changeText(screen.getAllByPlaceholderText('0')[1], '3');
    await settle();
    fireEvent.press(screen.getByText('Create exchange'));

    await waitFor(() => {
      expect(mockCreateGroupExchange).toHaveBeenCalledWith({
        title: 'Odd jobs',
        description: null,
        split_type: 'custom',
        total_hours: 3,
        participants: [
          { user_id: 7, role: 'provider', hours: 3, weight: 1 },
          { user_id: 8, role: 'receiver', hours: 3, weight: 1 },
        ],
      }, 'mobile-group-exchange-create-123');
    });
  });

  it('never calls anyone a provider or a receiver', async () => {
    mockGetMembers.mockResolvedValue({ data: [member(7, 'Mary Byrne'), member(8, 'Tom Doyle')] });
    const screen = render(<NewGroupExchangeRoute />);
    fireEvent.press(screen.getByText('Giving time'));
    fireEvent.changeText(screen.getByPlaceholderText('Search by name or skill'), 'garden');
    fireEvent.press(screen.getByText('Search members'));
    await screen.findByText('Mary Byrne');
    fireEvent.press(screen.getAllByText('Add to giving time')[0]);
    fireEvent.press(screen.getAllByText('Add to receiving time')[0]);

    const words = /provider|receiver|transfer/i;
    for (const title of kindTitles) {
      fireEvent.press(kindRadio(screen, title));
      expect(screen.queryAllByText(words)).toHaveLength(0);
      expect(screen.queryAllByLabelText(words)).toHaveLength(0);
    }
    expect(screen.getByText('Giving time (2)')).toBeTruthy();
    expect(screen.getByText('Receiving time (1)')).toBeTruthy();
  });

  // The member directory deliberately never returns the viewer, so an organiser who is
  // also delivering the activity (a workshop leader, say) could not add themselves.
  it('lets the organiser add themselves as giving time, then hides the offer', async () => {
    const screen = render(<NewGroupExchangeRoute />);

    expect(screen.getByText('Add yourself as')).toBeTruthy();
    fireEvent.press(screen.getByText('Giving time'));

    expect(screen.queryByText('Add yourself as')).toBeNull();
    expect(screen.getByText('Olive Organiser')).toBeTruthy();
    expect(screen.getByText('Giving time (1)')).toBeTruthy();
    // A workshop leader is added with the session length filled in.
    fireEvent.changeText(screen.getByPlaceholderText('e.g. 6'), '3');
    expect(screen.getAllByPlaceholderText('0').map(input => input.props.value)).toEqual(['3']);
  });

  it('brings the offer back when the organiser removes themselves', () => {
    const screen = render(<NewGroupExchangeRoute />);

    fireEvent.press(screen.getByText('Receiving time'));
    expect(screen.queryByText('Add yourself as')).toBeNull();
    fireEvent.press(screen.getByLabelText('Remove Olive Organiser'));
    expect(screen.getByText('Add yourself as')).toBeTruthy();
  });

  it('offers nothing when there is no signed-in user', () => {
    mockAuthUser = null;
    const screen = render(<NewGroupExchangeRoute />);

    expect(screen.queryByText('Add yourself as')).toBeNull();
  });
});
