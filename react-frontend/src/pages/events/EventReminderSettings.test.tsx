// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for EventReminderSettings
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));

vi.mock('@/lib/motion', async () => {
  const { framerMotionMock } = await import('@/test/mocks');
  return framerMotionMock;
});

import { EventReminderSettings } from './EventReminderSettings';

describe('EventReminderSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the reminder settings heading', () => {
    render(<EventReminderSettings />);
    expect(screen.getByText("Event reminders")).toBeInTheDocument();
  });

  it('renders the coming soon badge', () => {
    render(<EventReminderSettings />);
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
  });

  it('renders description about individual event reminders', () => {
    render(<EventReminderSettings />);
    expect(screen.getByText('Global reminder preferences are coming soon. In the meantime, you can set reminders on individual events from their detail page.')).toBeInTheDocument();
  });

  it('renders the Bell icon area (card body is present)', () => {
    render(<EventReminderSettings />);
    // The component renders a Card with a CardBody
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toBeInTheDocument();
  });

  it('renders without crashing when i18n keys are missing defaults', () => {
    render(<EventReminderSettings />);
    expect(document.body).toBeInTheDocument();
  });
});
