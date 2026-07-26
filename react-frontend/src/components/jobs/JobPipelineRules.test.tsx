// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@/test/test-utils';
import { JobPipelineRules } from './JobPipelineRules';
import { api } from '@/lib/api';

// NOTE: JobPipelineRules imports Button/GlassCard/Input/Select from their DIRECT
// paths ('@/components/ui/Button', ...), so a '@/components/ui' barrel mock never
// applies and the real components load regardless. They render fine in jsdom, so
// this suite renders the real UI and real i18n ('src/test/setup.ts' initialises
// i18next with the committed English locale files). Do not reintroduce a barrel
// mock or a total 'react-i18next' mock here — the latter drops initReactI18next,
// which src/i18n.ts (reached via Select -> '@/lib/helpers') requires at import time.

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

describe('JobPipelineRules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders rules from the unwrapped API response', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [
        {
          id: 7,
          name: 'Move stale applications',
          trigger_stage: 'applied',
          condition_days: 5,
          action: 'move_stage',
          action_target: 'screening',
          is_active: true,
          last_run_at: null,
        },
      ],
    });

    const { container } = render(<JobPipelineRules jobId="42" />);

    // Real GlassCard puts the `glass-card` class on its root (GlassCard.tsx:47).
    expect(container.querySelector('.glass-card')).not.toBeNull();

    // Real i18n: jobs.json 'pipeline.rules_title' === 'Automation Rules'.
    await userEvent.click(screen.getByRole('button', { name: /automation rules/i }));

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/v2/jobs/42/pipeline-rules');
      expect(screen.getByText('Move stale applications')).toBeInTheDocument();
    });

    // Real 'pipeline.rule_summary_with_target' interpolation, resolved through the
    // real i18next instance rather than a stubbed t().
    expect(
      screen.getByText('If in "Applied" for 5d -> Move stage -> Screening')
    ).toBeInTheDocument();
  });
});
