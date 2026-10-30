// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Owner, 30 Oct 2026: a page to store the platform's fallback Google Translate
 * key, used by every community that has not saved its own.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), download: vi.fn() },
}));
vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/contexts', () => createMockContexts({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() }),
}));

import PlatformTranslationKeyPage from './PlatformTranslationKeyPage';

describe('PlatformTranslationKeyPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: { platform_key_set: false, environment_key_set: false, effective: false } });
  });

  it('says when no platform key is saved', async () => {
    render(<PlatformTranslationKeyPage />);
    expect(await screen.findByText('No platform Google Translate key is saved. Communities without their own key cannot translate.')).toBeInTheDocument();
  });

  it('saves the platform key without showing it back', async () => {
    mockApi.put.mockResolvedValue({ success: true, data: { platform_key_set: true, environment_key_set: false, effective: true } });
    render(<PlatformTranslationKeyPage />);

    const input = await screen.findByLabelText('Platform Google Translate API key');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.change(input, { target: { value: 'AIzaPlatformKey0123456789abcdefghijkl' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }));

    await waitFor(() => expect(mockApi.put).toHaveBeenCalledWith('/v2/admin/super/translation/google-key', { api_key: 'AIzaPlatformKey0123456789abcdefghijkl' }));
    expect(await screen.findByText('A platform Google Translate key is saved and in use.')).toBeInTheDocument();
    expect(input).toHaveValue('');
  });
});
