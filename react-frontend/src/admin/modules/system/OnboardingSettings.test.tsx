// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for OnboardingSettings admin component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';

// Mock API module
const mockGet = vi.fn();
const mockPut = vi.fn();
const mockPost = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockGet(...args),
    put: (...args: unknown[]) => mockPut(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

const stableToastValue = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const stableTenantValue = {
  tenant: { id: 2, name: 'Test Community', slug: 'test', branding: { name: 'Test Community' } },
  tenantPath: (p: string) => `/test${p}`,
  hasFeature: vi.fn(() => true),
  hasModule: vi.fn(() => true),
};

vi.mock('@/contexts', () => ({
  useToast: vi.fn(() => stableToastValue),
  useAuth: vi.fn(() => ({ user: { id: 1 }, isAuthenticated: true, refreshUser: vi.fn() })),
  useTenant: vi.fn(() => stableTenantValue),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
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
  useToast: vi.fn(() => stableToastValue),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// The component renders the real HeroUI Switch, which places its label text as
// a SIBLING of the checkbox input (not inside a wrapping <label>). The test
// locates a toggle via getByText('<its label>').closest('label')
//   .querySelector('input[type="checkbox"]'), which needs the label and the
// checkbox to share a <label> ancestor. Override ONLY Switch with a faithful
// stub that renders <label>{children}<input/></label> and forwards
// onValueChange(checked); everything else (Modal, useDisclosure, Button, Input,
// …) delegates to the REAL @/components/ui so the preset-modal tests, which
// depend on the real useDisclosure + Modal open/close behaviour, keep working.
vi.mock('@/components/ui', async () => {
  const React = await import('react');
  const actual = await vi.importActual<Record<string, unknown>>('@/components/ui');

  function SwitchStub(props: Record<string, unknown>) {
    const { isSelected, onValueChange, isDisabled, label, children, 'aria-label': ariaLabel } =
      props as {
        isSelected?: boolean;
        onValueChange?: (v: boolean) => void;
        isDisabled?: boolean;
        label?: React.ReactNode;
        children?: React.ReactNode;
        'aria-label'?: string;
      };
    return React.createElement(
      'label',
      null,
      React.createElement('input', {
        type: 'checkbox',
        checked: Boolean(isSelected),
        disabled: isDisabled || undefined,
        'aria-label': ariaLabel,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
          if (typeof onValueChange === 'function') onValueChange(e.target.checked);
        },
      }),
      (label ?? children) as React.ReactNode,
    );
  }

  return new Proxy(actual, {
    get(target, prop) {
      if (prop === 'Switch') return SwitchStub;
      return Reflect.get(target, prop);
    },
  });
});

// Mock the admin PageHeader component
vi.mock('../../components', () => ({
  PageHeader: ({ title, description }: { title: string; description: string }) => (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  ),
}));

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => <div>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));

import { OnboardingSettings } from './OnboardingSettings';

// ── Test data ─────────────────────────────────────────────────────────────────

const MOCK_CONFIG = {
  enabled: true,
  mandatory: false,
  step_welcome_enabled: true,
  step_profile_enabled: true,
  step_skills_enabled: true,
  step_safeguarding_enabled: true,
  step_safeguarding_required: false,
  step_security_enabled: true,
  avatar_required: true,
  bio_required: true,
  bio_min_length: 20,
  require_completion_for_visibility: false,
  require_avatar_for_visibility: false,
  require_bio_for_visibility: false,
  welcome_text: null,
  safeguarding_intro_text: null,
  country_preset: 'ireland',
};

const MOCK_SAFEGUARDING_OPTIONS = [
  {
    id: 1,
    option_key: 'is_vulnerable_adult',
    option_type: 'checkbox',
    label: 'I consider myself a vulnerable adult',
    description: 'A coordinator will help you.',
    is_active: true,
    is_required: false,
    triggers: null,
    preset_source: 'ireland',
  },
  {
    id: 2,
    option_key: 'requires_vetted_partners',
    option_type: 'checkbox',
    label: 'I prefer vetted members',
    description: null,
    is_active: true,
    is_required: false,
    triggers: null,
    preset_source: 'ireland',
  },
];

function loadWith(config: Record<string, unknown>, options: unknown[] = MOCK_SAFEGUARDING_OPTIONS) {
  mockGet.mockResolvedValue({
    success: true,
    data: { config: { ...MOCK_CONFIG, ...config }, safeguarding_options: options },
  });
}

/** The switch named `text` (its words sit beside it; the switch carries them as its name). */
function switchLabelled(text: string | RegExp): HTMLInputElement {
  return screen.getByRole('checkbox', { name: text }) as HTMLInputElement;
}

/** The "Shown" switch of one step row. */
function stepSwitch(step: string): HTMLInputElement | null {
  return document.querySelector(`[data-step="${step}"] > div:first-child input[type="checkbox"]`);
}

async function save() {
  const { userEvent } = await import('@/test/test-utils');
  const user = userEvent.setup();
  await user.click(screen.getByText('Save changes'));
  await waitFor(() => expect(mockPut).toHaveBeenCalled());
  return mockPut.mock.calls[0]?.[1] as Record<string, unknown>;
}

async function renderLoaded() {
  render(<OnboardingSettings />);
  await screen.findByText('Who goes through the welcome steps');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OnboardingSettings (Admin → Welcome steps)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadWith({});
    mockPut.mockResolvedValue({ success: true, data: {} });
    mockPost.mockResolvedValue({ success: true, data: { options_created: ['opt_1'], jurisdiction_warning: null } });
  });

  it('renders loading state initially', () => {
    mockGet.mockReturnValue(new Promise(() => {}));
    render(<OnboardingSettings />);

    const spinner = document.querySelector('[role="status"]') ||
                    document.querySelector('[role="progressbar"]') ||
                    document.querySelector('.animate-spinner-ease-spin');
    expect(spinner).toBeTruthy();
    expect(screen.queryByText('Who goes through the welcome steps')).toBeNull();
  });

  it('names the page and its five sections in plain words', async () => {
    await renderLoaded();

    expect(screen.getByRole('heading', { name: 'Welcome steps' })).toBeInTheDocument();
    expect(screen.getByText('The steps')).toBeInTheDocument();
    expect(screen.getByText('Who other members can see')).toBeInTheDocument();
    expect(screen.getByText('Safeguarding questions')).toBeInTheDocument();
    expect(screen.getByText('Your own welcome')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/config/onboarding');

    // The machine-made labels, and the ones that described the wrong thing.
    for (const gone of ['System', 'Module Control', 'Step Configuration', 'Visibility Gating', 'Legal Notice', 'Step Welcome']) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument();
    }
    // No raw wording key anywhere on the page.
    expect(screen.queryByText(/system\.onboarding\./)).not.toBeInTheDocument();
  });

  it('no longer shows the controls that did nothing', async () => {
    await renderLoaded();

    expect(screen.queryByText(/Help Text/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Required')).not.toBeInTheDocument();
    // One switch per step that can be left out; the last step has none.
    for (const step of ['welcome', 'profile', 'skills', 'safeguarding', 'security']) {
      expect(stepSwitch(step)).toBeTruthy();
    }
    expect(stepSwitch('confirm')).toBeNull();
    expect(screen.getByText('Always shown')).toBeInTheDocument();
  });

  // ── One choice instead of two switches ──────────────────────────────────

  describe('who goes through the welcome steps', () => {
    it.each([
      [{ enabled: true, mandatory: true }, 'Every new member'],
      [{ enabled: true, mandatory: false }, 'Anyone who wants to'],
      [{ enabled: false, mandatory: false }, 'Nobody – switched off'],
      // Stored by the old page: "off" with "must finish" left on. It is off.
      [{ enabled: false, mandatory: true }, 'Nobody – switched off'],
    ])('reads %j as "%s"', async (stored, label) => {
      loadWith(stored);
      await renderLoaded();

      expect(screen.getByRole('radio', { name: new RegExp(label) })).toBeChecked();
    });

    it('saves "switched off" with "must finish" off too, so no member is ever locked out', async () => {
      loadWith({ enabled: true, mandatory: true });
      await renderLoaded();

      fireEvent.click(screen.getByRole('radio', { name: /Nobody – switched off/ }));
      const sent = await save();

      expect(sent).toMatchObject({ enabled: false, mandatory: false });
    });

    it('saves "every new member" as on and compulsory', async () => {
      await renderLoaded();

      fireEvent.click(screen.getByRole('radio', { name: /Every new member/ }));
      const sent = await save();

      expect(sent).toMatchObject({ enabled: true, mandatory: true });
    });

    it('says plainly that the phone app does not follow this choice', async () => {
      await renderLoaded();

      expect(screen.getByText(/The phone app always takes new members through the welcome steps/)).toBeInTheDocument();
    });
  });

  // ── The steps ───────────────────────────────────────────────────────────

  it('saves a step switched off', async () => {
    await renderLoaded();

    const security = stepSwitch('security')!;
    expect(security.checked).toBe(true);
    expect(security).toHaveAccessibleName('Show the Protect your account step');
    fireEvent.click(security);
    const sent = await save();

    expect(sent).toMatchObject({ step_security_enabled: false });
    // The settings retired on 13 Nov 2026 are never sent.
    for (const retired of ['step_profile_required', 'step_skills_required', 'step_confirm_enabled', 'help_text']) {
      expect(sent).not.toHaveProperty(retired);
    }
  });

  it('keeps what the profile step asks for inside that step, and hides it when the step is off', async () => {
    await renderLoaded();

    expect(screen.getByText('Members must add a profile photo')).toBeInTheDocument();
    expect(screen.getByText('Members must write a few words about themselves')).toBeInTheDocument();

    fireEvent.click(stepSwitch('profile')!);

    expect(screen.queryByText('Members must add a profile photo')).not.toBeInTheDocument();
    expect(screen.queryByText('Members must write a few words about themselves')).not.toBeInTheDocument();
  });

  it('saves the photo and bio requirements', async () => {
    await renderLoaded();

    fireEvent.click(switchLabelled('Members must add a profile photo'));
    const sent = await save();

    expect(sent).toMatchObject({ avatar_required: false, bio_required: true });
  });

  it('saves the shortest "About you" allowed, and never less than one character', async () => {
    await renderLoaded();

    const input = screen.getByLabelText(/Shortest "About you" allowed/) as HTMLInputElement;
    expect(input.value).toBe('20');
    fireEvent.change(input, { target: { value: '0' } });
    const sent = await save();

    expect(sent).toMatchObject({ bio_min_length: 1 });
  });

  it('only asks for a minimum length while a bio is required', async () => {
    await renderLoaded();

    fireEvent.click(switchLabelled('Members must write a few words about themselves'));

    expect(screen.queryByLabelText(/Shortest "About you" allowed/)).not.toBeInTheDocument();
  });

  it('warns that the safeguarding step is shown to nobody while no question is switched on', async () => {
    loadWith({}, []);
    await renderLoaded();

    expect(screen.getByText('No questions are switched on yet, so this step is not shown to anyone.')).toBeInTheDocument();
  });

  // ── Who other members can see ───────────────────────────────────────────

  it('describes hiding members as hiding members', async () => {
    await renderLoaded();

    expect(screen.getByText('Hide members who have no profile photo')).toBeInTheDocument();
    expect(screen.getByText(/other members cannot open their profile/)).toBeInTheDocument();
    fireEvent.click(switchLabelled('Hide members who have not finished the welcome steps'));
    const sent = await save();

    expect(sent).toMatchObject({ require_completion_for_visibility: true });
  });

  it('will not hide unfinished members while the welcome steps are switched off', async () => {
    loadWith({ enabled: false, require_completion_for_visibility: true });
    await renderLoaded();

    const hide = switchLabelled('Hide members who have not finished the welcome steps');
    expect(hide).toBeDisabled();
    expect(hide.checked).toBe(false);
    expect(screen.getByText(/Not used while the welcome steps are switched off/)).toBeInTheDocument();
  });

  // ── A country's standard questions ──────────────────────────────────────

  it('lists the questions that are switched on', async () => {
    await renderLoaded();

    expect(screen.getByText('I consider myself a vulnerable adult')).toBeInTheDocument();
    expect(screen.getByText('I prefer vetted members')).toBeInTheDocument();
    expect(screen.getAllByText('Ireland').length).toBeGreaterThan(0);
  });

  it('says exactly what setting up a country will change before doing it', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Set up these questions' }));

    await screen.findByText('Set up the standard questions for Ireland?');
    expect(screen.getByText(/any you switched off are switched on again/)).toBeInTheDocument();
    expect(screen.getByText(/answers to them are withdrawn/)).toBeInTheDocument();
    expect(screen.getByText('Questions you wrote yourself are not changed.')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('sets up the country on confirm and reloads', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Set up these questions' }));
    await screen.findByText('Set up the standard questions for Ireland?');
    const buttons = screen.getAllByRole('button', { name: 'Set up these questions' });
    fireEvent.click(buttons[buttons.length - 1]!);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/v2/admin/config/onboarding/apply-preset', { preset: 'ireland' });
    });
    await waitFor(() => {
      expect(stableToastValue.success).toHaveBeenCalledWith(
        'Questions set up',
        'The standard questions for Ireland are in place.',
      );
    });
    expect(stableToastValue.warning).not.toHaveBeenCalled();
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  // The server keeps a safeguarding country that was already chosen and says
  // so. Until 13 Nov 2026 the page threw that warning away.
  it('shows the warning from the server when the safeguarding country is a different one', async () => {
    mockPost.mockResolvedValue({
      success: true,
      data: { options_created: [], jurisdiction_warning: 'Your safeguarding country is still England and Wales.' },
    });
    await renderLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'Set up these questions' }));
    await screen.findByText('Set up the standard questions for Ireland?');
    const buttons = screen.getAllByRole('button', { name: 'Set up these questions' });
    fireEvent.click(buttons[buttons.length - 1]!);

    await waitFor(() => {
      expect(stableToastValue.warning).toHaveBeenCalledWith(
        'Check your safeguarding country',
        'Your safeguarding country is still England and Wales.',
      );
    });
  });

  // ── The community's own words ───────────────────────────────────────────

  it('saves the welcome message and the safeguarding introduction', async () => {
    await renderLoaded();

    fireEvent.change(screen.getByLabelText('Welcome message'), { target: { value: 'We meet on Thursdays.' } });
    fireEvent.change(screen.getByLabelText('Your own introduction to the safeguarding step'), {
      target: { value: 'Our safeguarding lead is Maeve.' },
    });
    const sent = await save();

    expect(sent).toMatchObject({
      welcome_text: 'We meet on Thursdays.',
      safeguarding_intro_text: 'Our safeguarding lead is Maeve.',
    });
    expect(stableToastValue.success).toHaveBeenCalledWith('Saved', 'New members will see your changes from now on.');
  });
});
