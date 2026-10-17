// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';
import { ConfirmDialogProvider } from '@/components/ui';
import type { LandingPageConfig } from '@/types/landing-page';

// ─── Mock adminApi ────────────────────────────────────────────────────────────
const { mockAdminLandingPage } = vi.hoisted(() => ({
  mockAdminLandingPage: { get: vi.fn(), update: vi.fn() },
}));

vi.mock('../../api/adminApi', () => ({ adminLandingPage: mockAdminLandingPage }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Mock contexts ────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    // The shared default has no `branding`, which the hero form reads for the
    // standard introduction, so this override widens the shape.
    useTenant: (() => ({
      tenant: { id: 2, name: 'Test Timebank', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      branding: { name: 'Test Timebank' },
      hasFeature: vi.fn((_key: string) => true),
      hasModule: vi.fn((_key: string) => true),
    })) as never,
  }),
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

// The preview renders the real public sections; here it only needs to prove it
// received the draft wording.
vi.mock('./landing-page-builder/SectionPreview', () => ({
  SectionPreview: ({ section }: { section: { id: string; content?: unknown } }) => (
    <div data-testid={`preview-${section.id}`}>{JSON.stringify(section.content ?? null)}</div>
  ),
  WholePagePreview: ({ sections }: { sections: { id: string; enabled: boolean }[] }) => (
    <div data-testid="preview-page">{sections.filter((s) => s.enabled).map((s) => s.id).join(',')}</div>
  ),
}));

// Stub Select/Switch to avoid HeroUI jsdom infinite-loop
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    Select: ({ label, children, onSelectionChange }: { label?: string; children?: React.ReactNode; onSelectionChange?: (keys: Set<string>) => void }) => (
      <select aria-label={label ?? 'select'} onChange={(e) => onSelectionChange?.(new Set([e.target.value]))}>
        {children}
      </select>
    ),
    SelectItem: ({ children, id }: { children?: React.ReactNode; id?: string }) => <option value={id ?? ''}>{children}</option>,
    Switch: ({
      children,
      isSelected,
      onValueChange,
      'aria-label': ariaLabel,
    }: {
      children?: React.ReactNode;
      isSelected?: boolean;
      onValueChange?: (v: boolean) => void;
      'aria-label'?: string;
    }) => (
      <input
        type="checkbox"
        aria-label={ariaLabel ?? (typeof children === 'string' ? children : 'switch')}
        checked={!!isSelected}
        onChange={(e) => onValueChange?.(e.target.checked)}
      />
    ),
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const customConfig = (): LandingPageConfig => ({
  sections: [
    { id: 'hero', type: 'hero', order: 1, enabled: true, content: { headline_1: 'Welcome', badge_text: 'New' } },
    { id: 'cta', type: 'cta', order: 2, enabled: false, content: { title: 'Join us' } },
    { id: 'stats', type: 'stats', order: 3, enabled: true, content: { show_live_stats: false } },
  ],
});

const respond = (config: LandingPageConfig | null) => ({ success: true, data: { config } });

async function renderBuilder() {
  const { LandingPageBuilder } = await import('./LandingPageBuilder');
  const utils = render(
    <ConfirmDialogProvider>
      <LandingPageBuilder />
    </ConfirmDialogProvider>,
  );
  await waitFor(() => {
    const busy = screen.queryAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeUndefined();
  });
  return utils;
}

const saveButton = () => screen.getByRole('button', { name: /save changes/i });
const outline = () => screen.getByRole('list', { name: 'Page order' });
const selectBlock = (name: string) => fireEvent.click(within(outline()).getByRole('button', { name }));
const lastSavedPayload = () => mockAdminLandingPage.update.mock.calls[mockAdminLandingPage.update.mock.calls.length - 1]?.[0] as LandingPageConfig | null;

// ─────────────────────────────────────────────────────────────────────────────
describe('LandingPageBuilder', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminLandingPage.get.mockResolvedValue(respond(null));
    mockAdminLandingPage.update.mockResolvedValue({ success: true });
  });

  it('shows a loading state while fetching', async () => {
    mockAdminLandingPage.get.mockImplementationOnce(() => new Promise(() => {}));
    const { LandingPageBuilder } = await import('./LandingPageBuilder');
    render(
      <ConfirmDialogProvider>
        <LandingPageBuilder />
      </ConfirmDialogProvider>,
    );
    const busy = screen.getAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('lists the seven blocks in plain English, selects the first, and explains the page', async () => {
    await renderBuilder();
    const names = ['Welcome banner', 'Start-here cards', 'Quick highlights', 'Live numbers', 'How it works', 'Our values', 'Final invitation'];
    for (const name of names) {
      expect(within(outline()).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('heading', { name: 'Wording for Welcome banner' })).toBeInTheDocument();
    expect(screen.getByText('How this page works')).toBeInTheDocument();
    expect(screen.getByText('7 of 7 blocks shown')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open the live page/i })).toHaveAttribute('target', '_blank');
    expect(saveButton()).toHaveAttribute('data-disabled');
  });

  it('selecting a block in the outline switches the editor to it', async () => {
    await renderBuilder();
    selectBlock('Final invitation');
    expect(screen.getByRole('heading', { name: 'Wording for Final invitation' })).toBeInTheDocument();
    expect(screen.getByTestId('preview-cta')).toBeInTheDocument();
  });

  it('shows the standard wording beside each box and sends only what was typed', async () => {
    await renderBuilder();
    const headline = screen.getByLabelText('Headline line 1');
    expect(headline).toHaveAttribute('placeholder', 'Exchange Skills,');
    expect(screen.getAllByText('Leave empty to keep: “Exchange Skills,”').length).toBeGreaterThan(0);

    fireEvent.change(headline, { target: { value: 'Share your time' } });
    expect(screen.getByTestId('preview-hero')).toHaveTextContent('Share your time');
    expect(saveButton()).not.toHaveAttribute('data-disabled');

    fireEvent.click(saveButton());
    await waitFor(() => expect(mockAdminLandingPage.update).toHaveBeenCalledTimes(1));
    const payload = lastSavedPayload()!;
    const hero = payload.sections.find((s) => s.id === 'hero')!;
    expect(hero.content).toEqual({ headline_1: 'Share your time' });
    expect(payload.sections.find((s) => s.id === 'cta')!.content).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('_key');
    expect(mockToast.success).toHaveBeenCalled();
    await waitFor(() => expect(saveButton()).toHaveAttribute('data-disabled'));
  });

  it('loads a saved page: customised chip, hidden chip, missing blocks come back hidden, stats folded to hidden', async () => {
    mockAdminLandingPage.get.mockResolvedValue(respond(customConfig()));
    await renderBuilder();
    // The saved page named three blocks; the four it never mentioned were not rendered, so they load as hidden.
    expect(screen.getByText('1 of 7 blocks shown')).toBeInTheDocument();
    expect(screen.getAllByText('Customised')).toHaveLength(2);
    const showSwitch = (name: string) => screen.getByRole('checkbox', { name: `Show ${name} on the page` });
    expect(showSwitch('Live numbers')).not.toBeChecked();
    expect(showSwitch('Final invitation')).not.toBeChecked();
    expect(showSwitch('Welcome banner')).toBeChecked();
    expect(screen.getByLabelText('Headline line 1')).toHaveValue('Welcome');
  });

  it('hiding a block and moving it down are saved as enabled/order changes', async () => {
    await renderBuilder();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Our values on the page' }));
    expect(screen.getByText('6 of 7 blocks shown')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Move Welcome banner down' }));

    fireEvent.click(saveButton());
    await waitFor(() => expect(mockAdminLandingPage.update).toHaveBeenCalledTimes(1));
    const payload = lastSavedPayload()!;
    const ordered = [...payload.sections].sort((a, b) => a.order - b.order).map((s) => s.id);
    expect(ordered.slice(0, 2)).toEqual(['audience_cards', 'hero']);
    expect(payload.sections.find((s) => s.id === 'core_values')!.enabled).toBe(false);
  });

  it('a list starts on the standard items; "Edit these items" copies them in; clearing a title blocks Save by name', async () => {
    await renderBuilder();
    selectBlock('Start-here cards');
    expect(screen.getByText('Standard items')).toBeInTheDocument();
    expect(screen.getByText('New here?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit these items' }));
    expect(screen.getByText('Card 1')).toBeInTheDocument();
    expect(screen.getByText('Card 3')).toBeInTheDocument();
    const titles = screen.getAllByLabelText('Title');
    expect(titles[0]).toHaveValue('New here?');

    fireEvent.change(titles[0]!, { target: { value: '' } });
    expect(screen.getAllByText('Card 1 in “Start-here cards” needs a title.').length).toBeGreaterThan(0);
    expect(saveButton()).toHaveAttribute('data-disabled');

    fireEvent.change(titles[0]!, { target: { value: 'Newcomers' } });
    expect(saveButton()).not.toHaveAttribute('data-disabled');
    fireEvent.click(saveButton());
    await waitFor(() => expect(mockAdminLandingPage.update).toHaveBeenCalledTimes(1));
    const cards = (lastSavedPayload()!.sections.find((s) => s.id === 'audience_cards')!.content as { cards: { title: string; icon?: string }[] }).cards;
    expect(cards).toHaveLength(3);
    expect(cards[0]).toMatchObject({ title: 'Newcomers', icon: 'user-plus', target_url: '/about' });
  });

  it('a button link that is not a path or web address blocks Save', async () => {
    await renderBuilder();
    selectBlock('Final invitation');
    fireEvent.change(screen.getByLabelText('Button link'), { target: { value: 'register' } });
    expect(saveButton()).toHaveAttribute('data-disabled');
    expect(screen.getAllByText('A button link in “Final invitation” must start with / or https://.').length).toBeGreaterThan(0);
  });

  it('going back to the standard wording for a block, then saving, sends null so the server deletes the row', async () => {
    mockAdminLandingPage.get.mockResolvedValue(
      respond({ sections: [{ id: 'hero', type: 'hero', order: 0, enabled: true, content: { headline_1: 'Welcome' } }] }),
    );
    await renderBuilder();
    // The older saved config lacked the other blocks; they come back hidden, so show them first.
    for (const name of ['Start-here cards', 'Quick highlights', 'Live numbers', 'How it works', 'Our values', 'Final invitation']) {
      fireEvent.click(screen.getByRole('checkbox', { name: `Show ${name} on the page` }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Go back to the standard wording for this block' }));
    expect(screen.getByLabelText('Headline line 1')).toHaveValue('');
    fireEvent.click(saveButton());
    await waitFor(() => expect(mockAdminLandingPage.update).toHaveBeenCalledWith(null));
  });

  it('"Start again" asks first, then resets the draft without saving', async () => {
    mockAdminLandingPage.get.mockResolvedValue(respond(customConfig()));
    await renderBuilder();
    fireEvent.click(screen.getByRole('button', { name: 'Start again from the standard page' }));
    const confirmBtn = await screen.findByRole('button', { name: 'Yes, start again' });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(screen.getByText('7 of 7 blocks shown')).toBeInTheDocument());
    expect(mockAdminLandingPage.update).not.toHaveBeenCalled();
    expect(saveButton()).not.toHaveAttribute('data-disabled');
    fireEvent.click(saveButton());
    await waitFor(() => expect(mockAdminLandingPage.update).toHaveBeenCalledWith(null));
  });

  it('Discard puts the saved page back', async () => {
    mockAdminLandingPage.get.mockResolvedValue(respond(customConfig()));
    await renderBuilder();
    fireEvent.change(screen.getByLabelText('Headline line 1'), { target: { value: 'Changed' } });
    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    expect(screen.getByLabelText('Headline line 1')).toHaveValue('Welcome');
    expect(saveButton()).toHaveAttribute('data-disabled');
  });

  it('reports a failed save and keeps the draft dirty', async () => {
    mockAdminLandingPage.update.mockResolvedValueOnce({ success: false });
    await renderBuilder();
    fireEvent.change(screen.getByLabelText('Headline line 1'), { target: { value: 'Oops' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(saveButton()).not.toHaveAttribute('data-disabled');
  });

  it('the whole-page preview lists only the shown blocks in order', async () => {
    mockAdminLandingPage.get.mockResolvedValue(respond(customConfig()));
    await renderBuilder();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show Our values on the page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Our values up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Whole page' }));
    expect(screen.getByTestId('preview-page')).toHaveTextContent(/^hero,core_values$/);
  });
});
