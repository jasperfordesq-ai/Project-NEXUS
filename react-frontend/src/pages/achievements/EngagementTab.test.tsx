// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@/test/test-utils';

const getMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  api: { get: getMock, post: vi.fn(), put: vi.fn() },
  tokenManager: { getTenantId: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    onPress,
    'aria-label': ariaLabel,
    title,
  }: {
    children: React.ReactNode;
    onPress?: () => void;
    'aria-label'?: string;
    title?: string;
  }) => <button type="button" onClick={onPress} aria-label={ariaLabel} title={title}>{children}</button>,
}));
vi.mock('@/components/ui/GlassCard', () => ({
  GlassCard: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}));
vi.mock('@/components/ui/Skeleton', () => ({
  Skeleton: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/ui/Chip', () => ({
  Chip: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock('@/components/feedback', () => ({
  EmptyState: ({
    title,
    description,
    action,
  }: {
    title: string;
    description?: string;
    action?: React.ReactNode | { label: string; onClick: () => void };
  }) => (
    <section>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {action && typeof action === 'object' && 'label' in action
        ? <button type="button" onClick={action.onClick}>{action.label}</button>
        : action}
    </section>
  ),
}));

import { EngagementTab } from './AchievementsPage';

const backendDetail = 'SQLSTATE secret backend detail';
const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

beforeEach(() => {
  vi.clearAllMocks();
  getMock.mockResolvedValue({ success: true, data: [] });
});

describe('EngagementTab load states', () => {
  it.each([
    ['resolved failure', () => Promise.resolve({ success: false, error: backendDetail })],
    ['rejected request', () => Promise.reject(new Error(backendDetail))],
  ])('renders %s as a retryable error without fabricating twelve inactive months', async (_label, response) => {
    getMock.mockImplementationOnce(response);
    render(<EngagementTab />);

    expect(await screen.findByRole('alert')).toHaveTextContent("That didn't load");
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    expect(screen.queryByText('0 of 12 months')).not.toBeInTheDocument();
    expect(screen.queryByText(backendDetail)).not.toBeInTheDocument();
  });

  it('retries an initial failure and renders confirmed engagement history', async () => {
    getMock
      .mockResolvedValueOnce({ success: false, error: backendDetail })
      .mockResolvedValueOnce({
        success: true,
        data: [{ year_month: currentMonth(), was_active: true, activity_count: 3 }],
      });
    render(<EngagementTab />);

    fireEvent.click(await screen.findByRole('button', { name: 'Try Again' }));
    expect(await screen.findByText('1 of 12 months')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('retains confirmed history when a refresh resolves success:false', async () => {
    getMock
      .mockResolvedValueOnce({
        success: true,
        data: [{ year_month: currentMonth(), was_active: true, activity_count: 2 }],
      })
      .mockResolvedValueOnce({ success: false, error: backendDetail });
    render(<EngagementTab />);

    expect(await screen.findByText('1 of 12 months')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("That didn't load");
    expect(screen.getByText('1 of 12 months')).toBeInTheDocument();
  });

  it('renders success:true with an empty array as a genuine empty state, not numeric zero', async () => {
    render(<EngagementTab />);

    expect(await screen.findByRole('heading', { name: 'Monthly Engagement' })).toBeInTheDocument();
    expect(screen.getByText(/Months where you completed/)).toBeInTheDocument();
    expect(screen.queryByText('0 of 12 months')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders an explicit inactive history record as a genuine numeric zero', async () => {
    getMock.mockResolvedValueOnce({
      success: true,
      data: [{ year_month: currentMonth(), was_active: false, activity_count: 0 }],
    });
    render(<EngagementTab />);

    expect(await screen.findByText('0 of 12 months')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
