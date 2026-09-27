// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import i18n from 'i18next';
import { cleanup, render, screen, fireEvent } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { Input } from './Input';

describe('Input — basic render', () => {
  it('renders an input element', () => {
    render(<Input />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('uses the mobile no-zoom font baseline', () => {
    render(<Input />);
    expect(screen.getByRole('textbox')).toHaveClass('text-base', 'sm:text-sm');
  });

  it('renders with a label when label prop provided', () => {
    render(<Input label="Email address" />);
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByText('Email address')).toBeInTheDocument();
  });

  it('renders placeholder text', () => {
    render(<Input placeholder="Enter something" />);
    expect(screen.getByPlaceholderText('Enter something')).toBeInTheDocument();
  });

  it('renders with a default value', () => {
    render(<Input defaultValue="hello" />);
    expect(screen.getByRole('textbox')).toHaveValue('hello');
  });
});

describe('Input — onChange / onValueChange', () => {
  it('calls onChange when user types', async () => {
    const onChange = vi.fn();
    render(<Input onChange={onChange} />);
    await userEvent.type(screen.getByRole('textbox'), 'abc');
    expect(onChange).toHaveBeenCalled();
  });

  it('calls onValueChange with the typed string', async () => {
    const onValueChange = vi.fn();
    render(<Input onValueChange={onValueChange} />);
    await userEvent.type(screen.getByRole('textbox'), 'x');
    expect(onValueChange).toHaveBeenCalledWith(expect.stringContaining('x'));
  });

  it('fires both onChange and onValueChange on the same keystroke', () => {
    const onChange = vi.fn();
    const onValueChange = vi.fn();
    render(<Input onChange={onChange} onValueChange={onValueChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('hello');
  });
});

describe('Input — disabled', () => {
  it('is disabled when isDisabled is true', () => {
    render(<Input isDisabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
});

describe('Input — isRequired', () => {
  it('marks the input required', () => {
    render(<Input label="Name" isRequired />);
    expect(screen.getByRole('textbox')).toBeRequired();
  });
});

describe('Input — invalid / errorMessage', () => {
  it('shows error message when provided alongside label', () => {
    render(<Input label="Email" isInvalid errorMessage="Invalid email" />);
    expect(screen.getByText('Invalid email')).toBeInTheDocument();
  });

  it('shows description when provided', () => {
    render(<Input label="Name" description="Enter your full name" />);
    expect(screen.getByText('Enter your full name')).toBeInTheDocument();
  });
});

describe('Input — startContent / endContent', () => {
  it('renders startContent', () => {
    render(<Input startContent={<span data-testid="icon">★</span>} />);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('renders endContent', () => {
    render(<Input endContent={<span data-testid="suffix">kg</span>} />);
    expect(screen.getByTestId('suffix')).toBeInTheDocument();
  });
});

describe('Input — isClearable / onClear', () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('calls onClear and onValueChange with empty string when clear button pressed', async () => {
    const onClear = vi.fn();
    const onValueChange = vi.fn();
    render(<Input isClearable onClear={onClear} onValueChange={onValueChange} defaultValue="text" />);
    const clearBtn = screen.getByRole('button');
    await userEvent.click(clearBtn);
    expect(onClear).toHaveBeenCalled();
    expect(onValueChange).toHaveBeenCalledWith('');
  });

  it('uses a context-correct translated clear label', async () => {
    i18n.addResource('fr', 'common', 'accessibility.clear_input', 'Effacer la saisie');
    await i18n.changeLanguage('fr');

    render(<Input isClearable defaultValue="texte" />);

    expect(screen.getByRole('button', { name: 'Effacer la saisie' })).toBeInTheDocument();
  });

  it('accepts a translated field-specific clear label override', () => {
    render(<Input isClearable defaultValue="query" clearButtonLabel="Clear member filter" />);

    expect(screen.getByRole('button', { name: 'Clear member filter' })).toBeInTheDocument();
  });
});

describe('Input — variant forwarding', () => {
  it('renders without errors for bordered variant', () => {
    render(<Input variant="bordered" />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders without errors for flat variant', () => {
    render(<Input variant="flat" />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});

describe('Input — type forwarding', () => {
  it('renders password input when type="password"', () => {
    const { container } = render(<Input type="password" />);
    // password inputs don't have role=textbox; find by type
    const input = container.querySelector('input[type="password"]');
    expect(input).toBeInTheDocument();
  });

  it('renders number input when type="number"', () => {
    const { container } = render(<Input type="number" min={1} max={100} />);
    const input = container.querySelector('input[type="number"]');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('min', '1');
    expect(input).toHaveAttribute('max', '100');
  });
});
