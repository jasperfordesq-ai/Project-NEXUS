// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock api ────────────────────────────────────────────────────────────────
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

// ─── Toast / Auth / Tenant ───────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

// Also mock direct import path used by SkillSelector
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => mockToast,
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Stub HeroUI components that don't work well in jsdom ────────────────────
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
      isOpen ? <div role="dialog" aria-label="Dialog" data-testid="skill-modal">{children}</div> : null,
    ModalContent: ({ children }: { children: ((onClose: () => void) => React.ReactNode) | React.ReactNode }) => (
      <div>{typeof children === 'function' ? children(() => {}) : children}</div>
    ),
    ModalHeader: ({ children }: { children: React.ReactNode }) => <div data-testid="modal-header">{children}</div>,
    ModalHeading: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
    ModalBody: ({ children }: { children: React.ReactNode }) => <div data-testid="modal-body">{children}</div>,
    ModalFooter: ({ children }: { children: React.ReactNode }) => <div data-testid="modal-footer">{children}</div>,
    Select: ({ label, children }: { label?: string; children: React.ReactNode; [key: string]: unknown }) => (
      <div data-testid="select-wrapper">
        {label && <label>{label}</label>}
        <select>{children}</select>
      </div>
    ),
    SelectItem: ({ children, key: _k, id, ...rest }: { children: React.ReactNode; key?: string; id?: string; [key: string]: unknown }) => (
      <option value={id} {...(rest as Record<string, unknown>)}>{children}</option>
    ),
    Button: ({ children, onPress, isLoading, isDisabled, startContent, 'aria-label': al, ...rest }: {
      children?: React.ReactNode;
      onPress?: () => void;
      isLoading?: boolean;
      isDisabled?: boolean;
      startContent?: React.ReactNode;
      'aria-label'?: string;
      [key: string]: unknown;
    }) => (
      <button
        onClick={onPress}
        disabled={isDisabled || isLoading}
        aria-label={al}
        {...(rest as Record<string, unknown>)}
      >
        {startContent}{children}
      </button>
    ),
    Chip: ({ children }: { children: React.ReactNode }) => <span data-testid="chip">{children}</span>,
    Spinner: ({ size: _s }: { size?: string }) => <span data-testid="spinner" />,
    Input: ({ value, onChange, placeholder, 'aria-label': al, startContent: _sc, endContent: _ec, ...rest }: {
      value?: string;
      onChange?: React.ChangeEventHandler<HTMLInputElement>;
      placeholder?: string;
      'aria-label'?: string;
      startContent?: React.ReactNode;
      endContent?: React.ReactNode;
      [key: string]: unknown;
    }) => (
      <input
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={al}
        {...(rest as Record<string, unknown>)}
      />
    ),
    useDisclosure: () => {
      const [isOpen, setIsOpen] = React.useState(false);
      return { isOpen, onOpen: () => setIsOpen(true), onClose: () => setIsOpen(false) };
    },
  };
});

// ─── Fixtures ────────────────────────────────────────────────────────────────
const makeSkill = (overrides = {}) => ({
  id: 1,
  skill_name: 'JavaScript',
  category_name: 'Technology',
  category_id: 3,
  proficiency_level: 'intermediate' as const,
  endorsement_count: 2,
  created_at: '2025-01-01T00:00:00Z',
  ...overrides,
});

