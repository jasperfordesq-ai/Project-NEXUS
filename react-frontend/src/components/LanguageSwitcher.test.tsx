// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';

// ─── Mock api + helpers ───────────────────────────────────────────────────────
const { mockApi, mockTokenManager, mockSafeLocalStorageSet, mockLogError } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn().mockResolvedValue({}),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
  mockTokenManager: {
    hasAccessToken: vi.fn(() => false),
    getAccessToken: vi.fn(() => null),
    setTokens: vi.fn(),
    clearTokens: vi.fn(),
  },
  mockSafeLocalStorageSet: vi.fn(),
  mockLogError: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
  tokenManager: mockTokenManager,
}));

vi.mock('@/lib/logger', () => ({ logError: mockLogError }));
vi.mock('@/lib/safeStorage', () => ({ safeLocalStorageSet: mockSafeLocalStorageSet }));

// ─── Mock useTenantLanguages from TenantContext ───────────────────────────────
// LanguageSwitcher imports useTenantLanguages from '@/contexts/TenantContext' directly,
// so the override has to live on that direct path (a '@/contexts' barrel mock is dead).
const mockSupportedLanguages = vi.fn(() => ['en', 'ga', 'fr']);

vi.mock('@/contexts/TenantContext', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/contexts/TenantContext')>();
  return {
    ...orig,
    useTenantLanguages: () => mockSupportedLanguages(),
  };
});

// ─── react-i18next: real English copy, observable changeLanguage ───────────────
// src/test/setup.ts initialises the shared i18next singleton with the committed
// public/locales/en/*.json, so `t` is delegated to the real translator and the
// component renders production copy (e.g. common.json `aria.current_language`
// => "Language: English"). Two members are overridden:
//   - `changeLanguage` becomes a spy, so selection is observable without
//     mutating the shared i18next singleton other suites also use.
//   - `resolvedLanguage` is pinned to 'en'. That test instance leaves it
//     undefined, which would make the component's Intl.DisplayNames labels
//     resolve against the host machine's default locale ('Irish' on an English
//     box, 'irlandais' on a French one). Pinning it matches what production
//     reports for an English user and keeps the label assertions deterministic.
const mockChangeLanguage = vi.fn();

vi.mock('react-i18next', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-i18next')>();
  return {
    ...orig,
    useTranslation: ((...args: Parameters<typeof orig.useTranslation>) => {
      const real = orig.useTranslation(...args);
      const overrides: Record<string | symbol, unknown> = {
        changeLanguage: mockChangeLanguage,
        resolvedLanguage: 'en',
      };
      const i18n = new Proxy(real.i18n, {
        get: (target, prop) =>
          prop in overrides ? overrides[prop] : Reflect.get(target, prop, target),
      });

      return { ...real, i18n };
    }) as typeof orig.useTranslation,
  };
});

// ─────────────────────────────────────────────────────────────────────────────

type TestUser = ReturnType<typeof userEvent.setup>;

/**
 * The trigger's accessible name is real copy from common.json
 * (`aria.current_language` => "Language: {{language}}").
 */
const getTrigger = () => screen.getByRole('button', { name: /^Language:/ });

/**
 * The real HeroUI v3 Dropdown is a compound component: it portals its popover
 * and does not mount any menu item until the trigger is pressed. Items are
 * `role="menuitemradio"` because the menu uses selectionMode="single".
 */
