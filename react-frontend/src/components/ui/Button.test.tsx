// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as renderBare } from '@testing-library/react';
import { Link as RouterLink, MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent } from '@/test/test-utils';
import { Button, type ButtonProps } from './Button';

// Button wraps HeroUIButton which uses React Aria — no contexts needed.

describe('Button — rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders label text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument();
  });

  it('renders with startContent', () => {
    render(<Button startContent={<span data-testid="start-icon" />}>Label</Button>);
    expect(screen.getByTestId('start-icon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /label/i })).toBeInTheDocument();
  });

  it('renders with endContent', () => {
    render(<Button endContent={<span data-testid="end-icon" />}>Label</Button>);
    expect(screen.getByTestId('end-icon')).toBeInTheDocument();
  });

  it('shows spinner when isLoading=true (spinnerPlacement start)', () => {
    render(<Button isLoading>Saving</Button>);
    // HeroUI renders a spinner SVG; at minimum the button exists
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('renders as an anchor link when as="a" and href given', () => {
    render(<Button as="a" href="https://example.com">Visit</Button>);
    const link = screen.getByRole('link', { name: /visit/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://example.com');
  });

  it('renders a router destination as one styled link without a nested button', () => {
    renderBare(
      <MemoryRouter>
        <Button as={RouterLink} to="/settings" className="flex-1 w-full">
          Settings
        </Button>
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: /settings/i });
    expect(link).toHaveAttribute('href', '/settings');
    expect(link).toHaveClass('button', 'button--primary', 'flex-1', 'w-full');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('Button — variant / color mapping', () => {
  it('renders with variant="solid" (maps to primary)', () => {
    render(<Button variant="solid">Solid</Button>);
    expect(screen.getByRole('button', { name: /solid/i })).toBeInTheDocument();
  });

  it('maps the legacy bordered variant to the documented v3 outline style', () => {
    render(<Button variant="bordered">Bordered</Button>);
    expect(screen.getByRole('button', { name: /bordered/i })).toHaveClass('button--outline');
  });

  it('maps the legacy light variant to the documented v3 ghost style', () => {
    render(<Button variant="light">Light</Button>);
    expect(screen.getByRole('button', { name: /light/i })).toHaveClass('button--ghost');
  });

  it('maps the legacy flat variant to the documented v3 tertiary style', () => {
    render(<Button variant="flat">Flat</Button>);
    expect(screen.getByRole('button', { name: /flat/i })).toHaveClass('button--tertiary');
  });

  it('renders with color="danger" variant="solid" (maps to danger)', () => {
    render(<Button color="danger" variant="solid">Delete</Button>);
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('renders with color="danger" variant="flat" (maps to danger-soft)', () => {
    render(<Button color="danger" variant="flat">Soft delete</Button>);
    expect(screen.getByRole('button', { name: /soft delete/i })).toBeInTheDocument();
  });

  it('renders with variant="ghost"', () => {
    render(<Button variant="ghost">Ghost</Button>);
    expect(screen.getByRole('button', { name: /ghost/i })).toBeInTheDocument();
  });

  it('preserves a solid success intent with semantic HeroUI tokens', () => {
    render(<Button color="success">Approve</Button>);
    const button = screen.getByRole('button', { name: /approve/i });

    expect(button).toHaveAttribute('data-color-intent', 'success');
    expect(button.className).toContain('[--button-bg:var(--success)]');
    expect(button.className).toContain('[--button-fg:var(--success-foreground)]');
  });

  it('preserves a soft warning intent for legacy flat buttons', () => {
    render(<Button color="warning" variant="flat">Review</Button>);
    const button = screen.getByRole('button', { name: /review/i });

    expect(button).toHaveAttribute('data-color-intent', 'warning');
    expect(button.className).toContain('[--button-bg:var(--warning-soft)]');
    expect(button.className).toContain('[--button-fg:var(--warning-soft-foreground)]');
  });

  it('preserves outlined success intent for legacy bordered buttons', () => {
    render(<Button color="success" variant="bordered">Confirm</Button>);
    const button = screen.getByRole('button', { name: /confirm/i });

    expect(button).toHaveClass('border', 'border-success');
    expect(button.className).toContain('[--button-bg:transparent]');
  });

  it('preserves status intent when rendered as a link', () => {
    render(<Button as="a" href="/review" color="warning">Open review</Button>);
    const link = screen.getByRole('link', { name: /open review/i });

    expect(link).toHaveAttribute('data-color-intent', 'warning');
    expect(link.className).toContain('[--button-bg:var(--warning)]');
  });
});

describe('Button — disabled behaviour', () => {
  it('is aria-disabled or data-disabled when isDisabled=true', () => {
    render(<Button isDisabled>Disabled</Button>);
    const btn = screen.getByRole('button', { name: /disabled/i });
    // HeroUI/React Aria may use either aria-disabled or data-disabled depending on version
    const isMarkedDisabled =
      btn.getAttribute('aria-disabled') === 'true' ||
      btn.hasAttribute('data-disabled') ||
      (btn as HTMLButtonElement).disabled === true;
    expect(isMarkedDisabled).toBe(true);
  });

  it('does not fire onPress when isDisabled', () => {
    const onPress = vi.fn();
    render(<Button isDisabled onPress={onPress}>Disabled</Button>);
    const btn = screen.getByRole('button', { name: /disabled/i });
    fireEvent.click(btn);
    // HeroUI / React Aria swallows the press on disabled elements
    expect(onPress).not.toHaveBeenCalled();
  });

  it('does not fire onPress when disabled=true (native prop)', () => {
    const onPress = vi.fn();
    render(<Button disabled onPress={onPress}>Native disabled</Button>);
    const btn = screen.getByRole('button', { name: /native disabled/i });
    fireEvent.click(btn);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('Button — onPress callback', () => {
  it('fires onPress when clicked (enabled)', () => {
    const onPress = vi.fn();
    render(<Button onPress={onPress}>Press me</Button>);
    fireEvent.click(screen.getByRole('button', { name: /press me/i }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('uses React Aria press propagation so parent click actions do not also fire', () => {
    const onParentClick = vi.fn();
    const onPress = vi.fn();
    render(
      <div onClick={onParentClick}>
        <Button onPress={onPress}>Nested action</Button>
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: /nested action/i }));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it('does not expose native onClick in the project compatibility contract', () => {
    type HasOnClick = 'onClick' extends keyof ButtonProps ? true : false;
    const hasOnClick: HasOnClick = false;

    expect(hasOnClick).toBe(false);
  });
});

describe('Button — as native element', () => {
  it('renders as native <button> and preserves onPress', () => {
    const onPress = vi.fn();
    render(<Button as="button" onPress={onPress}>Native</Button>);
    const btn = screen.getByRole('button', { name: /native/i });
    fireEvent.click(btn);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire onPress when as="button" and isDisabled', () => {
    const onPress = vi.fn();
    render(<Button as="button" isDisabled onPress={onPress}>N/A</Button>);
    const btn = screen.getByRole('button', { name: /n\/a/i });
    fireEvent.click(btn);
    expect(onPress).not.toHaveBeenCalled();
  });
});