const makeCategory = (overrides = {}) => ({
  id: 3,
  name: 'Technology',
  slug: 'technology',
  icon: '💻',
  skills_count: 15,
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('SkillSelector', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: categories load, no search results
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/v2/skills/categories')) {
        return Promise.resolve({ success: true, data: [makeCategory()] });
      }
      if (url.includes('/v2/skills/search')) {
        return Promise.resolve({ success: true, data: [] });
      }
      return Promise.resolve({ success: false, data: null });
    });
  });

  it('renders existing user skills as chips', async () => {
    const { SkillSelector } = await import('./SkillSelector');
    const skills = [makeSkill(), makeSkill({ id: 2, skill_name: 'Python', proficiency_level: 'advanced' })];
    render(<SkillSelector userSkills={skills} onSkillsChange={vi.fn()} />);

    expect(screen.getByText('JavaScript')).toBeInTheDocument();
    expect(screen.getByText('Python')).toBeInTheDocument();
  });

  it('shows empty state message when no skills', async () => {
    const { SkillSelector } = await import('./SkillSelector');
    render(<SkillSelector userSkills={[]} onSkillsChange={vi.fn()} />);

    // Italic placeholder text for no skills
    expect(document.body.textContent).toMatch(/no.*skill|skill.*no/i);
  });

  it('renders Add Skill button', async () => {
    const { SkillSelector } = await import('./SkillSelector');
    render(<SkillSelector userSkills={[]} onSkillsChange={vi.fn()} />);
    const addBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('add') && b.textContent?.toLowerCase().includes('skill')
    );
    expect(addBtn).toBeTruthy();
  });

  it('opens modal when Add Skill button is clicked', async () => {
    const { SkillSelector } = await import('./SkillSelector');
    render(<SkillSelector userSkills={[]} onSkillsChange={vi.fn()} />);

    const addBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('add') && b.textContent?.toLowerCase().includes('skill')
    );
    if (addBtn) fireEvent.click(addBtn);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('modal contains search input', async () => {
    const { SkillSelector } = await import('./SkillSelector');
    render(<SkillSelector userSkills={[]} onSkillsChange={vi.fn()} />);

    const addBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('add') && b.textContent?.toLowerCase().includes('skill')
    );
    if (addBtn) fireEvent.click(addBtn);

    await waitFor(() => screen.getByRole('dialog'));

    const input = document.querySelector('input');
    expect(input).toBeTruthy();
  });

  it('calls search API when typing in modal', async () => {
    const { SkillSelector } = await import('./SkillSelector');
    render(<SkillSelector userSkills={[]} onSkillsChange={vi.fn()} />);

    const addBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('add') && b.textContent?.toLowerCase().includes('skill')
    );
    if (addBtn) fireEvent.click(addBtn);
    await waitFor(() => screen.getByRole('dialog'));

    const input = document.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'java' } });

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith(
        expect.stringContaining('/v2/skills/search')
      );
    });
  });

  it('displays search results in modal', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/v2/skills/categories')) {
        return Promise.resolve({ success: true, data: [makeCategory()] });
      }
      if (url.includes('/v2/skills/search')) {
        return Promise.resolve({
          success: true,
          data: [{ skill_name: 'JavaScript', category_id: 3, user_count: 4 }],
        });
      }
      return Promise.resolve({ success: false, data: null });
    });

    const { SkillSelector } = await import('./SkillSelector');
    render(<SkillSelector userSkills={[]} onSkillsChange={vi.fn()} />);

    const addBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('add') && b.textContent?.toLowerCase().includes('skill')
    );
    if (addBtn) fireEvent.click(addBtn);
    await waitFor(() => screen.getByRole('dialog'));

    const input = document.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'java' } });

    await waitFor(() => {
      expect(screen.getByText('JavaScript')).toBeInTheDocument();
    });
  });

  it('calls POST /v2/users/me/skills after selecting a result', async () => {
    // Seed a search result so we can click it (sets selectedSkill)
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/v2/skills/categories')) {
        return Promise.resolve({ success: true, data: [makeCategory()] });
      }
      if (url.includes('/v2/skills/search')) {
        return Promise.resolve({
          success: true,
          data: [{ skill_name: 'Cooking', category_id: null, user_count: 2 }],
        });
      }
      return Promise.resolve({ success: false, data: null });
    });
    mockApi.post.mockResolvedValue({ success: true, data: {} });
    const onSkillsChange = vi.fn();

    const { SkillSelector } = await import('./SkillSelector');
    render(<SkillSelector userSkills={[]} onSkillsChange={onSkillsChange} />);

    // Open modal
    const addBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('add') && b.textContent?.toLowerCase().includes('skill')
    );
    if (addBtn) fireEvent.click(addBtn);
    await waitFor(() => screen.getByRole('dialog'));

    // Type in search
    const input = document.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Cooking' } });

    // Results follow the ARIA combobox pattern: select the option itself rather
    // than looking for a nested button that the component does not render.
    const resultOption = await screen.findByRole('option', { name: /Cooking/i });
    fireEvent.mouseDown(resultOption);

    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /Cooking/i })).not.toBeInTheDocument();
    });

    // Now submit via the modal footer button
    await waitFor(() => {
      const modalFooter = screen.getByTestId('modal-footer');
      const submitBtn = Array.from(modalFooter.querySelectorAll('button')).find(
        (b) => !b.disabled && b.textContent?.toLowerCase().includes('add')
      );
      expect(submitBtn).toBeTruthy();
    });

    const modalFooter = screen.getByTestId('modal-footer');
    const submitBtn = Array.from(modalFooter.querySelectorAll('button')).find(
      (b) => !b.disabled && b.textContent?.toLowerCase().includes('add')
    );
    if (submitBtn) fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        '/v2/users/me/skills',
        expect.objectContaining({ skill_name: 'Cooking', is_offering: true, is_requesting: false })
      );
    });
  });

  it('can record a skill the member wants help with, not just one they offer', async () => {
    mockApi.post.mockResolvedValue({ success: true, data: {} });

    const { SkillSelector } = await import('./SkillSelector');
    render(<SkillSelector userSkills={[]} onSkillsChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Add Skill/i }));
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.change(document.querySelector('input') as HTMLInputElement, { target: { value: 'Piano lessons' } });

    // Untick "Offers", tick "Wants"
    fireEvent.click(screen.getByRole('checkbox', { name: 'Offers' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Wants' }));

    const footer = screen.getByTestId('modal-footer');
    const submit = Array.from(footer.querySelectorAll('button')).find((b) => b.textContent?.includes('Add Skill'));
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit!);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        '/v2/users/me/skills',
        expect.objectContaining({ skill_name: 'Piano lessons', is_offering: false, is_requesting: true })
      );
    });
  });

  it('shows a "Wants" marker on skills the member wants help with', async () => {
    const { SkillSelector } = await import('./SkillSelector');
    render(
      <SkillSelector
        userSkills={[makeSkill({ id: 7, skill_name: 'Piano', is_offering: 0, is_requesting: 1 })]}
        onSkillsChange={vi.fn()}
      />
    );

    expect(screen.getByText('Piano')).toBeInTheDocument();
    expect(screen.getByText('Wants')).toBeInTheDocument();
  });

  it('calls DELETE endpoint when remove button is clicked', async () => {
    mockApi.delete.mockResolvedValue({ success: true });
    const onSkillsChange = vi.fn();

    const { SkillSelector } = await import('./SkillSelector');
    const skills = [makeSkill({ id: 99, skill_name: 'Fortran' })];
    render(<SkillSelector userSkills={skills} onSkillsChange={onSkillsChange} />);

    const removeBtn = screen.getAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('fortran') ||
             b.getAttribute('aria-label')?.toLowerCase().includes('remove')
    );
    if (removeBtn) fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(mockApi.delete).toHaveBeenCalledWith('/v2/users/me/skills/99');
    });
  });

  it('shows success toast after skill removed', async () => {
    mockApi.delete.mockResolvedValue({ success: true });
    const onSkillsChange = vi.fn();

    const { SkillSelector } = await import('./SkillSelector');
    const skills = [makeSkill({ id: 7, skill_name: 'COBOL' })];
    render(<SkillSelector userSkills={skills} onSkillsChange={onSkillsChange} />);

    const removeBtn = screen.getAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('remove') ||
             b.getAttribute('aria-label')?.toLowerCase().includes('cobol')
    );
    if (removeBtn) fireEvent.click(removeBtn);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('loads categories from API on mount', async () => {
    const { SkillSelector } = await import('./SkillSelector');
    render(<SkillSelector userSkills={[]} onSkillsChange={vi.fn()} />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/skills/categories');
    });
  });
});
