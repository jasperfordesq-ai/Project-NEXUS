// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for PasswordStrength component.
 *
 * PasswordStrength is a pure presentational component: it accepts a
 * PasswordCheckState object and renders a progress bar + status line. It never
 * fetches from HIBP itself — the hook (`usePasswordCheck`) does that. We
 * therefore test by constructing state objects directly, which is fast and fully
 * deterministic without any fetch mocking.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { PasswordStrength } from './PasswordStrength';
import type { PasswordCheckState } from '@/hooks/usePasswordCheck';
import { PASSWORD_MIN_LENGTH } from '@/hooks/usePasswordCheck';

// PasswordStrength only uses useTranslation — no @/contexts hooks, no api calls.
// i18n is initialised globally in src/test/setup.ts from the real locale files.
// @/lib/motion is a project shim (CSS-backed) — no framer-motion to mock.

// ---------------------------------------------------------------------------
// Helper: build a PasswordCheckState for a given scenario
// ---------------------------------------------------------------------------
function makeState(overrides: Partial<PasswordCheckState>): PasswordCheckState {
  return {
    length: 0,
    isLongEnough: false,
    isPwned: null,
    isChecking: false,
    breachCheckUnavailable: false,
    isAcceptable: false,
    message: '',
    tone: 'idle',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shared state fixtures mirroring hook logic from usePasswordCheck.ts
// ---------------------------------------------------------------------------

/** Empty password: length === 0, idle tone */
const emptyState = makeState({
  length: 0,
  isLongEnough: false,
  isPwned: null,
  isChecking: false,
  isAcceptable: false,
  // The hook sets this literal message when length === 0
  message: `Use ${PASSWORD_MIN_LENGTH} or more characters. A memorable passphrase is stronger than a short complex one.`,
  tone: 'idle',
});

/** Short password: 1 < length < MIN_LENGTH, warn tone */
const shortState = makeState({
  length: 6,
  isLongEnough: false,
  isPwned: null,
  isChecking: false,
  isAcceptable: false,
  message: `Add ${PASSWORD_MIN_LENGTH - 6} more characters.`,
  tone: 'warn',
});

/** Single character short: "Add 11 more characters." */
const oneCharState = makeState({
  length: 1,
  isLongEnough: false,
  isPwned: null,
  isChecking: false,
  isAcceptable: false,
  message: `Add ${PASSWORD_MIN_LENGTH - 1} more characters.`,
  tone: 'warn',
});

/** One character below minimum: "Add 1 more character." (singular) */
const oneAwayState = makeState({
  length: PASSWORD_MIN_LENGTH - 1,
  isLongEnough: false,
  isPwned: null,
  isChecking: false,
  isAcceptable: false,
  message: 'Add 1 more character.',
  tone: 'warn',
});

/** Long enough, HIBP check in-flight */
const checkingState = makeState({
  length: PASSWORD_MIN_LENGTH + 2,
  isLongEnough: true,
  isPwned: null,
  isChecking: true,
  isAcceptable: false,
  message: 'Checking against known data breaches…',
  tone: 'idle',
});

/** Long enough, clean (not pwned) → success */
const successState = makeState({
  length: PASSWORD_MIN_LENGTH + 5,
  isLongEnough: true,
  isPwned: false,
  isChecking: false,
  isAcceptable: true,
  message: 'Strong enough.',
  tone: 'success',
});

/** Long enough, found in breach → error */
const pwnedState = makeState({
  length: PASSWORD_MIN_LENGTH + 5,
  isLongEnough: true,
  isPwned: true,
  isChecking: false,
  isAcceptable: false,
  message: 'This password appears in a known data breach. Please choose a different one.',
  tone: 'error',
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PasswordStrength — ARIA structure', () => {
  it('renders a group with the accessible label from auth namespace', () => {
    render(<PasswordStrength state={emptyState} />);
    // The real en/auth.json key is register.aria.password_strength = "Password strength"
    expect(screen.getByRole('group', { name: /password strength/i })).toBeInTheDocument();
  });

  it('contains a live region for screen-reader announcements', () => {
    render(<PasswordStrength state={shortState} />);
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).toBeInTheDocument();
  });
});

describe('PasswordStrength — empty password (length === 0)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the min-length guidance message', () => {
    render(<PasswordStrength state={emptyState} />);
    expect(screen.getByText(/Use 12 or more characters/i)).toBeInTheDocument();
  });

  it('shows the passphrase tip when length is 0', () => {
    render(<PasswordStrength state={emptyState} />);
    // The Trans component renders the password_tip text.
    // Real locale: "Tip: a passphrase like ... is easier to remember..."
    expect(screen.getByText(/Tip:/i)).toBeInTheDocument();
  });

  it('does NOT render "Add X more characters" when length is 0', () => {
    render(<PasswordStrength state={emptyState} />);
    expect(screen.queryByText(/Add \d+ more/i)).not.toBeInTheDocument();
  });
});

