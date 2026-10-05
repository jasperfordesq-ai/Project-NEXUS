// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for QualificationsTab (spec §8: render, groups, counts, add-form
 * validation, edit-clears-confirmation notice, withdraw, error + retry, empty).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { fireEvent, render, screen, waitFor, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import en from '../../../public/locales/en/volunteering.json';

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  }),
);

// The real English strings, flattened to `qualifications.*`, so a key the
// component asks for that the JSON lacks shows up as the raw key in the DOM.
function flatten(value: unknown, prefix: string, out: Record<string, string>): Record<string, string> {
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) flatten(v, `${prefix}${k}.`, out);
  } else if (typeof value === 'string') {
    out[prefix.slice(0, -1)] = value;
  }
  return out;
}
const translations: Record<string, string> = {
  ...flatten(en.qualifications, 'qualifications.', {}),
  try_again: en.try_again,
};
const stableT = (key: string, fallbackOrOpts?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
  const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : translations[key] ?? key;
  const vars = typeof fallbackOrOpts === 'object' ? fallbackOrOpts : opts;
  return fallback.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars?.[k] ?? ''));
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: stableT, i18n: { language: 'en' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
  Trans: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: { items: [], counts: {}, reminder_window_days: 30, types: [] } }),
    post: vi.fn().mockResolvedValue({ success: true }),
    put: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {description && <div>{description}</div>}
      {action}
    </div>
  ),
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { QualificationsTab, type Qualification } from './QualificationsTab';
import { api } from '@/lib/api';

const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const TYPES = [
  { code: 'first_aid', label_key: 'qualifications.types.first_aid', expiry_hint_years: 3 },
  { code: 'safeguarding_training', label_key: 'qualifications.types.safeguarding_training', expiry_hint_years: 3 },
  { code: 'food_hygiene', label_key: 'qualifications.types.food_hygiene', expiry_hint_years: 3 },
  { code: 'driving_licence', label_key: 'qualifications.types.driving_licence', expiry_hint_years: null },
  { code: 'other', label_key: 'qualifications.types.other', expiry_hint_years: null },
];

function makeQualification(overrides: Partial<Qualification> & { id: number }): Qualification {
  return {
    user_id: 42,
    qualification_type: 'first_aid',
    title: null,
    issuer: null,
    reference_number: null,
    obtained_at: null,
    expires_at: null,
    status: 'recorded',
    is_expiring: false,
    days_until_expiry: null,
    confirmed_by: null,
    confirmed_at: null,
    confirmation_method: null,
    confirmed_for_organization: null,
    withdrawn_at: null,
    withdrawal_reason: null,
    notes: null,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
    ...overrides,
  };
}

const confirmedFirstAid = makeQualification({
  id: 1,
  qualification_type: 'first_aid',
  issuer: 'Red Cross',
  reference_number: 'FA-123',
  obtained_at: inDays(-500),
  expires_at: inDays(200),
  status: 'confirmed',
  days_until_expiry: 200,
  confirmed_by: { id: 7, name: 'Jane Doe' },
  confirmed_at: '2026-10-03T10:00:00Z',
  confirmation_method: 'saw_original',
  confirmed_for_organization: { id: 3, name: 'Riverside Garden Trust' },
});

const expiringSafeguarding = makeQualification({
  id: 2,
  qualification_type: 'safeguarding_training',
  expires_at: inDays(10),
  status: 'recorded',
  is_expiring: true,
  days_until_expiry: 10,
});

const expiredFoodHygiene = makeQualification({
  id: 3,
  qualification_type: 'food_hygiene',
  expires_at: inDays(-5),
  status: 'expired',
  days_until_expiry: -5,
});

const recordedOther = makeQualification({
  id: 4,
  qualification_type: 'other',
  title: 'Chainsaw certificate',
  status: 'recorded',
});

