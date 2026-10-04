// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@/test/test-utils';
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard';

const { mockConfirm, mockNavigate } = vi.hoisted(() => ({
  mockConfirm: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useConfirm: () => mockConfirm };
});

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return { ...orig, useNavigate: () => mockNavigate };
});

function Harness({ when }: { when: boolean }) {
  useUnsavedChangesGuard(when);
  return (
    // The React handler runs after the guard's capture-phase listener, so it
    // only stops jsdom trying to follow the link when the guard lets it through.
    <div onClick={(e) => e.preventDefault()}>
      <a href="/test/admin/users">Users</a>
      <a href="#general">Jump</a>
    </div>
  );
}

describe('useUnsavedChangesGuard', () => {
  beforeEach(() => {
    mockConfirm.mockReset();
    mockNavigate.mockReset();
  });

  it('registers beforeunload only while dirty', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { rerender } = render(<Harness when={false} />);
    expect(add.mock.calls.some(([type]) => type === 'beforeunload')).toBe(false);

    rerender(<Harness when />);
    expect(add.mock.calls.some(([type]) => type === 'beforeunload')).toBe(true);

    rerender(<Harness when={false} />);
    expect(remove.mock.calls.some(([type]) => type === 'beforeunload')).toBe(true);
    add.mockRestore();
    remove.mockRestore();
  });

  it('asks before following an in-app link and navigates on confirm', async () => {
    mockConfirm.mockResolvedValue(true);
    const { getByText } = render(<Harness when />);

    const event = fireEvent.click(getByText('Users'));
    // Default prevented: the guard took over the navigation.
    expect(event).toBe(false);
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
    expect(mockConfirm.mock.calls[0][0]).toMatchObject({ status: 'warning', title: 'Leave without saving?' });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/test/admin/users'));
  });

  it('stays put when the admin cancels', async () => {
    mockConfirm.mockResolvedValue(false);
    const { getByText } = render(<Harness when />);
    fireEvent.click(getByText('Users'));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('ignores hash links (jump pills) and does nothing when clean', () => {
    const { getByText, rerender } = render(<Harness when />);
    fireEvent.click(getByText('Jump'));
    expect(mockConfirm).not.toHaveBeenCalled();

    rerender(<Harness when={false} />);
    fireEvent.click(getByText('Users'));
    expect(mockConfirm).not.toHaveBeenCalled();
  });
});
