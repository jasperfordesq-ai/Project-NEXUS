// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('ModuleStageBadge', () => {
  it('renders the translated "Beta" label', async () => {
    const { ModuleStageBadge } = await import('./ModuleStageBadge');
    render(<ModuleStageBadge stage="beta" />);
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('renders the translated "Alpha" label', async () => {
    const { ModuleStageBadge } = await import('./ModuleStageBadge');
    render(<ModuleStageBadge stage="alpha" />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
  });

  it('uses the stage name as the aria-label', async () => {
    const { ModuleStageBadge } = await import('./ModuleStageBadge');
    render(<ModuleStageBadge stage="beta" />);
    expect(screen.getByLabelText('Beta')).toBeInTheDocument();
  });

  it('applies extra className to the Chip', async () => {
    const { ModuleStageBadge } = await import('./ModuleStageBadge');
    const { container } = render(<ModuleStageBadge stage="beta" className="my-custom-class" />);
    expect(container.querySelector('.my-custom-class')).toBeInTheDocument();
  });

  it('renders with size "sm" by default (no size prop)', async () => {
    const { ModuleStageBadge } = await import('./ModuleStageBadge');
    render(<ModuleStageBadge stage="beta" />);
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('accepts size="md" without error and still renders the label', async () => {
    const { ModuleStageBadge } = await import('./ModuleStageBadge');
    render(<ModuleStageBadge stage="beta" size="md" />);
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });
});