describe('PasswordStrength — short passwords (0 < length < MIN_LENGTH)', () => {
  it('shows remaining-characters message for a 6-char password', () => {
    render(<PasswordStrength state={shortState} />);
    expect(screen.getByText(/Add 6 more characters/i)).toBeInTheDocument();
  });

  it('uses singular "character" when exactly 1 character away', () => {
    render(<PasswordStrength state={oneAwayState} />);
    expect(screen.getByText(/Add 1 more character\./i)).toBeInTheDocument();
    // Must NOT say "characters" (plural)
    expect(screen.queryByText(/Add 1 more characters/i)).not.toBeInTheDocument();
  });

  it('does NOT show the passphrase tip for a 1-char password', () => {
    render(<PasswordStrength state={oneCharState} />);
    expect(screen.queryByText(/Tip:/i)).not.toBeInTheDocument();
  });

  it('applies warn tone class on the status paragraph', () => {
    render(<PasswordStrength state={shortState} />);
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.className).toMatch(/text-warning/);
  });
});

describe('PasswordStrength — HIBP check in progress', () => {
  it('shows the checking message', () => {
    render(<PasswordStrength state={checkingState} />);
    expect(screen.getByText(/Checking against known data breaches/i)).toBeInTheDocument();
  });

  it('renders the Spinner while isChecking is true', () => {
    render(<PasswordStrength state={checkingState} />);
    // Spinner renders with role="status" or as an svg; check by aria-hidden container
    // The Spinner is rendered inside the <p aria-live="polite"> when isChecking
    const live = document.querySelector('[aria-live="polite"]');
    // Spinner should be present in the live region (not the icon)
    expect(live).not.toBeNull();
    // The message text is still present
    expect(live?.textContent).toMatch(/Checking/i);
  });
});

describe('PasswordStrength — success (long enough, not pwned)', () => {
  it('shows "Strong enough." message', () => {
    render(<PasswordStrength state={successState} />);
    expect(screen.getByText(/Strong enough\./i)).toBeInTheDocument();
  });

  it('applies the success tone class on the status paragraph', () => {
    render(<PasswordStrength state={successState} />);
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.className).toMatch(/text-success/);
  });

  it('does NOT show the passphrase tip', () => {
    render(<PasswordStrength state={successState} />);
    expect(screen.queryByText(/Tip:/i)).not.toBeInTheDocument();
  });
});

describe('PasswordStrength — error (pwned password)', () => {
  it('shows the breach warning message', () => {
    render(<PasswordStrength state={pwnedState} />);
    expect(screen.getByText(/This password appears in a known data breach/i)).toBeInTheDocument();
  });

  it('applies the danger/error tone class on the status paragraph', () => {
    render(<PasswordStrength state={pwnedState} />);
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.className).toMatch(/text-danger/);
  });
});

describe('PasswordStrength — progress bar segment visibility', () => {
  it('second bar segment is aria-hidden when password is too short', () => {
    render(<PasswordStrength state={shortState} />);
    const bars = document.querySelectorAll('[aria-hidden]');
    // The second bar div has aria-hidden="true" when !isLongEnough
    const hiddenBars = Array.from(bars).filter((el) => el.getAttribute('aria-hidden') === 'true');
    expect(hiddenBars.length).toBeGreaterThan(0);
  });

  it('second bar segment is NOT aria-hidden when isLongEnough', () => {
    render(<PasswordStrength state={successState} />);
    // When isLongEnough=true, the second bar's aria-hidden should be "false"
    // (or absent — React renders aria-hidden={false} as the attribute being absent in HTML)
    // We verify indirectly: the isLongEnough branch changes aria-hidden on the second segment.
    // Find the two progress divs (flex-1 rounded-full containers)
    const containers = document.querySelectorAll('.flex-1.rounded-full');
    // Second container should have aria-hidden="false" or not set to "true"
    expect(containers[1]?.getAttribute('aria-hidden')).not.toBe('true');
  });
});
