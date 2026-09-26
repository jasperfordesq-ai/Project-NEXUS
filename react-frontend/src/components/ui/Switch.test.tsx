// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { Switch } from './Switch';

// No @/contexts or @/lib/api usage in Switch.tsx — no mocks needed.

describe('Switch — rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a switch role element (HeroUI Switch uses role="switch")', () => {
    render(<Switch />);
    // React Aria / HeroUI Switch renders an underlying input with role="switch"
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('renders with a label when children are provided', () => {
    render(<Switch>Enable notifications</Switch>);
    expect(screen.getByText('Enable notifications')).toBeInTheDocument();
  });

  it('renders description text when description prop is provided', () => {
    render(<Switch description="This affects all alerts">Alerts</Switch>);
    expect(screen.getByText('This affects all alerts')).toBeInTheDocument();
  });

  it('uses the HeroUI v3 compound anatomy for the clickable control', () => {
    const { container } = render(<Switch description="Help text">Toggle me</Switch>);
    const control = container.querySelector('.switch__control');
    const content = container.querySelector('.switch__content');

    expect(control).not.toBeNull();
    expect(content).not.toBeNull();
    expect(content).toContainElement(control as HTMLElement);
    expect(content).not.toContainElement(screen.getByText('Help text'));
  });

  it('is unchecked by default (no isSelected prop)', () => {
    render(<Switch>My toggle</Switch>);
    expect(screen.getByRole('switch')).not.toBeChecked();
  });

  it('renders as checked when isSelected=true', () => {
    const { container } = render(<Switch isSelected={true} onChange={vi.fn()}>My toggle</Switch>);
    expect(screen.getByRole('switch')).toBeChecked();
    expect(container.querySelector('.switch__control')).toHaveAttribute('data-selected', 'true');
    expect(container.querySelector('.switch__thumb')).toHaveAttribute('data-selected', 'true');
    expect(container.querySelector('.switch__control')).toHaveClass('!bg-accent');
  });

  it('renders as unchecked when isSelected=false', () => {
    const { container } = render(<Switch isSelected={false} onChange={vi.fn()}>My toggle</Switch>);
    expect(screen.getByRole('switch')).not.toBeChecked();
    expect(container.querySelector('.switch__control')).toHaveAttribute('data-selected', 'false');
    expect(container.querySelector('.switch__thumb')).toHaveAttribute('data-selected', 'false');
    expect(container.querySelector('.switch__control')).not.toHaveClass('!bg-accent');
  });

  // Regression: the unselected track used HeroUI's `--default`, which is the
  // card colour in this theme, so an OFF switch on a card was invisible.
  it('gives the unselected track a visible boundary and fill', () => {
    const { container } = render(<Switch isSelected={false} onChange={vi.fn()}>My toggle</Switch>);
    const control = container.querySelector('.switch__control');
    expect(control).toHaveClass('ring-1', 'ring-[var(--text-muted)]', '!bg-[var(--text-muted)]/35');
  });

  it('drops the unselected styling once the switch is on', () => {
    const { container } = render(<Switch isSelected={true} onChange={vi.fn()}>My toggle</Switch>);
    const control = container.querySelector('.switch__control');
    expect(control).not.toHaveClass('ring-1');
    expect(control).not.toHaveClass('!bg-[var(--text-muted)]/35');
  });

  it('updates the visible control when a controlled value changes', () => {
    const { container, rerender } = render(
      <Switch isSelected={false} onChange={vi.fn()}>My toggle</Switch>
    );

    rerender(<Switch isSelected={true} onChange={vi.fn()}>My toggle</Switch>);

    expect(screen.getByRole('switch')).toBeChecked();
    expect(container.querySelector('.switch__control')).toHaveAttribute('data-selected', 'true');
    expect(container.querySelector('.switch__thumb')).toHaveAttribute('data-selected', 'true');
  });

  it('is disabled when isDisabled prop is set', () => {
    render(<Switch isDisabled>Disabled</Switch>);
    expect(screen.getByRole('switch')).toBeDisabled();
  });

  it('renders custom startContent', () => {
    render(<Switch startContent={<span data-testid="start-icon" />}>Label</Switch>);
    expect(screen.getByTestId('start-icon')).toBeInTheDocument();
  });

  it('renders custom endContent', () => {
    render(<Switch endContent={<span data-testid="end-icon" />}>Label</Switch>);
    expect(screen.getByTestId('end-icon')).toBeInTheDocument();
  });
});

describe('Switch — onChange / onValueChange callbacks', () => {
  it('calls onChange when toggled', () => {
    const onChange = vi.fn();
    render(<Switch onChange={onChange}>Toggle me</Switch>);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalled();
  });

  it('calls onValueChange when toggled (alias prop)', () => {
    const onValueChange = vi.fn();
    render(<Switch onValueChange={onValueChange}>Toggle me</Switch>);
    fireEvent.click(screen.getByRole('switch'));
    expect(onValueChange).toHaveBeenCalled();
  });

  it('toggles when the visible control is clicked', () => {
    const onValueChange = vi.fn();
    const { container } = render(<Switch onValueChange={onValueChange}>Toggle me</Switch>);
    const control = container.querySelector('.switch__control');

    expect(control).not.toBeNull();
    fireEvent.click(control as HTMLElement);
    expect(onValueChange).toHaveBeenCalledWith(true);
  });

  it('prefers onChange over onValueChange when both provided', () => {
    // Switch wires `onChange ?? onValueChange` — so onChange wins
    const onChange = vi.fn();
    const onValueChange = vi.fn();
    render(<Switch onChange={onChange} onValueChange={onValueChange}>Toggle</Switch>);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalled();
    // onValueChange is shadowed — HeroUI won't call it separately
  });

  it('is visually marked as disabled (aria-disabled or disabled attribute)', () => {
    // HeroUI Switch uses React Aria which may set disabled or aria-disabled.
    // We verify the switch is in a disabled state rather than asserting no callback
    // (jsdom fires DOM events on aria-disabled elements too, which is a known jsdom gap).
    render(<Switch isDisabled onChange={vi.fn()}>Toggle</Switch>);
    const switchEl = screen.getByRole('switch');
    const isDisabledInDOM =
      switchEl.hasAttribute('disabled') ||
      switchEl.getAttribute('aria-disabled') === 'true' ||
      switchEl.closest('[data-disabled]') !== null;
    expect(isDisabledInDOM).toBe(true);
  });
});

describe('Switch — render-prop / function children', () => {
  it('accepts a function child (render-prop pattern)', () => {
    // When children is a function, Switch delegates entirely to HeroUISwitch
    // and renders the function result.
    render(
      <Switch>
        {() => <span data-testid="fn-child">Dynamic label</span>}
      </Switch>
    );
    expect(screen.getByTestId('fn-child')).toBeInTheDocument();
  });
});
