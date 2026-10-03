// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';
import userEvent from '@testing-library/user-event';

// ─── Stub HeroUI Card/CardBody to avoid jsdom issues ────────────────────────
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div data-testid="card" className={className}>
        {children}
      </div>
    ),
    CardBody: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <div data-testid="card-body" className={className}>
        {children}
      </div>
    ),
    Button: ({
      children,
      onPress,
      className,
    }: {
      children: React.ReactNode;
      onPress?: () => void;
      className?: string;
    }) => (
      <button data-testid="action-button" onClick={onPress} className={className}>
        {children}
      </button>
    ),
  };
});

vi.mock('@/contexts', () => createMockContexts());
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// The broker empty state has its own tests; here only the hand-over matters.
vi.mock('@/broker/components/BrokerEmptyState', () => ({
  BrokerEmptyState: (props: { title: string; hint?: string; action?: React.ReactNode }) => (
    <div data-testid="broker-empty-state" data-title={props.title} data-hint={props.hint}>
      {props.action}
    </div>
  ),
}));

// ─────────────────────────────────────────────────────────────────────────────
describe('EmptyState (admin)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders the required title', async () => {
    const { EmptyState } = await import('./EmptyState');
    render(<EmptyState title="No records found" />);
    expect(screen.getByText('No records found')).toBeInTheDocument();
  });

  it('renders the title as an h3 heading', async () => {
    const { EmptyState } = await import('./EmptyState');
    render(<EmptyState title="Nothing here yet" />);
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Nothing here yet');
  });

  it('renders description text when provided', async () => {
    const { EmptyState } = await import('./EmptyState');
    render(<EmptyState title="Empty" description="Try adding a new item to get started." />);
    expect(screen.getByText('Try adding a new item to get started.')).toBeInTheDocument();
  });

  it('does not render description paragraph when omitted', async () => {
    const { EmptyState } = await import('./EmptyState');
    render(<EmptyState title="Empty" />);
    // Paragraph for description is absent — only the heading should be in the DOM
    const paras = document.querySelectorAll('p');
    expect(paras).toHaveLength(0);
  });

  it('renders action button when actionLabel and onAction are provided', async () => {
    const { EmptyState } = await import('./EmptyState');
    const onAction = vi.fn();
    render(<EmptyState title="Empty" actionLabel="Add Item" onAction={onAction} />);
    expect(screen.getByTestId('action-button')).toHaveTextContent('Add Item');
  });

  it('calls onAction callback when action button is clicked', async () => {
    const { EmptyState } = await import('./EmptyState');
    const onAction = vi.fn();
    render(<EmptyState title="Empty" actionLabel="Create" onAction={onAction} />);
    fireEvent.click(screen.getByTestId('action-button'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('onAction fires via userEvent.click (React Aria onPress)', async () => {
    const { EmptyState } = await import('./EmptyState');
    const onAction = vi.fn();
    render(<EmptyState title="Empty" actionLabel="Go" onAction={onAction} />);
    await userEvent.click(screen.getByTestId('action-button'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('does NOT render action button when actionLabel is provided but onAction is absent', async () => {
    const { EmptyState } = await import('./EmptyState');
    render(<EmptyState title="Empty" actionLabel="Unreachable" />);
    expect(screen.queryByTestId('action-button')).toBeNull();
  });

  it('does NOT render action button when onAction is provided but actionLabel is absent', async () => {
    const { EmptyState } = await import('./EmptyState');
    render(<EmptyState title="Empty" onAction={vi.fn()} />);
    expect(screen.queryByTestId('action-button')).toBeNull();
  });

  it('renders a default Inbox icon when no icon prop is given', async () => {
    const { EmptyState } = await import('./EmptyState');
    const { container } = render(<EmptyState title="Inbox Empty" />);
    // The icon renders as an SVG element
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('renders a custom icon when icon prop is provided', async () => {
    const { EmptyState } = await import('./EmptyState');
    // Use a Lucide icon as a substitute
    const CustomIcon = (props: React.SVGProps<SVGSVGElement>) => (
      <svg data-testid="custom-icon" {...props}>
        <circle cx="12" cy="12" r="10" />
      </svg>
    );
    render(<EmptyState title="Custom" icon={CustomIcon as Parameters<typeof EmptyState>[0]['icon']} />);
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });

  it('renders inside a Card wrapper', async () => {
    const { EmptyState } = await import('./EmptyState');
    render(<EmptyState title="Card test" />);
    expect(screen.getByTestId('card')).toBeInTheDocument();
  });

  it('renders with both description and action together', async () => {
    const { EmptyState } = await import('./EmptyState');
    const onAction = vi.fn();
    render(
      <EmptyState
        title="No listings"
        description="You haven't created any listings yet."
        actionLabel="Create listing"
        onAction={onAction}
      />
    );
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('No listings');
    expect(screen.getByText("You haven't created any listings yet.")).toBeInTheDocument();
    expect(screen.getByTestId('action-button')).toHaveTextContent('Create listing');
  });
});

describe('EmptyState inside AdminEmbed (broker panel)', () => {
  it('renders the broker empty state with the description as its hint', async () => {
    const { EmptyState } = await import('./EmptyState');
    const { AdminEmbed } = await import('./AdminEmbedContext');
    render(
      <AdminEmbed>
        <EmptyState title="No incidents" description="Nothing has been reported." />
      </AdminEmbed>,
    );
    const state = screen.getByTestId('broker-empty-state');
    expect(state).toHaveAttribute('data-title', 'No incidents');
    expect(state).toHaveAttribute('data-hint', 'Nothing has been reported.');
    expect(screen.queryByTestId('card')).not.toBeInTheDocument();
  });

  it('keeps the action button when embedded', async () => {
    const { EmptyState } = await import('./EmptyState');
    const { AdminEmbed } = await import('./AdminEmbedContext');
    const onAction = vi.fn();
    render(
      <AdminEmbed>
        <EmptyState title="Empty" actionLabel="Add" onAction={onAction} />
      </AdminEmbed>,
    );
    fireEvent.click(screen.getByTestId('action-button'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('does not use the broker empty state outside the embed', async () => {
    const { EmptyState } = await import('./EmptyState');
    render(<EmptyState title="Plain" />);
    expect(screen.queryByTestId('broker-empty-state')).not.toBeInTheDocument();
    expect(screen.getByTestId('card')).toBeInTheDocument();
  });
});
