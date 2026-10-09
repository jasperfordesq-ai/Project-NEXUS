// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { ImportProgress } from './ImportProgress';
import type { RunnerState } from './types';

// ModalBody / ModalFooter are only meaningful inside a Modal; the progress screen is tested on its own.
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...actual,
    ModalBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ModalFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

function state(overrides: Partial<RunnerState> = {}): RunnerState {
  return {
    phase: 'running', total: 1000, nextIndex: 0, batchNumber: 0, batchSize: 25,
    created: 0, balance: '0.00', zeroed: 0, admissionIncomplete: 0, admissionIncompleteRows: [],
    held: false, stop: null, errorMessage: null, errorCode: null, startedAt: 0, secondsRemaining: 60,
    ...overrides,
  };
}

/** The text a screen reader is given: the one polite live region on the screen. */
function announced(container: HTMLElement): string {
  const regions = container.querySelectorAll('[aria-live="polite"]');
  expect(regions).toHaveLength(1);
  return regions[0]!.textContent ?? '';
}

describe('ImportProgress live region', () => {
  it('announces only at each 10% of progress, while the visible lines keep updating', () => {
    const { container, rerender } = render(<ImportProgress state={state({ nextIndex: 100 })} onStop={vi.fn()} />);
    const at10 = announced(container);
    expect(at10).toContain('10%');

    // 101 to 199 rows done: the figures on screen move, the announcement does not.
    rerender(<ImportProgress state={state({ nextIndex: 130, batchNumber: 2, secondsRemaining: 50 })} onStop={vi.fn()} />);
    expect(screen.getByText('Members imported: 130 of 1,000')).toBeInTheDocument();
    expect(announced(container)).toBe(at10);
    rerender(<ImportProgress state={state({ nextIndex: 199, batchNumber: 3, secondsRemaining: 40 })} onStop={vi.fn()} />);
    expect(announced(container)).toBe(at10);

    // Crossing 20% changes it.
    rerender(<ImportProgress state={state({ nextIndex: 200, batchNumber: 4 })} onStop={vi.fn()} />);
    expect(announced(container)).toContain('20%');
    expect(announced(container)).not.toBe(at10);
  });

  it('announces a change of phase (stopping) even between 10% steps', () => {
    const { container, rerender } = render(<ImportProgress state={state({ nextIndex: 130 })} onStop={vi.fn()} />);
    const before = announced(container);
    rerender(<ImportProgress state={state({ nextIndex: 130, phase: 'stopping' })} onStop={vi.fn()} />);
    expect(announced(container)).not.toBe(before);
    expect(announced(container)).toContain('Stopping after this batch');
  });

  it('keeps the rapidly updating lines out of any live region', () => {
    render(<ImportProgress state={state({ nextIndex: 130 })} onStop={vi.fn()} />);
    const line = screen.getByText('Members imported: 130 of 1,000');
    expect(line.closest('[aria-live], [role="status"]')).toBeNull();
  });
});
