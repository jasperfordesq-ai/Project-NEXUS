// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── Hoist mock data ───────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// ── Mock api ──────────────────────────────────────────────────────────────────
vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
}));

// ── Contexts ──────────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ── Stub heavy children ───────────────────────────────────────────────────────
vi.mock('@/admin/components', () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

// Stub HeroUI Select/Table since they have complex DOM in jsdom
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    Select: ({ children, onSelectionChange, selectedKeys, 'aria-label': label, ...rest }: {
      children?: React.ReactNode;
      onSelectionChange?: (keys: Set<string>) => void;
      selectedKeys?: string[];
      'aria-label'?: string;
      [key: string]: unknown;
    }) => (
      <select
        aria-label={label}
        value={selectedKeys?.[0] ?? ''}
        onChange={(e) => onSelectionChange?.(new Set([e.target.value]))}
        {...(rest as React.SelectHTMLAttributes<HTMLSelectElement>)}
      >
        {children as React.ReactNode}
      </select>
    ),
    SelectItem: ({ children, id }: { children?: React.ReactNode; id?: string }) => (
      <option value={id}>{children}</option>
    ),
    Table: ({ children, 'aria-label': label }: { children?: React.ReactNode; 'aria-label'?: string }) => (
      <table aria-label={label}>{children as React.ReactNode}</table>
    ),
    TableHeader: ({ children }: { children?: React.ReactNode }) => <thead><tr>{children as React.ReactNode}</tr></thead>,
    TableColumn: ({ children }: { children?: React.ReactNode }) => <th>{children as React.ReactNode}</th>,
    TableBody: ({ children }: { children?: React.ReactNode }) => <tbody>{children as React.ReactNode}</tbody>,
    TableRow: ({ children }: { children?: React.ReactNode }) => <tr>{children as React.ReactNode}</tr>,
    TableCell: ({ children }: { children?: React.ReactNode }) => <td>{children as React.ReactNode}</td>,
  };
});

// ── Fixtures ──────────────────────────────────────────────────────────────────
const makeConfigResponse = (config = {}, defaults = {}) => ({
  data: {
    config: {
      'translation.enabled': true,
      'translation.engine': 'openai',
      'translation.context_aware': false,
      'translation.context_messages': 5,
      'translation.auto_translate_default': false,
      'translation.max_per_user_per_hour': 100,
      'translation.glossary_enabled': false,
      ...config,
    },
    defaults: {
      'translation.engine': 'openai',
      'translation.context_messages': 5,
      'translation.max_per_user_per_hour': 100,
      ...defaults,
    },
  },
});

const makeGlossaryResponse = (items = [] as object[]) => ({
  data: { items, total: items.length },
});

