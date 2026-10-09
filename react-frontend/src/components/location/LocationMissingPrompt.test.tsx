// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, userEvent } from '@/test/test-utils';

const { mockPut, toast, auth } = vi.hoisted(() => ({
  mockPut: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  auth: {
    user: null as Record<string, unknown> | null,
    refreshUser: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({
  api: { put: mockPut, get: vi.fn() },
  tokenManager: { getTenantId: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/contexts', () => ({
  useAuth: () => ({ user: auth.user, isAuthenticated: true, refreshUser: auth.refreshUser }),
  useToast: () => toast,
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
}));

// Stand-in for the real place search: a text box plus a "pick a place" button
// that reports the text first, then the place with its coordinates.
vi.mock('@/components/location/PlaceAutocompleteInput', () => ({
  PlaceAutocompleteInput: (props: {
    label?: React.ReactNode;
    placeholder?: string;
    value: string;
    onChange?: (v: string) => void;
    onPlaceSelect?: (p: { formattedAddress: string; lat: number; lng: number }) => void;
  }) => (
    <div>
      <input
        data-testid="place-input"
        aria-label={String(props.label)}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange?.(e.target.value)}
      />
      <button
        type="button"
        onClick={() => {
          props.onChange?.('Galway, Ireland');
          props.onPlaceSelect?.({ formattedAddress: 'Galway, Ireland', lat: 53.27, lng: -9.05 });
        }}
      >
        pick-place
      </button>
    </div>
  ),
}));

import { LocationMissingPrompt, shouldShowLocationReminder } from './LocationMissingPrompt';

function signInAs(extra: Record<string, unknown>) {
  auth.user = { id: 1, name: 'Test User', onboarding_completed: true, ...extra };
}

async function typeIntoLocation(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(screen.getByPlaceholderText('Your town or city'));
  const box = await screen.findByTestId('place-input');
  await user.type(box, text);
}

const saveButton = () => screen.getByRole('button', { name: 'Save' });

describe('LocationMissingPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.refreshUser.mockResolvedValue(undefined);
    mockPut.mockResolvedValue({ success: true, data: {} });
  });

  describe('when it is shown', () => {
    it.each([
      ['finished onboarding, server says no location', { onboarding_completed: true, location_missing: true }, true],
      ['has a location', { onboarding_completed: true, location_missing: false }, false],
      ['flag absent (not reported)', { onboarding_completed: true }, false],
      ['not onboarded yet, server says no location', { onboarding_completed: false, location_missing: true }, true],
      ['not onboarded yet, has a location', { onboarding_completed: false, location_missing: false }, false],
      ['not onboarded yet, flag absent', { onboarding_completed: false }, false],
    ])('%s', (_name, fields, expected) => {
      expect(shouldShowLocationReminder({ ...fields } as never)).toBe(expected);
    });

    it('shows nothing when there is no signed-in member', () => {
      expect(shouldShowLocationReminder(null)).toBe(false);
    });
  });

  it('asks a member with no location where they are based', () => {
    signInAs({ location_missing: true });
    render(<LocationMissingPrompt />);

    expect(screen.getByText('Tell us where you are based')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Your town or city')).toBeInTheDocument();
  });

  it('renders nothing for a member who has a location', () => {
    signInAs({ location_missing: false, location: 'Cork' });
    const { container } = render(<LocationMissingPrompt />);

    expect(screen.queryByText('Tell us where you are based')).not.toBeInTheDocument();
    expect(container.textContent).toBe('');
  });

  it('still asks a member who has not finished onboarding (their community may not force the wizard)', () => {
    signInAs({ onboarding_completed: false, location_missing: true });
    render(<LocationMissingPrompt />);

    expect(screen.getByText('Tell us where you are based')).toBeInTheDocument();
  });

  it('renders nothing for a member who has not finished onboarding but has a location', () => {
    signInAs({ onboarding_completed: false, location_missing: false, location: 'Cork' });
    const { container } = render(<LocationMissingPrompt />);

    expect(container.textContent).toBe('');
  });

  it('can never be hidden: there is no dismiss control and nothing is remembered', () => {
    signInAs({ location_missing: true });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(<LocationMissingPrompt />);

    expect(screen.queryByRole('button', { name: /dismiss|close|hide|not now|later|remind/i })).not.toBeInTheDocument();
    // Only the one Save button — nothing else on the card can be pressed.
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Save']);
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it('keeps Save disabled until there is a town', async () => {
    signInAs({ location_missing: true });
    const user = userEvent.setup();
    render(<LocationMissingPrompt />);

    expect(saveButton()).toBeDisabled();
    await typeIntoLocation(user, '   ');
    expect(saveButton()).toBeDisabled();
    await user.type(screen.getByTestId('place-input'), 'Galway');
    expect(saveButton()).toBeEnabled();
  });

  it('saves a picked place with its coordinates, then refreshes the member', async () => {
    signInAs({ location_missing: true });
    const user = userEvent.setup();
    render(<LocationMissingPrompt />);

    await user.click(screen.getByPlaceholderText('Your town or city'));
    await screen.findByTestId('place-input');
    await user.click(screen.getByText('pick-place'));
    await user.click(saveButton());

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith('/v2/users/me', {
        location: 'Galway, Ireland',
        latitude: 53.27,
        longitude: -9.05,
      });
    });
    await waitFor(() => expect(auth.refreshUser).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith('Location saved');
  });

  it('saves typed text on its own, with no coordinates', async () => {
    signInAs({ location_missing: true });
    const user = userEvent.setup();
    render(<LocationMissingPrompt />);

    await typeIntoLocation(user, ' Galway ');
    await user.click(saveButton());

    await waitFor(() => expect(mockPut).toHaveBeenCalled());
    expect(mockPut.mock.calls[0]![1]).toEqual({ location: 'Galway' });
  });

  it('disappears once the member has saved (the refreshed member has a location)', async () => {
    signInAs({ location_missing: true });
    const user = userEvent.setup();
    const { rerender } = render(<LocationMissingPrompt />);

    await typeIntoLocation(user, 'Galway');
    await user.click(saveButton());
    await waitFor(() => expect(auth.refreshUser).toHaveBeenCalled());

    // What refreshUser() does in the real app: the member now has a location.
    signInAs({ location_missing: false, location: 'Galway' });
    rerender(<LocationMissingPrompt />);

    expect(screen.queryByText('Tell us where you are based')).not.toBeInTheDocument();
  });

  it('shows our own message, not the server English, when the town is refused', async () => {
    signInAs({ location_missing: true });
    mockPut.mockResolvedValue({
      success: false,
      error: 'The location may not be greater than 255 characters.',
      errors: [{ field: 'location', message: 'The location may not be greater than 255 characters.' }],
    });
    const user = userEvent.setup();
    render(<LocationMissingPrompt />);

    await typeIntoLocation(user, 'Galway');
    await user.click(saveButton());

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith(
      'Location not saved',
      'We could not save that place. Please check it and try again.',
    );
    // Still showing, so the member can correct it.
    expect(screen.getByText('Tell us where you are based')).toBeInTheDocument();
    expect(auth.refreshUser).not.toHaveBeenCalled();
  });

  it('explains a refused map position in its own words', async () => {
    signInAs({ location_missing: true });
    mockPut.mockResolvedValue({
      success: false,
      error: 'The longitude must be between -180 and 180.',
      errors: [{ field: 'longitude', message: 'The longitude must be between -180 and 180.' }],
    });
    const user = userEvent.setup();
    render(<LocationMissingPrompt />);

    await typeIntoLocation(user, 'Galway');
    await user.click(saveButton());

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error.mock.calls[0]![1]).toMatch(/map position/);
  });

  it('falls back to a general message for any other failure', async () => {
    signInAs({ location_missing: true });
    mockPut.mockResolvedValue({ success: false, error: 'Server exploded' });
    const user = userEvent.setup();
    render(<LocationMissingPrompt />);

    await typeIntoLocation(user, 'Galway');
    await user.click(saveButton());

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith(
      'Location not saved',
      'We could not save your location. Please try again.',
    );
  });
});
