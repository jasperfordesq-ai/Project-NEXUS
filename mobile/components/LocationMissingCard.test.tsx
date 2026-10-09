// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The reminder for a member who has no location. Owner decision (9 October 2026): it can
 * never be hidden — there is no "Not now" and nothing is stored — and it is shown only when
 * the server says `location_missing === true` for a member who has finished onboarding.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import LocationMissingCard from './LocationMissingCard';
import { ApiResponseError } from '@/lib/api/client';

const mockRefreshUser = jest.fn();
const mockUpdateProfile = jest.fn();
let mockUser: Record<string, unknown> | null = null;

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser, refreshUser: mockRefreshUser }),
}));
jest.mock('@/lib/hooks/useTenant', () => ({ usePrimaryColor: () => '#006FEE' }));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ text: '#111', textSecondary: '#555', borderSubtle: '#eee', border: '#ddd' }),
}));
jest.mock('@/lib/storage', () => ({ storage: { setJson: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('@/lib/api/profile', () => ({
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
}));

const member = (extra: Record<string, unknown> = {}) => ({
  id: 7,
  first_name: 'Alex',
  onboarding_completed: true,
  location_missing: true,
  ...extra,
});

describe('LocationMissingCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = member();
    mockUpdateProfile.mockResolvedValue({ data: member({ location: 'Cork', location_missing: false }) });
  });

  it('asks a member with no location where they are based', () => {
    render(<LocationMissingCard />);
    expect(screen.getByTestId('location-missing-card')).toBeTruthy();
    expect(screen.getByText('Tell us where you are based')).toBeTruthy();
    expect(screen.getByLabelText('Where are you based?')).toBeTruthy();
  });

  it('can never be put away: there is no dismiss control', () => {
    render(<LocationMissingCard />);
    expect(screen.queryByText('Not now')).toBeNull();
    expect(screen.queryByTestId('location-missing-dismiss')).toBeNull();
  });

  it.each([
    ['no user', null],
    ['onboarding unfinished', member({ onboarding_completed: false })],
    ['location_missing false', member({ location_missing: false })],
    // The slim login object has no such field: absent must NEVER read as "missing".
    ['location_missing absent (fresh login)', member({ location_missing: undefined })],
    ['location_missing null', member({ location_missing: null })],
  ])('shows nothing for %s', (_label, user) => {
    mockUser = user as Record<string, unknown> | null;
    render(<LocationMissingCard />);
    expect(screen.queryByTestId('location-missing-card')).toBeNull();
  });

  it('will not save a blank or spaces-only place', async () => {
    render(<LocationMissingCard />);
    fireEvent.changeText(screen.getByTestId('location-missing-input'), '   ');
    fireEvent.press(screen.getByTestId('location-missing-save'));
    expect(mockUpdateProfile).not.toHaveBeenCalled();
    expect(await screen.findByText('Please enter your town or city.')).toBeTruthy();
  });

  it('saves the trimmed place, then refreshes the member so the card goes away', async () => {
    render(<LocationMissingCard />);
    fireEvent.changeText(screen.getByTestId('location-missing-input'), '  Cork  ');
    fireEvent.press(screen.getByTestId('location-missing-save'));

    await waitFor(() => expect(mockUpdateProfile).toHaveBeenCalledWith({ location: 'Cork' }));
    await waitFor(() => expect(mockRefreshUser).toHaveBeenCalledTimes(1));
    expect(mockRefreshUser).toHaveBeenCalledWith(expect.objectContaining({ location: 'Cork', location_missing: false }));
  });

  it('treats a save response that does not repeat the flag as saved', async () => {
    mockUpdateProfile.mockResolvedValueOnce({ data: { id: 7, onboarding_completed: true, location: 'Cork' } });
    render(<LocationMissingCard />);
    fireEvent.changeText(screen.getByTestId('location-missing-input'), 'Cork');
    fireEvent.press(screen.getByTestId('location-missing-save'));
    await waitFor(() => expect(mockRefreshUser).toHaveBeenCalledWith(expect.objectContaining({ location_missing: false })));
  });

  it('shows our own translated message for a 422 on the location field, never the server English', async () => {
    mockUpdateProfile.mockRejectedValueOnce(
      new ApiResponseError(422, 'The location may not be greater than 255 characters.', undefined, 'VALIDATION', 'location'),
    );
    render(<LocationMissingCard />);
    fireEvent.changeText(screen.getByTestId('location-missing-input'), 'x'.repeat(300));
    fireEvent.press(screen.getByTestId('location-missing-save'));

    expect(await screen.findByText('We could not save that place. Please check it and try again.')).toBeTruthy();
    expect(screen.queryByText(/may not be greater/)).toBeNull();
    expect(mockRefreshUser).not.toHaveBeenCalled();
    // Still there, still asking.
    expect(screen.getByTestId('location-missing-card')).toBeTruthy();
  });

  it('shows a generic translated message when saving fails for any other reason', async () => {
    mockUpdateProfile.mockRejectedValueOnce(new Error('network'));
    render(<LocationMissingCard />);
    fireEvent.changeText(screen.getByTestId('location-missing-input'), 'Cork');
    fireEvent.press(screen.getByTestId('location-missing-save'));
    expect(await screen.findByText('We could not save your location. Please try again.')).toBeTruthy();
    expect(mockRefreshUser).not.toHaveBeenCalled();
  });

  it('ignores a second press while the first save is in flight', async () => {
    let finish!: (value: unknown) => void;
    mockUpdateProfile.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<LocationMissingCard />);
    fireEvent.changeText(screen.getByTestId('location-missing-input'), 'Cork');
    await act(async () => {
      fireEvent.press(screen.getByTestId('location-missing-save'));
      fireEvent.press(screen.getByTestId('location-missing-save'));
    });
    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    await act(async () => finish({ data: member({ location_missing: false }) }));
  });

  it('names the input and the button for screen readers', () => {
    render(<LocationMissingCard />);
    expect(screen.getByTestId('location-missing-input').props.accessibilityLabel).toBe('Where are you based?');
    expect(screen.getByTestId('location-missing-save').props.accessibilityLabel).toBe('Save');
  });
});
