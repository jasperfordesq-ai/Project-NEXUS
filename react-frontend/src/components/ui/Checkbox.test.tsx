// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for the ui/Checkbox and CheckboxGroup wrapper components.
 *
 * NOTE on disabled-click: HeroUI Checkbox wraps the native input in a
 * <label> and manages state internally.  Clicking a disabled HeroUI checkbox
 * does NOT fire onChange because the aria-disabled guard lives inside the
 * React Aria layer; the test below reflects this.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import { Checkbox, CheckboxGroup } from './Checkbox';

vi.mock('@/contexts', () => createMockContexts());

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Checkbox — basic rendering ───────────────────────────────────────────────

describe('Checkbox — basic rendering', () => {
  it('renders a checkbox role', () => {
    render(<Checkbox>Accept</Checkbox>);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('renders label text', () => {
    render(<Checkbox>Label text</Checkbox>);
    expect(screen.getByText('Label text')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(<Checkbox description="Extra details">Agree</Checkbox>);
    expect(screen.getByText('Extra details')).toBeInTheDocument();
  });

  it('is unchecked by default', () => {
    render(<Checkbox>Unchecked</Checkbox>);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('respects defaultSelected prop', () => {
    render(<Checkbox defaultSelected>Pre-checked</Checkbox>);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });
});

// ─── Checkbox — onChange / onValueChange ─────────────────────────────────────

describe('Checkbox — onChange / onValueChange', () => {
  // 🔴 Every other interaction test in this file fires its click on the hidden
  // native input (getByRole('checkbox')), which toggles regardless of how the
  // visible parts are assembled. So none of them can tell you whether a member
  // can actually tick the box they can see. This one clicks the rendered
  // control, using a real pointer sequence rather than fireEvent, because
  // React Aria's press handling ignores a bare synthetic click.
  it('toggles when the user clicks the visible control box, not just the label', async () => {
    const onValueChange = vi.fn();
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();

    const { container } = render(
      <Checkbox onValueChange={onValueChange}>Accept the terms</Checkbox>
    );

    const control = container.querySelector('[data-slot="checkbox-control"]');
    expect(control).not.toBeNull();

    await user.click(control as Element);

    expect(onValueChange).toHaveBeenCalledWith(true);
  });

  it('calls onChange with true when checked', () => {
    const onChange = vi.fn();
    render(<Checkbox onChange={onChange}>Click me</Checkbox>);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('calls onValueChange with true when checked', () => {
    const onValueChange = vi.fn();
    render(<Checkbox onValueChange={onValueChange}>Click me</Checkbox>);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onValueChange).toHaveBeenCalledWith(true);
  });

  it('calls onChange with false when unchecked', () => {
    const onChange = vi.fn();
    render(<Checkbox defaultSelected onChange={onChange}>Toggle</Checkbox>);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

// ─── Checkbox — disabled ──────────────────────────────────────────────────────

describe('Checkbox — disabled', () => {
  it('renders as disabled', () => {
    render(<Checkbox isDisabled>Disabled</Checkbox>);
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
});

// ─── Checkbox — render-function children ─────────────────────────────────────

describe('Checkbox — render-function children', () => {
  it('renders when children is a function (falls through to HeroUICheckbox)', () => {
    // The component passes the render function directly to HeroUICheckbox.
    // We just verify it mounts without throwing.
    render(
      <Checkbox>
        {({ isSelected }) => (
          <span>{isSelected ? 'Checked' : 'Unchecked'}</span>
        )}
      </Checkbox>,
    );
    expect(screen.getByText('Unchecked')).toBeInTheDocument();
  });
});

// ─── CheckboxGroup ────────────────────────────────────────────────────────────

describe('CheckboxGroup — basic rendering', () => {
  it('renders a group role', () => {
    render(
      <CheckboxGroup label="Preferences">
        <Checkbox value="a">Option A</Checkbox>
        <Checkbox value="b">Option B</Checkbox>
      </CheckboxGroup>,
    );
    expect(screen.getByRole('group')).toBeInTheDocument();
  });

  it('renders group label', () => {
    render(
      <CheckboxGroup label="Choose options">
        <Checkbox value="x">X</Checkbox>
      </CheckboxGroup>,
    );
    expect(screen.getByText('Choose options')).toBeInTheDocument();
  });

  it('renders group description', () => {
    render(
      <CheckboxGroup label="Pick" description="Choose at least one">
        <Checkbox value="y">Y</Checkbox>
      </CheckboxGroup>,
    );
    expect(screen.getByText('Choose at least one')).toBeInTheDocument();
  });

  it('calls onChange when a child checkbox changes', () => {
    const onChange = vi.fn();
    render(
      <CheckboxGroup label="Select" onChange={onChange}>
        <Checkbox value="alpha">Alpha</Checkbox>
      </CheckboxGroup>,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /alpha/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('calls onValueChange when a child checkbox changes', () => {
    const onValueChange = vi.fn();
    render(
      <CheckboxGroup label="Select" onValueChange={onValueChange}>
        <Checkbox value="beta">Beta</Checkbox>
      </CheckboxGroup>,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /beta/i }));
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });
});