const withdrawnDriving = makeQualification({
  id: 5,
  qualification_type: 'driving_licence',
  status: 'withdrawn',
  withdrawn_at: '2026-09-20T10:00:00Z',
  withdrawal_reason: 'replaced',
});

const ALL = [confirmedFirstAid, expiringSafeguarding, expiredFoodHygiene, recordedOther, withdrawnDriving];

function mockLoad(items: Qualification[], counts?: Partial<Record<'confirmed' | 'recorded' | 'expiring' | 'expired', number>>) {
  const derived = {
    confirmed: items.filter((q) => q.status === 'confirmed' && !q.is_expiring).length,
    recorded: items.filter((q) => q.status === 'recorded' && !q.is_expiring).length,
    expiring: items.filter((q) => q.is_expiring && q.status !== 'withdrawn').length,
    expired: items.filter((q) => q.status === 'expired').length,
    ...counts,
  };
  vi.mocked(api.get).mockResolvedValue({
    success: true,
    data: { items, counts: derived, reminder_window_days: 30, types: TYPES },
  });
}

/** Opens the HeroUI Select in the dialog and picks the option with this label. */
async function pickType(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, label: string) {
  await user.click(within(dialog).getByRole('button', { name: /Choose a qualification/ }));
  const option = await waitFor(() => {
    const el = Array.from(document.body.querySelectorAll('[role="option"]')).find(
      (n) => n.textContent?.trim() === label,
    );
    if (!el) throw new Error(`${label} option not found`);
    return el as HTMLElement;
  });
  await user.click(option);
}

