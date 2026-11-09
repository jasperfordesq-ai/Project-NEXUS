// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for EmptyState component
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { EmptyState } from './EmptyState';
import Search from 'lucide-react/icons/search';

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(
      <EmptyState
        icon={<Search data-testid="icon" />}
        title="No results"
        description="Try a different search"
      />
    );

    expect(screen.getByText('No results')).toBeInTheDocument();
    expect(screen.getByText('Try a different search')).toBeInTheDocument();
  });

  it('renders icon', () => {
    render(
      <EmptyState
        icon={<Search data-testid="empty-icon" />}
        title="No results"
      />
    );

    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
  });

  it('shows its icon in a soft circle in the community colour, whatever colour the page gave it', () => {
    // AWID feedback (Nov 2026): empty pages were a grey icon in a grey box.
    render(
      <EmptyState
        icon={<Search data-testid="empty-icon" className="w-12 h-12 text-theme-subtle" />}
        title="No results"
      />
    );

    const circle = screen.getByTestId('empty-state-icon');
    expect(circle).toContainElement(screen.getByTestId('empty-icon'));
    expect(circle.className).toContain('rounded-full');
    expect(circle.className).toContain('bg-accent-soft');
    // One size and the community colour for every caller's icon (the page's
    // own text-theme-* colour is unlayered, so the override must be important).
    expect(circle.className).toContain('[&_svg]:text-accent-soft-foreground!');
    expect(circle.className).toContain('[&_svg]:size-9');
  });

  it('writes its description in the readable secondary text colour', () => {
    render(<EmptyState title="No results" description="Try a different search" />);
    expect(screen.getByText('Try a different search').className).toContain('text-theme-secondary');
  });

  it('renders action button when provided', () => {
    render(
      <EmptyState
        icon={<Search />}
        title="No results"
        action={<button>Try again</button>}
      />
    );

    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('does not render description when not provided', () => {
    render(
      <EmptyState
        icon={<Search />}
        title="No results"
      />
    );

    expect(screen.getByText('No results')).toBeInTheDocument();
    // Should only have the title text
  });
});
