// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';
import React from 'react';

// ─── Mock api ─────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Toast / Auth / Tenant ────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Alice' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

// ─── Stub HeroUI components used in SkillTagsInput ───────────────────────────
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    Input: ({
      value,
      onChange,
      onKeyDown,
      onBlur,
      onFocus,
      placeholder,
      'aria-label': ariaLabel,
      'aria-expanded': ariaExpanded,
      'aria-controls': ariaControls,
      'aria-autocomplete': ariaAutocomplete,
    }: {
      value?: string;
      onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
      onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
      onBlur?: () => void;
      onFocus?: () => void;
      placeholder?: string;
      'aria-label'?: string;
      'aria-expanded'?: boolean | 'true' | 'false';
      'aria-controls'?: string;
      'aria-autocomplete'?: string;
    }) => (
      <input
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onFocus={onFocus}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-expanded={ariaExpanded as boolean}
        aria-controls={ariaControls}
        aria-autocomplete={ariaAutocomplete as 'list' | 'none' | 'inline' | 'both' | undefined}
        role="textbox"
      />
    ),
    Chip: ({
      children,
      onClose,
    }: {
      children: React.ReactNode;
      onClose?: () => void;
    }) => (
      <span data-testid="tag-chip">
        {children}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={`Remove ${children}`}
            data-testid="remove-tag"
          >
            ×
          </button>
        )}
      </span>
    ),
    Button: ({
      children,
      onPress,
      onMouseDown,
      role,
      'aria-selected': ariaSelected,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      onMouseDown?: (e: React.MouseEvent) => void;
      role?: string;
      'aria-selected'?: boolean;
    }) => (
      <button
        onClick={onPress}
        onMouseDown={onMouseDown}
        role={role}
        aria-selected={ariaSelected}
        data-testid="suggestion-option"
      >
        {children}
      </button>
    ),
  };
});

// ─── Default props ────────────────────────────────────────────────────────────
const makeProps = (overrides = {}) => ({
  tags: [] as string[],
  onChange: vi.fn(),
  maxTags: 10,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SkillTagsInput', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: [] });
  });

  it('renders the tag input textbox', async () => {
    const { SkillTagsInput } = await import('./SkillTagsInput');
    render(<SkillTagsInput {...makeProps()} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders existing tags as chips', async () => {
    const { SkillTagsInput } = await import('./SkillTagsInput');
    render(<SkillTagsInput {...makeProps({ tags: ['react', 'typescript'] })} />);
    // One Remove button per rendered Chip (HeroUI's CloseButton, aria-label common:aria.remove).
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(2);
    expect(screen.getByText('react')).toBeInTheDocument();
    expect(screen.getByText('typescript')).toBeInTheDocument();
  });

  it('calls onChange when Enter is pressed to add a tag', async () => {
    const onChange = vi.fn();
    const { SkillTagsInput } = await import('./SkillTagsInput');
    render(<SkillTagsInput {...makeProps({ onChange })} />);

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'python' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(['python']);
  });

  it('calls onChange when comma is pressed to add a tag', async () => {
    const onChange = vi.fn();
    const { SkillTagsInput } = await import('./SkillTagsInput');
    render(<SkillTagsInput {...makeProps({ onChange })} />);

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'css' } });
    fireEvent.keyDown(input, { key: ',', code: 'Comma' });

    expect(onChange).toHaveBeenCalledWith(['css']);
  });

  it('normalises tags to lowercase', async () => {
    const onChange = vi.fn();
    const { SkillTagsInput } = await import('./SkillTagsInput');
    render(<SkillTagsInput {...makeProps({ onChange })} />);

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'ReactJS' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(['reactjs']);
  });

  it('does not add duplicate tags', async () => {
    const onChange = vi.fn();
    const { SkillTagsInput } = await import('./SkillTagsInput');
    render(<SkillTagsInput {...makeProps({ tags: ['react'], onChange })} />);

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'react' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('calls onChange to remove a tag when the chip close button is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { SkillTagsInput } = await import('./SkillTagsInput');
    render(<SkillTagsInput {...makeProps({ tags: ['react', 'vue'], onChange })} />);

    const removeBtns = screen.getAllByRole('button', { name: 'Remove' });
    await user.click(removeBtns[0]);

    expect(onChange).toHaveBeenCalledWith(['vue']);
  });

  it('removes last tag on Backspace when input is empty', async () => {
    const onChange = vi.fn();
    const { SkillTagsInput } = await import('./SkillTagsInput');
    render(<SkillTagsInput {...makeProps({ tags: ['react', 'vue'], onChange })} />);

    const input = screen.getByRole('combobox');
    // Ensure input is empty
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Backspace', code: 'Backspace' });

    expect(onChange).toHaveBeenCalledWith(['react']);
  });

  it('shows autocomplete suggestions after debounced API call', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: ['javascript', 'java'] });

    const { SkillTagsInput } = await import('./SkillTagsInput');
    render(<SkillTagsInput {...makeProps()} />);

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'jav' } });

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith(
        expect.stringContaining('/v2/listings/tags/autocomplete?q=jav')
      );
    });

    await waitFor(() => {
      expect(screen.getAllByRole('option').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('does not fetch suggestions for input shorter than 2 chars', async () => {
    const { SkillTagsInput } = await import('./SkillTagsInput');
    render(<SkillTagsInput {...makeProps()} />);

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'j' } });

    // Wait briefly to allow any debounce
    await new Promise((r) => setTimeout(r, 300));
    expect(mockApi.get).not.toHaveBeenCalled();
  });

  it('hides input when maxTags reached', async () => {
    const tags = Array.from({ length: 10 }, (_, i) => `tag${i}`);
    const { SkillTagsInput } = await import('./SkillTagsInput');
    render(<SkillTagsInput {...makeProps({ tags, maxTags: 10 })} />);

    // Input should not be shown at max capacity
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('shows current count vs max in the label', async () => {
    const { SkillTagsInput } = await import('./SkillTagsInput');
    render(<SkillTagsInput {...makeProps({ tags: ['react', 'vue'], maxTags: 10 })} />);

    expect(screen.getByText('(2/10)')).toBeInTheDocument();
  });

  it('clicking a suggestion calls onChange with new tag', async () => {
    const user = userEvent.setup();
    mockApi.get.mockResolvedValue({ success: true, data: ['javascript'] });
    const onChange = vi.fn();

    const { SkillTagsInput } = await import('./SkillTagsInput');
    render(<SkillTagsInput {...makeProps({ onChange })} />);

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'jav' } });

    await waitFor(() => screen.getAllByRole('option'));

    const suggestionBtns = screen.getAllByRole('option');
    await user.click(suggestionBtns[0]);

    expect(onChange).toHaveBeenCalledWith(['javascript']);
  });
});
