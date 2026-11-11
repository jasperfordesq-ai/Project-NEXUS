// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StepTracker } from './StepTracker';

const steps = [
  { key: 'requested', label: 'Requested' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'done', label: 'Done' },
  { key: 'confirmed', label: 'Confirmed' },
];

describe('StepTracker', () => {
  it('is an ordered list with the current step marked for screen readers', () => {
    render(<StepTracker steps={steps} current={1} label="Exchange progress" doneText="done" currentText="current step" />);
    const list = screen.getByRole('list', { name: 'Exchange progress' });
    expect(list.tagName).toBe('OL');
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[0]).toHaveTextContent('Requested (done)');
    expect(items[1]).toHaveTextContent('Accepted (current step)');
    expect(items[2]).not.toHaveAttribute('aria-current');
  });

  it('marks every step done when the journey is complete', () => {
    render(<StepTracker steps={steps} current={3} complete label="Exchange progress" doneText="done" currentText="current step" />);
    for (const item of screen.getAllByRole('listitem')) {
      expect(item).toHaveTextContent('(done)');
      expect(item).not.toHaveAttribute('aria-current');
    }
  });
});