describe('QualificationsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoad([]);
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { id: 99 } });
    vi.mocked(api.put).mockResolvedValue({ success: true, data: { id: 1 } });
  });

  it('renders the heading, actions and the intro card with the show-or-send line and vetting link', async () => {
    render(<QualificationsTab />);
    expect(screen.getByRole('heading', { level: 2, name: 'Qualifications' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add qualification' })).toBeInTheDocument();

    expect(screen.getByText(/Nothing is uploaded or stored here/)).toBeInTheDocument();
    expect(screen.getByText(/show them the original, or email or post a copy/)).toBeInTheDocument();
    expect(screen.getByText(/Police checks .* are handled separately/)).toBeInTheDocument();
    const vetting = screen.getByRole('link', { name: 'My vetting status' });
    expect(vetting).toHaveAttribute('href', '/test/settings?tab=safeguarding');

    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
  });

  it('shows a loading status while the first load is in flight', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<QualificationsTab />);
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });

  it('shows the empty state with an Add button when nothing is recorded yet', async () => {
    render(<QualificationsTab />);
    const empty = await screen.findByTestId('empty-state');
    expect(within(empty).getByText('No qualifications recorded yet')).toBeInTheDocument();
    expect(within(empty).getByRole('button', { name: 'Add qualification' })).toBeInTheDocument();
    // No attention alert with nothing to attend to.
    expect(screen.queryByText(/need attention/)).not.toBeInTheDocument();
  });

  it('groups records into needs attention, awaiting confirmation, confirmed and a collapsed withdrawn list', async () => {
    mockLoad(ALL);
    const user = userEvent.setup();
    render(<QualificationsTab />);
    await screen.findByRole('region', { name: 'Needs attention' });

    const attention = screen.getByRole('region', { name: 'Needs attention' });
    expect(within(attention).getByText('Safeguarding training')).toBeInTheDocument();
    expect(within(attention).getByText('Food hygiene')).toBeInTheDocument();
    expect(within(attention).getByText('Expiring soon', { selector: '*' })).toBeInTheDocument();
    expect(within(attention).getByText(/^Expired /)).toBeInTheDocument();

    const recorded = screen.getByRole('region', { name: 'Awaiting confirmation' });
    expect(within(recorded).getByText('Other')).toBeInTheDocument();
    expect(within(recorded).getByText('Chainsaw certificate')).toBeInTheDocument();
    expect(within(recorded).getByText('No expiry date')).toBeInTheDocument();

    const confirmed = screen.getByRole('region', { name: 'Confirmed' });
    expect(within(confirmed).getByText('First aid')).toBeInTheDocument();
    expect(within(confirmed).getByText('Red Cross')).toBeInTheDocument();
    expect(within(confirmed).getByText('Ref. FA-123')).toBeInTheDocument();
    expect(within(confirmed).getByText(/^Expires /)).toBeInTheDocument();
    expect(
      within(confirmed).getByText(/Confirmed by Jane Doe for Riverside Garden Trust on .* · saw the original/),
    ).toBeInTheDocument();

    // Withdrawn records are behind a disclosure, not in any of the live groups.
    expect(screen.queryByRole('region', { name: /Withdrawn/ })).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Show withdrawn (1)' });
    await user.click(toggle);
    await waitFor(() => expect(screen.getByText('Driving licence')).toBeInTheDocument());
    expect(screen.getByText(/^Withdrawn /)).toBeInTheDocument();
    // Withdrawn rows offer no Edit / Withdraw.
    const withdrawnRow = screen.getByText('Driving licence').closest('div.p-4') as HTMLElement;
    expect(within(withdrawnRow).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('shows the four counts from the API, the reminder window and an attention alert', async () => {
    mockLoad(ALL);
    render(<QualificationsTab />);
    await screen.findByRole('region', { name: 'Needs attention' });

    const confirmedTile = screen.getByText('Confirmed', { selector: 'p' }).parentElement!;
    expect(within(confirmedTile).getByText('1')).toBeInTheDocument();
    const recordedTile = screen.getByText('Awaiting confirmation', { selector: 'p' }).parentElement!;
    expect(within(recordedTile).getByText('1')).toBeInTheDocument();
    const expiringTile = screen.getByText('Expiring soon', { selector: 'p' }).parentElement!;
    expect(within(expiringTile).getByText('1')).toBeInTheDocument();
    expect(within(expiringTile).getByText('Within 30 days')).toBeInTheDocument();
    const expiredTile = screen.getByText('Expired', { selector: 'p' }).parentElement!;
    expect(within(expiredTile).getByText('1')).toBeInTheDocument();

    // expiring + expired
    expect(screen.getByText('2 need attention')).toBeInTheDocument();
    expect(screen.getByText(/Update the expiry date once you have renewed/)).toBeInTheDocument();
  });

  it('adds a qualification: title required for "other", then posts the body', async () => {
    mockLoad([recordedOther]);
    const user = userEvent.setup();
    render(<QualificationsTab />);
    await screen.findByText('Chainsaw certificate');

    await user.click(screen.getByRole('button', { name: 'Add qualification' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Add qualification', { selector: 'header, header *, h2, h3' })).toBeInTheDocument();

    // Nothing chosen yet: cannot save.
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();

    await pickType(user, dialog, 'Other');
    // Title is mandatory for "other" and the label says so.
    expect(within(dialog).getByLabelText(/^Name/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Give the qualification a name.')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(/^Name/), 'Chainsaw refresher');
    await user.type(within(dialog).getByLabelText(/Issuer or provider/), 'Lantra');
    fireEvent.change(within(dialog).getByLabelText('Date obtained'), { target: { value: '2026-01-10' } });
    fireEvent.change(within(dialog).getByLabelText('Expiry date'), { target: { value: '2029-01-10' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/v2/volunteering/qualifications', {
        qualification_type: 'other',
        title: 'Chainsaw refresher',
        issuer: 'Lantra',
        reference_number: null,
        obtained_at: '2026-01-10',
        expires_at: '2029-01-10',
        notes: null,
      }),
    );
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Qualification saved.'));
    // Reloaded after saving.
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('refuses an expiry date before the date obtained without calling the API', async () => {
    mockLoad([recordedOther]);
    const user = userEvent.setup();
    render(<QualificationsTab />);
    await screen.findByText('Chainsaw certificate');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Date obtained'), { target: { value: '2026-05-01' } });
    fireEvent.change(within(dialog).getByLabelText('Expiry date'), { target: { value: '2026-01-01' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByText('The expiry date is before the date obtained.')).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('warns that editing a confirmed record clears its confirmation, and PUTs to the record', async () => {
    mockLoad([confirmedFirstAid, recordedOther]);
    const user = userEvent.setup();
    render(<QualificationsTab />);
    await screen.findByText('Red Cross');

    // The recorded one carries no warning.
    const recorded = screen.getByRole('region', { name: 'Awaiting confirmation' });
    await user.click(within(recorded).getByRole('button', { name: 'Edit' }));
    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Edit qualification', { selector: 'header, header *, h2, h3' })).toBeInTheDocument();
    expect(within(dialog).queryByText(/removes its confirmation/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // The confirmed one does, and shows the expiry hint for its type.
    const confirmed = screen.getByRole('region', { name: 'Confirmed' });
    await user.click(within(confirmed).getByRole('button', { name: 'Edit' }));
    dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/removes its confirmation; the organisation will need to confirm it again/)).toBeInTheDocument();
    expect(within(dialog).getByText('Usually valid for 3 years')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Issuer or provider/)).toHaveValue('Red Cross');

    await user.clear(within(dialog).getByLabelText(/Certificate or registration number/));
    await user.type(within(dialog).getByLabelText(/Certificate or registration number/), 'FA-456');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        '/v2/volunteering/qualifications/1',
        expect.objectContaining({ qualification_type: 'first_aid', issuer: 'Red Cross', reference_number: 'FA-456' }),
      ),
    );
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Qualification saved.'));
  });

  it('maps the server 422 codes to the right messages', async () => {
    mockLoad([recordedOther]);
    vi.mocked(api.put).mockResolvedValueOnce({ success: false, code: 'VETTING_NOT_A_QUALIFICATION', error: 'nope' });
    const user = userEvent.setup();
    render(<QualificationsTab />);
    await screen.findByText('Chainsaw certificate');

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/Police checks are not recorded here/)).toBeInTheDocument();
    expect(mockToast.success).not.toHaveBeenCalled();

    vi.mocked(api.put).mockResolvedValueOnce({ success: false, code: 'TITLE_REQUIRED_FOR_OTHER' });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Give the qualification a name.')).toBeInTheDocument();

    vi.mocked(api.put).mockResolvedValueOnce({ success: false, code: 'UNSUPPORTED_QUALIFICATION_TYPE' });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/not available in this community/)).toBeInTheDocument();
  });

  it('withdraws a record with the chosen reason', async () => {
    mockLoad([recordedOther]);
    const user = userEvent.setup();
    render(<QualificationsTab />);
    await screen.findByText('Chainsaw certificate');

    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Withdraw qualification')).toBeInTheDocument();
    expect(within(dialog).getByText(/stays in your history/)).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'I no longer want this shown' })).toBeChecked();

    await user.click(within(dialog).getByRole('radio', { name: 'I no longer hold it' }));
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/v2/volunteering/qualifications/4/withdraw', { reason: 'no_longer_held' }),
    );
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Qualification withdrawn.'));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('shows an error with Try again when the load fails, and retries', async () => {
    let calls = 0;
    vi.mocked(api.get).mockImplementation(() => {
      calls++;
      return calls <= 1
        ? Promise.reject(new Error('fail'))
        : Promise.resolve({ success: true, data: { items: [], counts: {}, reminder_window_days: 30, types: TYPES } });
    });
    const user = userEvent.setup();
    render(<QualificationsTab />);
    await screen.findByText('Unable to load your qualifications.');
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: translations.try_again }));
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2));
    await screen.findByTestId('empty-state');
  });

  it('shows the error state (not the empty state) when a load returns success:false', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false, error: 'boom', code: 'SERVER_ERROR' });
    render(<QualificationsTab />);
    await screen.findByText('Unable to load your qualifications.');
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
  });
});
