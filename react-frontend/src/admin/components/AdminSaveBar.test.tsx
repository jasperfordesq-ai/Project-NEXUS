// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { AdminSaveBar } from './AdminSaveBar';

const isDisabled = (el: HTMLElement) =>
  el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true' || el.getAttribute('data-disabled') === 'true';

describe('AdminSaveBar', () => {
  it('reads "All changes saved" and disables both buttons when clean', () => {
    render(<AdminSaveBar dirty={false} saving={false} onSave={vi.fn()} onDiscard={vi.fn()} />);

    expect(screen.getByRole('region', { name: 'Save or discard changes' })).toBeInTheDocument();
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(isDisabled(screen.getByRole('button', { name: /save all changes/i }))).toBe(true);
    expect(isDisabled(screen.getByRole('button', { name: /discard/i }))).toBe(true);
  });

  it('shows the unsaved chip and enables Save and Discard when dirty', () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    render(<AdminSaveBar dirty saving={false} onSave={onSave} onDiscard={onDiscard} />);

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    const save = screen.getByRole('button', { name: /save all changes/i });
    const discard = screen.getByRole('button', { name: /discard/i });
    expect(isDisabled(save)).toBe(false);
    expect(isDisabled(discard)).toBe(false);
    fireEvent.click(save);
    fireEvent.click(discard);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('blocks Save and shows the reason while validation fails', () => {
    render(
      <AdminSaveBar dirty saving={false} blockedReason="Fix the errors first" onSave={vi.fn()} onDiscard={vi.fn()} />
    );
    expect(screen.getByText('Fix the errors first')).toBeInTheDocument();
    expect(isDisabled(screen.getByRole('button', { name: /save all changes/i }))).toBe(true);
  });

  it('renders secondary actions', () => {
    render(
      <AdminSaveBar dirty={false} saving={false} onSave={vi.fn()} onDiscard={vi.fn()} secondaryActions={<button>More</button>} />
    );
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
  });
});
