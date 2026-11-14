// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import { ConfirmDialogProvider } from '@/components/ui';
import type { CommunitySetupStatus } from '../../../api/adminApi';

const api = vi.hoisted(() => ({
  setup: vi.fn(),
  updateFounded: vi.fn(),
  getSettings: vi.fn(),
  saveHeaderColors: vi.fn(),
  updateSeoSettings: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
const refreshTenant = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../../../api/adminApi', () => ({
  adminCommunitySetup: { get: api.setup, updateFounded: api.updateFounded },
  adminSettings: {
    get: api.getSettings,
    saveHeaderColors: api.saveHeaderColors,
    updateSeoSettings: api.updateSeoSettings,
  },
}));

vi.mock('@/contexts', () => createMockContexts({
  useToast: () => toast,
  useTenant: () => ({
    tenant: { id: 106, name: 'Riverside Timebank', slug: 'riverside' },
    branding: { name: 'Riverside Timebank', logo: null, logoDark: null, communityPhoto: null },
    tenantPath: (p: string) => `/riverside${p}`,
    refreshTenant,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  }),
}));

import { MakeItYoursPage } from './MakeItYoursPage';

function status(overrides: Partial<CommunitySetupStatus> = {}): CommunitySetupStatus {
  return {
    steps: [
      { key: 'logo', done: true },
      { key: 'colour', done: false },
      { key: 'photo', done: false },
      { key: 'tagline', done: true },
      { key: 'themes', done: false },
      { key: 'notice', done: false },
    ],
    done: 2,
    total: 6,
    colour: null,
    look: null,
    colour_strength: 'soft',
    tagline: 'Neighbours helping neighbours',
    themes: { total: 12, with_picture: 3 },
    suggested_colours: ['#a3195b', '#0f766e'],
    founded_on: null,
    ...overrides,
  };
}

/** What GET /v2/admin/settings answers for a community that has chosen no colour. */
const SETTINGS = { tenant: { name: 'Riverside Timebank' }, settings: {} };

/** The page asks before leaving with unsaved changes, so it needs the app's confirm dialog. */
function page() {
  return (
    <ConfirmDialogProvider>
      <MakeItYoursPage />
    </ConfirmDialogProvider>
  );
}

async function renderPage() {
  render(page());
  await screen.findByTestId('setup-progress');
}

