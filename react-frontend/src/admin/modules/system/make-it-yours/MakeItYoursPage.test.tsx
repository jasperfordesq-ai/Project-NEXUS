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

const useTenant = vi.hoisted(() => () => ({
  tenant: { id: 106, name: 'Riverside Timebank', slug: 'riverside' },
  branding: { name: 'Riverside Timebank', logo: null, logoDark: null, communityPhoto: null },
  tenantPath: (p: string) => `/riverside${p}`,
  refreshTenant,
  hasFeature: vi.fn(() => true),
  hasModule: vi.fn(() => true),
}));

vi.mock('@/contexts', () => createMockContexts({
  useToast: () => toast,
  useTenant,
}));
// Step 6 shows the real notice banner, whose file reads the community from
// this path rather than from '@/contexts'; both must answer the same.
vi.mock('@/contexts/TenantContext', () => ({ useTenant }));

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

  // ---- The shared goal (warmth phase 6, D1): optional, not a seventh step ----

  it('offers the shared goal as an optional extra that never moves the meter', async () => {
    api.setup.mockResolvedValue({
      success: true,
      data: status({
        community_goal: {
          id: 'b0a1c2d3e4f5', title: "Let's share 500 hours by spring", metric: 'hours', target: 500,
          starts_on: '2026-11-01', ends_on: '2099-03-31', current: 12, reached: false, finished: false,
        },
      }),
    });
    await renderPage();

    expect(screen.getAllByTestId(/^setup-step-/)).toHaveLength(6);
    expect(screen.getByText('2 of 6 done')).toBeInTheDocument();
    const section = screen.getByTestId('setup-goal');
    expect(within(section).getByText('Optional')).toBeInTheDocument();
    expect(within(section).getByLabelText('Name of the goal')).toHaveValue("Let's share 500 hours by spring");
    expect(section).toHaveTextContent('So far: 12 of 500');
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
    // (accessible header bg, accessible header accent, community colour, look, strength, light or dark to start)
    expect(api.saveHeaderColors).toHaveBeenCalledWith(null, null, '#0f766e', null, 'soft', 'light');
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
    // (accessible header bg, accessible header accent, community colour, look, strength, light or dark to start)
    expect(api.saveHeaderColors).toHaveBeenCalledWith('#1d3557', null, '#0f766e', null, 'soft', 'light');
  });

  // Light or dark to start with (15 Nov 2026): part of the colour step, not a
  // seventh step, and saved by the same call as the colours.
  it('lets the admin choose how the site starts for someone who has not chosen, and saves it with the colours', async () => {
    api.getSettings.mockResolvedValue({
      success: true,
      data: { tenant: { name: 'Riverside Timebank' }, settings: { community_color: '#0f766e' } },
    });
    await renderPage();

    expect(screen.getAllByTestId(/^setup-step-/)).toHaveLength(6);
    const step = screen.getByTestId('setup-step-colour');
    expect(within(step).getByRole('heading', { name: 'Light or dark to start with' })).toBeInTheDocument();
    // Light until an admin says otherwise, and nothing to save yet.
    expect(within(within(step).getByTestId('default-theme-light')).getByRole('radio')).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Save colour' })).toBeNull();

    fireEvent.click(within(within(step).getByTestId('default-theme-dark')).getByRole('radio'));
    expect(api.saveHeaderColors).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Save colour' }));

    await waitFor(() => expect(api.saveHeaderColors).toHaveBeenCalledTimes(1));
    expect(api.saveHeaderColors).toHaveBeenCalledWith(null, null, '#0f766e', null, 'soft', 'dark');
    // The site is read again, so the admin's own page follows the new start.
    await waitFor(() => expect(refreshTenant).toHaveBeenCalledWith({ silent: true }));
  });

  it('shows a community’s saved start, and does not count it as a step', async () => {
    api.getSettings.mockResolvedValue({
      success: true,
      data: { tenant: { name: 'Riverside Timebank' }, settings: { default_theme: 'system' } },
    });
    await renderPage();

    expect(within(screen.getByTestId('default-theme-system')).getByRole('radio')).toBeChecked();
    expect(screen.getByText('2 of 6 done')).toBeInTheDocument();
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

  // ---- Step 6: the notice that is on the site now, and where to take it down ----

  it('shows the notice that is on the site now, as members see it, with a way to change or remove it', async () => {
    api.setup.mockResolvedValue({
      success: true,
      data: status({
        notice: {
          total: 2,
          showing: {
            id: 41,
            message: 'Repair cafe this Saturday',
            style: 'celebration',
            link_url: '/events',
            link_label: 'See what is on',
            is_dismissible: true,
            starts_at: null,
            ends_at: null,
            updated_at: '2026-11-14T10:00:00+00:00',
          },
        },
      }),
    });
    await renderPage();

    const step = screen.getByTestId('setup-step-notice');
    expect(within(step).getByText('On your site now')).toBeInTheDocument();
    // The real banner, in the style the admin chose.
    const banner = within(step).getByTestId('site-announcement');
    expect(banner).toHaveAttribute('data-style', 'celebration');
    expect(banner).toHaveTextContent('Repair cafe this Saturday');
    expect(within(banner).getByRole('link', { name: 'See what is on' })).toHaveAttribute('href', '/riverside/events');
    // An admin looking at their own notice cannot close it from here.
    expect(within(banner).queryByRole('button')).toBeNull();
    // Says that removing it is for everyone, and where that is done.
    expect(within(step).getByText(/to take it down for everyone, delete it or switch it off/i)).toBeInTheDocument();
    expect(within(step).getByRole('link', { name: /change or remove it/i })).toHaveAttribute('href', '/riverside/admin/announcements');
    expect(within(step).queryByRole('link', { name: /write a notice/i })).toBeNull();
    expect(within(step).queryByText(/\{\{/)).toBeNull();
  });

  it('says so when notices are saved but none is on the site, and links to them', async () => {
    api.setup.mockResolvedValue({ success: true, data: status({ notice: { total: 3, showing: null } }) });
    await renderPage();

    const step = screen.getByTestId('setup-step-notice');
    expect(within(step).getByText(/no notice is on your site right now/i)).toBeInTheDocument();
    expect(within(step).queryByTestId('site-announcement')).toBeNull();
    expect(within(step).getByRole('link', { name: /see your notices/i })).toHaveAttribute('href', '/riverside/admin/announcements');
  });

  it('offers to write a notice when none is saved, even after the first was deleted', async () => {
    api.setup.mockResolvedValue({
      success: true,
      data: status({
        steps: status().steps.map((s) => (s.key === 'notice' ? { ...s, done: true } : s)),
        done: 3,
        notice: { total: 0, showing: null },
      }),
    });
    await renderPage();

    const step = screen.getByTestId('setup-step-notice');
    // Deleting the notice did not undo the step.
    expect(step).toHaveAttribute('data-done', 'true');
    expect(within(step).queryByText(/no notice is on your site right now/i)).toBeNull();
    expect(within(step).getByRole('link', { name: /write a notice/i })).toHaveAttribute('href', '/riverside/admin/announcements');
  });

  it('never shows a notice whose end time has already passed', async () => {
    api.setup.mockResolvedValue({
      success: true,
      data: status({
        notice: {
          total: 1,
          showing: { id: 7, message: 'Yesterday only', style: 'info', ends_at: '2020-01-01T00:00:00+00:00' },
        },
      }),
    });
    await renderPage();

    const step = screen.getByTestId('setup-step-notice');
    expect(within(step).queryByTestId('site-announcement')).toBeNull();
    expect(within(step).getByText(/no notice is on your site right now/i)).toBeInTheDocument();
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

  // ---- The app icon (warmth phase 6, A4): optional, not a seventh step ----

  it('offers the app icon as an optional extra that never moves the meter', async () => {
    await renderPage();

    expect(screen.getAllByTestId(/^setup-step-/)).toHaveLength(6);
    expect(screen.getByText('2 of 6 done')).toBeInTheDocument();
    const section = screen.getByTestId('setup-app-icon');
    expect(within(section).getByText('Optional')).toBeInTheDocument();
    expect(within(section).getByRole('heading', { name: 'App icon' })).toBeInTheDocument();
    expect(within(section).getByRole('button', { name: /upload image/i })).toBeInTheDocument();
  });
});