async function openLanguageMenu(user: TestUser) {
  await user.click(getTrigger());

  const menu = screen.getByRole('menu');
  // HeroUI's Menu also sets aria-labelledby to the trigger, and per the accname
  // spec that wins over aria-label, so the authored label (real copy from
  // common.json `aria.select_language`) is asserted as an attribute.
  expect(menu).toHaveAttribute('aria-label', 'Select language');

  return menu;
}

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockTokenManager.hasAccessToken.mockReturnValue(false);
    mockSupportedLanguages.mockReturnValue(['en', 'ga', 'fr']);
    mockApi.put.mockResolvedValue({});
  });

  it('renders a trigger button with the current language code', async () => {
    const { LanguageSwitcher } = await import('./LanguageSwitcher');
    render(<LanguageSwitcher />);

    // Compact mode (default) shows only the short code, and the menu is not
    // mounted until pressed, so exactly one 'EN' exists — in the trigger.
    expect(screen.getByText('EN')).toBeInTheDocument();
    expect(getTrigger()).toHaveAccessibleName('Language: English');
  });

  it('renders language options for all tenant-supported languages', async () => {
    const user = userEvent.setup();
    const { LanguageSwitcher } = await import('./LanguageSwitcher');
    render(<LanguageSwitcher />);

    const menu = await openLanguageMenu(user);

    // The 3 supported languages, and only those 3, are offered as menu options.
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(3);
    expect(within(menu).getByRole('menuitemradio', { name: /English/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitemradio', { name: /Irish/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitemradio', { name: /French/ })).toBeInTheDocument();
    // The active language is the checked radio option.
    expect(within(menu).getByRole('menuitemradio', { name: /English/ })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('does not render language options for unsupported languages', async () => {
    const user = userEvent.setup();
    const { LanguageSwitcher } = await import('./LanguageSwitcher');
    render(<LanguageSwitcher />);

    const menu = await openLanguageMenu(user);

    // Positive control: the real menu is open and populated with exactly the
    // three supported languages, so the absences below cannot pass vacuously.
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(3);
    // 'de' and 'es' are not in the tenant supported list.
    expect(within(menu).queryByRole('menuitemradio', { name: /German/ })).toBeNull();
    expect(within(menu).queryByRole('menuitemradio', { name: /Spanish/ })).toBeNull();
  });

  it('shows full language name in non-compact mode', async () => {
    const { LanguageSwitcher } = await import('./LanguageSwitcher');
    render(<LanguageSwitcher compact={false} />);

    const triggerBtn = getTrigger();
    // The trigger body shows 'English' not the 'EN' short code in non-compact mode.
    expect(triggerBtn.textContent).toContain('English');
    expect(triggerBtn.textContent).not.toContain('EN');
  });

  it('calls i18n.changeLanguage when a language option is clicked', async () => {
    const user = userEvent.setup();
    const { LanguageSwitcher } = await import('./LanguageSwitcher');
    render(<LanguageSwitcher />);

    const menu = await openLanguageMenu(user);
    await user.click(within(menu).getByRole('menuitemradio', { name: /Irish/ }));

    expect(mockChangeLanguage).toHaveBeenCalledWith('ga');
  });

  it('persists language preference to localStorage on selection', async () => {
    const user = userEvent.setup();
    const { LanguageSwitcher } = await import('./LanguageSwitcher');
    render(<LanguageSwitcher />);

    const menu = await openLanguageMenu(user);
    await user.click(within(menu).getByRole('menuitemradio', { name: /French/ }));

    expect(mockSafeLocalStorageSet).toHaveBeenCalledWith('nexus_language_user_chosen', 'true');
  });

  it('does NOT call api.put when user is not authenticated', async () => {
    const user = userEvent.setup();
    mockTokenManager.hasAccessToken.mockReturnValue(false);

    const { LanguageSwitcher } = await import('./LanguageSwitcher');
    render(<LanguageSwitcher />);

    const menu = await openLanguageMenu(user);
    await user.click(within(menu).getByRole('menuitemradio', { name: /Irish/ }));

    // Positive control: the selection genuinely fired, so the negative
    // assertion below is about auth gating and not about a dead click.
    expect(mockChangeLanguage).toHaveBeenCalledWith('ga');
    expect(mockApi.put).not.toHaveBeenCalled();
  });

  it('calls api.put to persist language when user is authenticated', async () => {
    const user = userEvent.setup();
    mockTokenManager.hasAccessToken.mockReturnValue(true);

    const { LanguageSwitcher } = await import('./LanguageSwitcher');
    render(<LanguageSwitcher />);

    const menu = await openLanguageMenu(user);
    await user.click(within(menu).getByRole('menuitemradio', { name: /French/ }));

    expect(mockApi.put).toHaveBeenCalledWith(
      '/v2/users/me/language',
      { language: 'fr' }
    );
  });

  it('renders the trigger button with globe aria-label', async () => {
    const { LanguageSwitcher } = await import('./LanguageSwitcher');
    render(<LanguageSwitcher />);

    const triggerBtn = getTrigger();
    // Real copy from public/locales/en/common.json: "Language: {{language}}".
    expect(triggerBtn).toHaveAccessibleName('Language: English');
    // The globe is decorative, so the aria-label above is the button's entire
    // accessible name. Lucide icons expose no role or text by design, so the
    // icon class is the only handle on the glyph itself.
    const globe = triggerBtn.querySelector('svg.lucide-globe');
    expect(globe).not.toBeNull();
    expect(globe).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders only tenant-supported languages when the list is a single language', async () => {
    mockSupportedLanguages.mockReturnValue(['de']);
    const user = userEvent.setup();
    const { LanguageSwitcher } = await import('./LanguageSwitcher');
    render(<LanguageSwitcher />);

    // 'en' is not supported here, so the trigger falls back to the only option.
    expect(getTrigger()).toHaveAccessibleName('Language: German');

    const menu = await openLanguageMenu(user);
    const options = within(menu).getAllByRole('menuitemradio');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveAccessibleName(/German/);
    expect(within(menu).queryByRole('menuitemradio', { name: /English/ })).toBeNull();
    expect(within(menu).queryByRole('menuitemradio', { name: /French/ })).toBeNull();
  });

  it('displays language labels (full name) in dropdown items', async () => {
    const user = userEvent.setup();
    const { LanguageSwitcher } = await import('./LanguageSwitcher');
    render(<LanguageSwitcher />);

    const menu = await openLanguageMenu(user);

    // Each item pairs the short code with the full display name that
    // Intl.DisplayNames resolves in the active locale ('en').
    const expected = [
      ['EN', 'English'],
      ['GA', 'Irish'],
      ['FR', 'French'],
    ] as const;

    for (const [short, full] of expected) {
      const option = within(menu).getByRole('menuitemradio', { name: new RegExp(full) });
      expect(within(option).getByText(short)).toBeInTheDocument();
      expect(within(option).getByText(full)).toBeInTheDocument();
    }
  });
});