describe('MakeItYoursPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.setup.mockResolvedValue({ success: true, data: status() });
    api.getSettings.mockResolvedValue({ success: true, data: SETTINGS });
    api.saveHeaderColors.mockResolvedValue({ success: true, data: {} });
    api.updateSeoSettings.mockResolvedValue({ success: true, data: { success: true } });
    api.updateFounded.mockResolvedValue({ success: true, data: { founded_on: '2015-06-01' } });
  });

  // ---- The founded date (warmth phase 6, D4): optional, not a seventh step ----

  it('offers the founded date as an optional extra, not a step, and fills in a saved one', async () => {
    api.setup.mockResolvedValue({ success: true, data: status({ founded_on: '2015-06-01' }) });
    await renderPage();

    expect(screen.getAllByTestId(/^setup-step-/)).toHaveLength(6);
    expect(screen.getByText('2 of 6 done')).toBeInTheDocument();
    const section = screen.getByTestId('setup-founded');
    expect(within(section).getByText('Optional')).toBeInTheDocument();
    expect(within(section).getByLabelText('Founded on')).toHaveValue('2015-06-01');
    expect(within(section).queryByText(/\{\{/)).toBeNull();
  });

  it('saves a founded date through its own endpoint and reads the page again', async () => {
    await renderPage();
    const section = screen.getByTestId('setup-founded');
    const save = within(section).getByRole('button', { name: 'Save date' });
    expect(save).toBeDisabled();
    expect(within(section).queryByRole('button', { name: 'Remove date' })).toBeNull();

    fireEvent.change(within(section).getByLabelText('Founded on'), { target: { value: '2015-06-01' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(api.updateFounded).toHaveBeenCalledWith('2015-06-01'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Founded date saved'));
    await waitFor(() => expect(api.setup.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('will not send a date in the future, and says why', async () => {
    await renderPage();
    const section = screen.getByTestId('setup-founded');
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

    fireEvent.change(within(section).getByLabelText('Founded on'), { target: { value: tomorrow } });

    expect(within(section).getByRole('button', { name: 'Save date' })).toBeDisabled();
    expect(within(section).getByText('Choose a real date from 1900 to today.')).toBeInTheDocument();
    expect(api.updateFounded).not.toHaveBeenCalled();
  });

  it('removes a saved founded date', async () => {
    api.setup.mockResolvedValue({ success: true, data: status({ founded_on: '2015-06-01' }) });
    api.updateFounded.mockResolvedValue({ success: true, data: { founded_on: null } });
    await renderPage();

    fireEvent.click(within(screen.getByTestId('setup-founded')).getByRole('button', { name: 'Remove date' }));

    await waitFor(() => expect(api.updateFounded).toHaveBeenCalledWith(null));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Founded date removed'));
  });

  it('shows the reason when the founded date is refused, and does not claim it saved', async () => {
    api.updateFounded.mockResolvedValue({ success: false, error: 'Choose a real date from 1900 to today.' });
    await renderPage();
    const section = screen.getByTestId('setup-founded');

    fireEvent.change(within(section).getByLabelText('Founded on'), { target: { value: '2015-06-01' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Save date' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Choose a real date from 1900 to today.'));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('walks the six steps in order and says how many are done', async () => {
    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Make it yours' })).toBeInTheDocument();
    expect(screen.getByText('2 of 6 done')).toBeInTheDocument();

    const steps = screen.getAllByTestId(/^setup-step-/);
    expect(steps.map((el) => el.getAttribute('data-testid'))).toEqual([
      'setup-step-logo',
      'setup-step-colour',
      'setup-step-photo',
      'setup-step-tagline',
      'setup-step-themes',
      'setup-step-notice',
    ]);
    expect(within(steps[0]!).getByText('Step 1 of 6')).toBeInTheDocument();
    expect(within(steps[5]!).getByText('Step 6 of 6')).toBeInTheDocument();
  });

  it('marks each step done or to do from the server answer, in words as well as colour', async () => {
    await renderPage();

    expect(screen.getByTestId('setup-step-logo')).toHaveAttribute('data-done', 'true');
    expect(within(screen.getByTestId('setup-step-logo')).getByText('Done')).toBeInTheDocument();
    expect(screen.getByTestId('setup-step-colour')).toHaveAttribute('data-done', 'false');
    expect(within(screen.getByTestId('setup-step-colour')).getByText('To do')).toBeInTheDocument();

    // The list at the top jumps to each step and reads its state aloud.
    const jump = within(screen.getByTestId('setup-progress-step-photo')).getByRole('link');
    expect(jump).toHaveAttribute('href', '#make-it-yours-photo');
    expect(jump).toHaveTextContent('Add a community photo');
    expect(jump).toHaveTextContent('To do');
    expect(document.getElementById('make-it-yours-photo')).not.toBeNull();
  });

  it('offers the colours taken from the logo, and saves the one the admin picks', async () => {
    await renderPage();

    const fromLogo = screen.getByTestId('community-colour-from-logo');
    expect(within(fromLogo).getByText('From your logo')).toBeInTheDocument();
    const swatches = within(fromLogo).getAllByRole('option');
    expect(swatches).toHaveLength(2);

    // No save bar until there is a colour choice to save.
    expect(screen.queryByRole('button', { name: 'Save colour' })).toBeNull();

    // Nothing is saved until the admin asks.
    fireEvent.click(swatches[1]!);
    expect(api.saveHeaderColors).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Save colour' }));

    await waitFor(() => expect(api.saveHeaderColors).toHaveBeenCalledTimes(1));
    // (accessible header bg, accessible header accent, community colour, look, strength)
    expect(api.saveHeaderColors).toHaveBeenCalledWith(null, null, '#0f766e', null, 'soft');
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Colour saved'));
    // Quietly: the full-screen loading state would remount this page.
    expect(refreshTenant).toHaveBeenCalledWith({ silent: true });
    // The steps are read again so the tick can appear.
    await waitFor(() => expect(api.setup.mock.calls.length).toBeGreaterThanOrEqual(2));
    // ...and the page stays put while they are: no falling back to the
    // loading placeholders, which would lose the admin's place.
    expect(screen.getByTestId('setup-progress')).toBeInTheDocument();
    expect(screen.queryByRole('status', { busy: true })).toBeNull();
  });

  // Moved here from the Settings page on 13 Nov 2026 (owner: one admin place
  // per setting). It is part of the colour step, not a seventh step.
  it("keeps the accessible site's header colour with the community colour, and saves both in one go", async () => {
    api.getSettings.mockResolvedValue({
      success: true,
      data: { tenant: { name: 'Riverside Timebank' }, settings: { community_color: '#0f766e' } },
    });
    await renderPage();

    expect(screen.getAllByTestId(/^setup-step-/)).toHaveLength(6);
    const step = screen.getByTestId('setup-step-colour');
    expect(within(step).getByRole('heading', { name: 'Accessible header colour' })).toBeInTheDocument();
    // With no header colour chosen, the preview's line is the community colour.
    const bar = within(step).getByTestId('header-colour-preview').firstElementChild as HTMLElement;
    expect(bar.style.borderBottom).toBe('8px solid rgb(15, 118, 110)');

    expect(screen.queryByRole('button', { name: 'Save colour' })).toBeNull();
    const hex = within(document.getElementById('settings-section-header-colours')!).getAllByRole('textbox')[0]!;
    fireEvent.change(hex, { target: { value: '#1d3557' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Save colour' }));

    await waitFor(() => expect(api.saveHeaderColors).toHaveBeenCalledTimes(1));
    // (accessible header bg, accessible header accent, community colour, look, strength)
    expect(api.saveHeaderColors).toHaveBeenCalledWith('#1d3557', null, '#0f766e', null, 'soft');
  });

  it('shows no "From your logo" row when the logo gave no colours', async () => {
    api.setup.mockResolvedValue({ success: true, data: status({ suggested_colours: [] }) });
    await renderPage();

    expect(screen.queryByTestId('community-colour-from-logo')).toBeNull();
  });

  it('says so when saving the colour is refused, and does not claim it saved', async () => {
    api.saveHeaderColors.mockResolvedValue({ success: false, error: 'That colour is too light to read.' });
    await renderPage();

    fireEvent.click(within(screen.getByTestId('community-colour-from-logo')).getAllByRole('option')[0]!);
    fireEvent.click(await screen.findByRole('button', { name: 'Save colour' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('That colour is too light to read.'));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('saves the tagline through the endpoint that owns it, trimmed, and only once it has changed', async () => {
    await renderPage();

    const box = screen.getByLabelText('Tagline');
    expect(box).toHaveValue('Neighbours helping neighbours');
    // The count is filled in, not shown as a raw placeholder.
    expect(screen.getByText('29 of 255 characters')).toBeInTheDocument();
    expect(screen.queryByText(/\{\{/)).toBeNull();
    const save = screen.getByRole('button', { name: 'Save tagline' });
    expect(save).toBeDisabled();

    fireEvent.change(box, { target: { value: '  Give an hour, get an hour  ' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(api.updateSeoSettings).toHaveBeenCalledWith({ tenant_tagline: 'Give an hour, get an hour' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Tagline saved'));
    expect(refreshTenant).toHaveBeenCalledWith({ silent: true });
  });

  it('says how many themes have a chosen picture and links to the screens that own themes and notices', async () => {
    await renderPage();

    expect(screen.getByTestId('setup-themes-count')).toHaveTextContent('You have chosen a picture for 3 of your 12 themes.');
    expect(screen.getByRole('link', { name: /choose theme pictures/i })).toHaveAttribute('href', '/riverside/admin/categories');
    expect(screen.getByRole('link', { name: /write a notice/i })).toHaveAttribute('href', '/riverside/admin/announcements');
  });

  it('tells a community with no themes to add some first', async () => {
    api.setup.mockResolvedValue({ success: true, data: status({ themes: { total: 0, with_picture: 0 } }) });
    await renderPage();

    expect(screen.getByTestId('setup-themes-count')).toHaveTextContent('You have no themes yet.');
  });

  it('congratulates a community that has done all six', async () => {
    api.setup.mockResolvedValue({
      success: true,
      data: status({ done: 6, steps: status().steps.map((s) => ({ ...s, done: true })) }),
    });
    await renderPage();

    expect(screen.getByText('6 of 6 done')).toBeInTheDocument();
    expect(screen.getByText('All six are done. Riverside Timebank now looks like itself.')).toBeInTheDocument();
  });

  it('says plainly when the steps could not be loaded, and shows none', async () => {
    api.setup.mockResolvedValue({ success: false, error: 'nope' });
    render(page());

    expect(await screen.findByText(/couldn't load your set-up steps/i)).toBeInTheDocument();
    expect(screen.queryByTestId('setup-progress')).toBeNull();
    expect(screen.queryAllByTestId(/^setup-step-/)).toHaveLength(0);
  });

  it('opens the member site in a new tab without handing it this window', async () => {
    await renderPage();

    const link = screen.getByRole('link', { name: /see your site/i });
    expect(link).toHaveAttribute('href', '/riverside/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});