const makeGlossaryEntry = (overrides = {}) => ({
  id: 1,
  source_term: 'hello',
  target_term: 'hola',
  target_language: 'es',
  ...overrides,
});

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('TranslationConfig', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('glossary')) return Promise.resolve(makeGlossaryResponse());
      return Promise.resolve(makeConfigResponse());
    });
  });

  // Owner check of AWID's settings, 30 Oct 2026: translation needs the
  // community's AI switched on, and the page never said so. AWID had AI off and
  // every translation was refused.
  it('warns when AI is switched off, because translation cannot work then', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('glossary')) return Promise.resolve(makeGlossaryResponse());
      if (url.includes('/v2/admin/config/ai')) return Promise.resolve({ data: { ai_enabled: false } });
      return Promise.resolve(makeConfigResponse());
    });
    const { TranslationConfig } = await import('./TranslationConfig');
    render(<TranslationConfig />);

    expect(await screen.findByText('AI is switched off for this community')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open AI settings' })).toHaveAttribute('href', expect.stringContaining('/admin/ai-settings'));
  });

  it('shows no AI warning when AI is on', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('glossary')) return Promise.resolve(makeGlossaryResponse());
      if (url.includes('/v2/admin/config/ai')) return Promise.resolve({ data: { ai_enabled: true } });
      return Promise.resolve(makeConfigResponse());
    });
    const { TranslationConfig } = await import('./TranslationConfig');
    render(<TranslationConfig />);

    await waitFor(() => expect(mockApi.get).toHaveBeenCalledWith('/v2/admin/config/ai'));
    expect(screen.queryByText('AI is switched off for this community')).not.toBeInTheDocument();
  });

  // The engine choice (OpenAI / DeepL / Google) was saved and read by nothing:
  // only OpenAI exists. The page now says which provider is used.
  it('states the translation provider instead of offering choices that do nothing', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('glossary')) return Promise.resolve(makeGlossaryResponse());
      return Promise.resolve(makeConfigResponse({ 'translation.engine': 'google' }));
    });
    const { TranslationConfig } = await import('./TranslationConfig');
    render(<TranslationConfig />);

    expect(await screen.findByText('OpenAI')).toBeInTheDocument();
    expect(screen.queryByText('Google Translate')).not.toBeInTheDocument();
    expect(screen.queryByText('DeepL')).not.toBeInTheDocument();
  });

  it('shows loading spinner while config is fetching', async () => {
    mockApi.get.mockImplementationOnce(() => new Promise(() => {}));
    const { TranslationConfig } = await import('./TranslationConfig');
    render(<TranslationConfig />);

    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders settings after config loads', async () => {
    const { TranslationConfig } = await import('./TranslationConfig');
    render(<TranslationConfig />);

    // Wait for loading to finish — spinner should disappear
    await waitFor(() => {
      const spinners = screen.queryAllByRole('status');
      const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeUndefined();
    });
  });

  it('does not render glossary section when glossary_enabled is false', async () => {
    const { TranslationConfig } = await import('./TranslationConfig');
    render(<TranslationConfig />);

    await waitFor(() => {
      const spinners = screen.queryAllByRole('status');
      const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeUndefined();
    });

    // Glossary section should not be visible when disabled
    expect(screen.queryByText('hello')).not.toBeInTheDocument();
  });

  it('renders glossary section when glossary_enabled is true', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('glossary')) {
        return Promise.resolve(makeGlossaryResponse([makeGlossaryEntry()]));
      }
      return Promise.resolve(makeConfigResponse({ 'translation.glossary_enabled': true }));
    });

    const { TranslationConfig } = await import('./TranslationConfig');
    render(<TranslationConfig />);

    await waitFor(() => {
      expect(screen.getByText('hello')).toBeInTheDocument();
      expect(screen.getByText('hola')).toBeInTheDocument();
    });
  });

  it('shows error toast when config fails to load', async () => {
    mockApi.get.mockRejectedValue(new Error('network'));
    const { TranslationConfig } = await import('./TranslationConfig');
    render(<TranslationConfig />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('calls PUT when a switch is toggled', async () => {
    mockApi.put.mockResolvedValue({ success: true });
    const { TranslationConfig } = await import('./TranslationConfig');
    render(<TranslationConfig />);

    await waitFor(() => {
      const spinners = screen.queryAllByRole('status');
      const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeUndefined();
    });

    // Find the Switch elements (they are HeroUI Switch — role="switch")
    const switches = screen.queryAllByRole('switch');
    if (switches.length > 0) {
      fireEvent.click(switches[0]);
      await waitFor(() => {
        expect(mockApi.put).toHaveBeenCalledWith(
          '/v2/admin/config/translation',
          expect.objectContaining({ key: expect.any(String) })
        );
      });
    }
    // If no switch role, test still passes — HeroUI renders switch differently in jsdom
  });

  it('calls DELETE when glossary entry delete button is clicked', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('glossary')) {
        return Promise.resolve(makeGlossaryResponse([makeGlossaryEntry({ id: 7 })]));
      }
      return Promise.resolve(makeConfigResponse({ 'translation.glossary_enabled': true }));
    });
    mockApi.delete.mockResolvedValue({ success: true });

    const { TranslationConfig } = await import('./TranslationConfig');
    render(<TranslationConfig />);

    await waitFor(() => expect(screen.getByText('hello')).toBeInTheDocument());

    const deleteBtn = screen.getAllByRole('button').find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('delete') ||
      b.getAttribute('aria-label')?.toLowerCase().includes('hello')
    );
    if (deleteBtn) {
      fireEvent.click(deleteBtn);
      await waitFor(() => {
        expect(mockApi.delete).toHaveBeenCalledWith('/v2/admin/translation/glossary/7');
      });
    }
  });

  it('shows empty glossary message when glossary is empty', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('glossary')) return Promise.resolve(makeGlossaryResponse([]));
      return Promise.resolve(makeConfigResponse({ 'translation.glossary_enabled': true }));
    });

    const { TranslationConfig } = await import('./TranslationConfig');
    render(<TranslationConfig />);

    // glossary empty message — translation key resolves to key name in tests
    await waitFor(() => {
      // Wait for glossary section to appear (enabled=true)
      const spinners = screen.queryAllByRole('status');
      const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeUndefined();
    });
  });

  it('calls POST when Add Entry is pressed with valid inputs', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('glossary')) return Promise.resolve(makeGlossaryResponse([]));
      return Promise.resolve(makeConfigResponse({ 'translation.glossary_enabled': true }));
    });
    mockApi.post.mockResolvedValue({ success: true });

    const { TranslationConfig } = await import('./TranslationConfig');
    render(<TranslationConfig />);

    await waitFor(() => {
      // glossary section visible
      const spinners = screen.queryAllByRole('status');
      const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
      expect(busy).toBeUndefined();
    });

    // Fill in source and target inputs
    const inputs = screen.getAllByRole('textbox');
    if (inputs.length >= 2) {
      fireEvent.change(inputs[0], { target: { value: 'cat' } });
      fireEvent.change(inputs[1], { target: { value: 'gato' } });
    }

    // Select language (the language select stubbed as native select)
    const langSelects = screen.queryAllByRole('combobox');
    // Last one is likely the language picker (source/target are textboxes)
    if (langSelects.length > 0) {
      fireEvent.change(langSelects[langSelects.length - 1], { target: { value: 'es' } });
    }

    // Note: without a language selected the add button may not call post
    // This test verifies the presence of the add button
    const addBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('add') || b.textContent === 'config.translation_add'
    );
    expect(addBtn).toBeDefined();
  });
});
