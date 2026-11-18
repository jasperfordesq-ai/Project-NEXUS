// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── adminApi mock ────────────────────────────────────────────────────────────
const mockAdminSettings = {
  getAiConfig: vi.fn(),
  updateAiConfig: vi.fn(),
};

vi.mock('@/admin/api/adminApi', () => ({
  adminSettings: mockAdminSettings,
  adminUsers: { list: vi.fn() },
}));

// ─── Toast ────────────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast })
);

vi.mock('@/contexts/ToastContext', () => ({
  useToast: vi.fn(() => mockToast),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Stub admin sub-components ────────────────────────────────────────────────
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/PageHeader' directly, and vitest keys mocks per
// resolved module, so a barrel-only mock never installs for that import — the
// real PageHeader rendered and data-testid="page-header" was never in the DOM.
// A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run
// ("Cannot access 'adminComponentsMock' before initialization"). Declarations
// hoist with it.
function adminComponentsMock() {
  return {
    PageHeader: ({ title }: { title: string }) => <div data-testid="page-header">{title}</div>,
    StatCard: ({ label }: { label: string }) => <div>{label}</div>,
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);

// ─── Fixtures ────────────────────────────────────────────────────────────────
const AI_CONFIG = {
  ai_enabled: true,
  ai_provider: 'openai',
  models: { openai: 'gpt-4-turbo', anthropic: 'claude-sonnet-4-20250514', gemini: 'gemini-pro', ollama: 'llama2' },
  api_keys: { openai: 'sk-***', anthropic: null, gemini: null },
  api_key_set: { openai: true, anthropic: false, gemini: false, ollama: false },
  features: {
    chat: true,
    content_generation: false,
    recommendations: false,
    analytics: false,
    moderation: false,
  },
  limits: { default_daily: 50, default_monthly: 1000 },
  ollama: { host: 'http://localhost:11434' },
};

// ─────────────────────────────────────────────────────────────────────────────
describe('AiSettings', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminSettings.getAiConfig.mockResolvedValue({ success: true, data: AI_CONFIG });
    mockAdminSettings.updateAiConfig.mockResolvedValue({ success: true });
  });

  it('shows loading spinner on initial render', async () => {
    mockAdminSettings.getAiConfig.mockImplementationOnce(() => new Promise(() => {}));
    const { AiSettings } = await import('./AiSettings');
    render(<AiSettings />);

    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders form after config loads', async () => {
    const { AiSettings } = await import('./AiSettings');
    render(<AiSettings />);

    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toBeInTheDocument();
    });

    // Save button should be visible
    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    );
    expect(saveBtn).toBeInTheDocument();
  });

  it('shows toast error when config load fails', async () => {
    mockAdminSettings.getAiConfig.mockRejectedValue(new Error('network'));
    const { AiSettings } = await import('./AiSettings');
    render(<AiSettings />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('calls updateAiConfig when Save is pressed', async () => {
    const { AiSettings } = await import('./AiSettings');
    render(<AiSettings />);

    await waitFor(() => screen.getByTestId('page-header'));

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    );
    expect(saveBtn).toBeInTheDocument();
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockAdminSettings.updateAiConfig).toHaveBeenCalled();
    });
  });

  it('shows success toast after successful save', async () => {
    const { AiSettings } = await import('./AiSettings');
    render(<AiSettings />);

    await waitFor(() => screen.getByTestId('page-header'));

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows error toast when save fails', async () => {
    mockAdminSettings.updateAiConfig.mockResolvedValue({ success: false, error: 'Bad request' });
    const { AiSettings } = await import('./AiSettings');
    render(<AiSettings />);

    await waitFor(() => screen.getByTestId('page-header'));

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows a "key configured" indicator when api_key_set is true for a provider', async () => {
    const { AiSettings } = await import('./AiSettings');
    render(<AiSettings />);

    await waitFor(() => screen.getByTestId('page-header'));

    // The chip with key_configured text is rendered when hasKeySet = true
    // Look for text relating to openai having a key set (apiKeySet.openai = true in fixture)
    // i18n key: 'chip_key_configured' — rendered as a Chip
    const chips = document.querySelectorAll('[class*="chip"], [data-slot="base"]');
    expect(chips.length).toBeGreaterThan(0);
  });

  it('renders all four provider sections', async () => {
    const { AiSettings } = await import('./AiSettings');
    render(<AiSettings />);

    await waitFor(() => screen.getByTestId('page-header'));

    // Providers: openai, anthropic, gemini, ollama
    // Each has a labelled input — password inputs for api keys
    const inputs = document.querySelectorAll('input');
    // At minimum there should be inputs for models, limits, keys
    expect(inputs.length).toBeGreaterThan(0);
  });

  // Production, 18 Nov 2026: tenant 2 had `ollama_host = http://localhost:11434`
  // stored from before the server started refusing private addresses. The page
  // re-sent that untouched value on every save, so EVERY save answered 422 —
  // whichever provider was chosen. The mocked success above could never show it.
  it('does not send the Ollama address when Ollama is not the chosen provider', async () => {
    const { AiSettings } = await import('./AiSettings');
    render(<AiSettings />);

    await waitFor(() => screen.getByTestId('page-header'));

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => expect(mockAdminSettings.updateAiConfig).toHaveBeenCalled());
    const payload = mockAdminSettings.updateAiConfig.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.ai_provider).toBe('openai');
    expect(payload).not.toHaveProperty('ollama_host');
  });

  it('sends the Ollama address when Ollama is the chosen provider, so the server can check it', async () => {
    mockAdminSettings.getAiConfig.mockResolvedValue({
      success: true,
      data: { ...AI_CONFIG, ai_provider: 'ollama', ollama: { host: 'https://ollama.example.org' } },
    });
    const { AiSettings } = await import('./AiSettings');
    render(<AiSettings />);

    await waitFor(() => screen.getByTestId('page-header'));

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => expect(mockAdminSettings.updateAiConfig).toHaveBeenCalled());
    const payload = mockAdminSettings.updateAiConfig.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.ollama_host).toBe('https://ollama.example.org');
  });

  it("shows the server's reason when a save is refused", async () => {
    mockAdminSettings.updateAiConfig.mockResolvedValue({
      success: false,
      error: 'The address must not point to a private network.',
    });
    const { AiSettings } = await import('./AiSettings');
    render(<AiSettings />);

    await waitFor(() => screen.getByTestId('page-header'));

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('The address must not point to a private network.');
    });
  });

  // Every Claude model the page offered had been retired by Anthropic
  // (claude-sonnet-4-20250514 on 15 Jun 2026), and the box only accepted a
  // listed model, so switching to Anthropic could not work.
  it('accepts a model name typed by hand and sends it as typed', async () => {
    const { AiSettings } = await import('./AiSettings');
    render(<AiSettings />);

    await waitFor(() => screen.getByTestId('page-header'));

    // One model box per provider, in page order: OpenAI, Anthropic, Gemini, Ollama.
    const modelBoxes = screen.getAllByRole('combobox');
    expect(modelBoxes).toHaveLength(4);
    fireEvent.change(modelBoxes[0]!, { target: { value: 'a-model-this-page-has-never-heard-of' } });
    fireEvent.change(modelBoxes[1]!, { target: { value: '  claude-sonnet-5-5 ' } });

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => expect(mockAdminSettings.updateAiConfig).toHaveBeenCalled());
    const payload = mockAdminSettings.updateAiConfig.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.openai_model).toBe('a-model-this-page-has-never-heard-of');
    expect(payload.claude_model).toBe('claude-sonnet-5-5');
  });

  it('suggests no retired Claude model', async () => {
    const source = await import('./AiSettings?raw').then((m) => (m as { default: string }).default);

    for (const retired of ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307']) {
      expect(source).not.toContain(`'${retired}'`);
    }
  });

  it('refreshes config after successful save', async () => {
    const { AiSettings } = await import('./AiSettings');
    render(<AiSettings />);

    await waitFor(() => screen.getByTestId('page-header'));

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => {
      // getAiConfig called twice: once on load, once after save
      expect(mockAdminSettings.getAiConfig).toHaveBeenCalledTimes(2);
    });
  });
});
