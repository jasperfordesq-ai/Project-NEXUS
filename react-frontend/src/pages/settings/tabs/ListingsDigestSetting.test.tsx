// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { render, screen, waitFor } from '@/test/test-utils';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ListingsDigestSetting } from './ListingsDigestSetting';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts?.frequency ? `${key}:${String(opts.frequency)}` : key),
    i18n: { changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const toast = { success: vi.fn(), error: vi.fn() };
vi.mock('@/contexts', () => ({
  useToast: () => toast,
}));

const apiGet = vi.fn();
const apiPut = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    put: (...args: unknown[]) => apiPut(...args),
  },
}));

describe('ListingsDigestSetting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the member choice and names the community default', async () => {
    apiGet.mockResolvedValue({
      success: true,
      data: { frequency: 'default', community_default: 'monthly', effective: 'monthly' },
    });

    render(<ListingsDigestSetting />);

    expect(await screen.findByText('listings_digest.label', { selector: 'p' })).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/v2/users/me/listings-digest');
    expect(screen.getAllByText('listings_digest.option_default:listings_digest.frequency_monthly').length).toBeGreaterThan(0);
  });

  it('renders nothing when the setting cannot be loaded', async () => {
    apiGet.mockRejectedValue(new Error('offline'));

    const { container } = render(<ListingsDigestSetting />);

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
