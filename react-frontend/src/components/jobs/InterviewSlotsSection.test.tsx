// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── API mock ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));

// ─── Contexts ────────────────────────────────────────────────────────────────
vi.mock('@/contexts', () => createMockContexts());

// ─────────────────────────────────────────────────────────────────────────────
describe('InterviewSlotsSection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ── Visibility guard ────────────────────────────────────────────────────
  it('renders nothing when isOwner=false and hasApplied=false', async () => {
    const { InterviewSlotsSection } = await import('./InterviewSlotsSection');
    render(<InterviewSlotsSection isOwner={false} hasApplied={false} />);
    // Component returns null — neither section id should exist in the DOM
    expect(document.getElementById('interview-slots-section')).toBeNull();
    expect(document.getElementById('interview-slots-candidate-section')).toBeNull();
    // No "Interview Slots" title rendered either
    expect(screen.queryByText('Interview Slots')).not.toBeInTheDocument();
  });

  // ── Owner view ──────────────────────────────────────────────────────────
  it('renders the owner view when isOwner=true', async () => {
    const { InterviewSlotsSection } = await import('./InterviewSlotsSection');
    render(<InterviewSlotsSection isOwner={true} hasApplied={false} />);
    expect(document.getElementById('interview-slots-section')).toBeInTheDocument();
  });

  // Warmth phase 5: the heading tile was a fixed cyan and blue.
  it('shows the heading tile in the community colour, for owner and candidate', async () => {
    const { InterviewSlotsSection } = await import('./InterviewSlotsSection');
    const { unmount } = render(<InterviewSlotsSection isOwner={true} hasApplied={false} />);
    for (const view of ['owner', 'candidate']) {
      const tile = screen.getByTestId('interview-slots-tile');
      expect(tile.className, view).toContain('from-accent/20');
      expect(tile.className, view).not.toMatch(/cyan-|blue-/);
      expect(tile.querySelector('svg')?.getAttribute('class'), view).toContain('text-accent');
      if (view === 'owner') {
        unmount();
        render(<InterviewSlotsSection isOwner={false} hasApplied={true} />);
      }
    }
  });

  it('shows the "Interview Slots" title in owner view', async () => {
    const { InterviewSlotsSection } = await import('./InterviewSlotsSection');
    render(<InterviewSlotsSection isOwner={true} hasApplied={false} />);
    expect(screen.getByText('Interview Slots')).toBeInTheDocument();
  });

  it('shows the employer placeholder copy in owner view', async () => {
    const { InterviewSlotsSection } = await import('./InterviewSlotsSection');
    render(<InterviewSlotsSection isOwner={true} hasApplied={false} />);
    expect(
      screen.getByText('Add interview slots so candidates can self-schedule')
    ).toBeInTheDocument();
  });

  it('shows manage slots + candidate pick copy in owner view', async () => {
    const { InterviewSlotsSection } = await import('./InterviewSlotsSection');
    render(<InterviewSlotsSection isOwner={true} hasApplied={false} />);
    expect(screen.getByText(/Manage Interview Slots/)).toBeInTheDocument();
    expect(screen.getByText(/Choose a time slot for your interview/)).toBeInTheDocument();
  });

  it('owner view uses the employer-facing section id', async () => {
    const { InterviewSlotsSection } = await import('./InterviewSlotsSection');
    render(<InterviewSlotsSection isOwner={true} hasApplied={false} />);
    expect(document.getElementById('interview-slots-section')).not.toBeNull();
    expect(document.getElementById('interview-slots-candidate-section')).toBeNull();
  });

  // ── Candidate (applicant) view ──────────────────────────────────────────
  it('renders the candidate view when isOwner=false and hasApplied=true', async () => {
    const { InterviewSlotsSection } = await import('./InterviewSlotsSection');
    render(<InterviewSlotsSection isOwner={false} hasApplied={true} />);
    expect(
      document.getElementById('interview-slots-candidate-section')
    ).toBeInTheDocument();
  });

  it('shows the title in candidate view', async () => {
    const { InterviewSlotsSection } = await import('./InterviewSlotsSection');
    render(<InterviewSlotsSection isOwner={false} hasApplied={true} />);
    expect(screen.getByText('Interview Slots')).toBeInTheDocument();
  });

  it('shows the candidate-pick copy in candidate view', async () => {
    const { InterviewSlotsSection } = await import('./InterviewSlotsSection');
    render(<InterviewSlotsSection isOwner={false} hasApplied={true} />);
    expect(
      screen.getByText('Choose a time slot for your interview')
    ).toBeInTheDocument();
  });

  it('candidate view does NOT show the employer placeholder copy', async () => {
    const { InterviewSlotsSection } = await import('./InterviewSlotsSection');
    render(<InterviewSlotsSection isOwner={false} hasApplied={true} />);
    expect(
      screen.queryByText('Add interview slots so candidates can self-schedule')
    ).not.toBeInTheDocument();
  });

  it('candidate view uses the candidate-facing section id', async () => {
    const { InterviewSlotsSection } = await import('./InterviewSlotsSection');
    render(<InterviewSlotsSection isOwner={false} hasApplied={true} />);
    expect(document.getElementById('interview-slots-candidate-section')).not.toBeNull();
    expect(document.getElementById('interview-slots-section')).toBeNull();
  });

  // ── Owner+applied edge case ─────────────────────────────────────────────
  it('renders owner view (not candidate view) when both isOwner and hasApplied are true', async () => {
    const { InterviewSlotsSection } = await import('./InterviewSlotsSection');
    render(<InterviewSlotsSection isOwner={true} hasApplied={true} />);
    // isOwner branch is checked first in the component
    expect(document.getElementById('interview-slots-section')).not.toBeNull();
    expect(document.getElementById('interview-slots-candidate-section')).toBeNull();
  });
});
