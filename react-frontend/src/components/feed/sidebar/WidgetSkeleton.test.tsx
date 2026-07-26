// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Mock contexts ────────────────────────────────────────────────────────────
vi.mock('@/contexts', () => createMockContexts());

// ─── NO barrel mock of '@/components/ui' ──────────────────────────────────────
// WidgetSkeleton imports GlassCard and Skeleton from their DIRECT module paths
// ('@/components/ui/GlassCard', '@/components/ui/Skeleton'). Vitest's mock registry
// is keyed per specifier, so an override on the '@/components/ui' barrel is dead
// here and the real components load. They render:
//   GlassCard -> <div class="card card--default glass-card p-4 …" data-slot="card">
//   Skeleton  -> <div class="skeleton skeleton--shimmer …">
// Every assertion below targets that real DOM.
const CARD = '.glass-card';
const SKELETON = '.skeleton';

// ─────────────────────────────────────────────────────────────────────────────
describe('WidgetSkeleton', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders a GlassCard wrapper', async () => {
    const { WidgetSkeleton } = await import('./WidgetSkeleton');
    const { container } = render(<WidgetSkeleton />);
    const card = container.querySelector(CARD);
    expect(card).not.toBeNull();
    // The widget's own padding reaches the card, and every skeleton is nested
    // INSIDE the card rather than rendered as a sibling of it.
    expect(card).toHaveClass('glass-card', 'p-4');
    expect(card!.querySelectorAll(SKELETON)).toHaveLength(10);
  });

  it('renders the default 3 row skeletons (header + 3 rows × 3 skeletons each = 10 total)', async () => {
    const { WidgetSkeleton } = await import('./WidgetSkeleton');
    const { container } = render(<WidgetSkeleton />);
    // 1 header + 3 rows × 3 skeletons (avatar, text-line-1, text-line-2) = 10
    expect(container.querySelectorAll(SKELETON)).toHaveLength(10);
  });

  it('renders the correct number of skeletons when lines=1', async () => {
    const { WidgetSkeleton } = await import('./WidgetSkeleton');
    const { container } = render(<WidgetSkeleton lines={1} />);
    // 1 header + 1 row × 3 skeletons = 4
    expect(container.querySelectorAll(SKELETON)).toHaveLength(4);
  });

  it('renders the correct number of skeletons when lines=5', async () => {
    const { WidgetSkeleton } = await import('./WidgetSkeleton');
    const { container } = render(<WidgetSkeleton lines={5} />);
    // 1 header + 5 rows × 3 skeletons = 16
    expect(container.querySelectorAll(SKELETON)).toHaveLength(16);
  });

  it('renders only 1 skeleton when lines=0', async () => {
    const { WidgetSkeleton } = await import('./WidgetSkeleton');
    const { container } = render(<WidgetSkeleton lines={0} />);
    // only the header skeleton remains
    const skeletons = container.querySelectorAll(SKELETON);
    expect(skeletons).toHaveLength(1);
    // …and it is the header skeleton, not a leftover row skeleton
    expect(skeletons[0]).toHaveClass('mb-4');
  });

  it('the header skeleton has rounded and margin class', async () => {
    const { WidgetSkeleton } = await import('./WidgetSkeleton');
    const { container } = render(<WidgetSkeleton />);
    const first = container.querySelectorAll(SKELETON)[0];
    expect(first.className).toMatch(/mb-4/);
    expect(first.className).toMatch(/\brounded\b/);
  });

  it('each row has an avatar skeleton with rounded-full class', async () => {
    const { WidgetSkeleton } = await import('./WidgetSkeleton');
    const { container } = render(<WidgetSkeleton lines={2} />);
    const skeletons = container.querySelectorAll(SKELETON);
    // skeletons[0]=header, [1]=row1-avatar, [2]=row1-text1, [3]=row1-text2, [4]=row2-avatar
    expect(skeletons).toHaveLength(7);
    expect(skeletons[1].className).toMatch(/rounded-full/);
    expect(skeletons[4].className).toMatch(/rounded-full/);
  });
});
