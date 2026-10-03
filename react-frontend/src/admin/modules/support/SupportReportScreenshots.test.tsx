// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { SupportReportScreenshots } from './SupportReportScreenshots';

const mocks = vi.hoisted(() => ({ download: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { download: (...args: unknown[]) => mocks.download(...args) },
}));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

const shot = (id: number, inJira = false) => ({
  id, mime: 'image/png', size_bytes: 100, width: 1280, height: 720, original_name: null, in_jira: inJira,
});

describe('SupportReportScreenshots (HELP-11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches each screenshot through the admin endpoint and shows it', async () => {
    mocks.download.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));

    render(<SupportReportScreenshots reportId={7} screenshots={[shot(11, true), shot(12)]} />);

    expect(screen.getByText('Screenshots (2)')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2));
    expect(mocks.download).toHaveBeenCalledWith('/v2/admin/support-reports/7/screenshots/11');
    expect(mocks.download).toHaveBeenCalledWith('/v2/admin/support-reports/7/screenshots/12');
    expect(screen.getByRole('img', { name: 'Screenshot 1' })).toBeInTheDocument();
    expect(screen.getAllByText('In Jira')).toHaveLength(1);
  });

  it('says so when a screenshot cannot be loaded', async () => {
    mocks.download.mockRejectedValue(new Error('404'));

    render(<SupportReportScreenshots reportId={7} screenshots={[shot(11)]} />);

    expect(await screen.findByText('This screenshot could not be loaded.')).toBeInTheDocument();
  });
});
