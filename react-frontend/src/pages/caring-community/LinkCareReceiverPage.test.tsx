// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── Stable mock references (CRITICAL: never inline objects inside factory fns) ──
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };
const mockTenant = { tenant: { id: 2, name: 'Test', slug: 'test' }, tenantPath: (p: string) => `/test${p}`, hasFeature: vi.fn(() => true), hasModule: vi.fn(() => true) };
const mockNavigate = vi.fn();

// The page uses the DEFAULT import for api.post while useApi uses the NAMED export —
// back both with the SAME object so configuring one configures both.
vi.mock('@/lib/api', () => {
  const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };
  return { default: apiMock, api: apiMock };
});

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => mockTenant,
  })
);

// ── Lazy import AFTER mocks ──
import { LinkCareReceiverPage } from './LinkCareReceiverPage';
// The page uses the NAMED `api` export (directly / via useApi) — configure that one.
import { api } from '@/lib/api';

const mockedApi = api as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

describe('LinkCareReceiverPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: user search returns nothing
    mockedApi.get.mockResolvedValue({ success: true, data: [] });
  });

  it('renders the page heading', () => {
    render(<LinkCareReceiverPage />);
    // The title key resolves to its key string via the real i18n with fallback
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('renders the member search input', () => {
    render(<LinkCareReceiverPage />);
    // There should be a text input for searching members
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBeGreaterThan(0);
  });

  it('submit button is disabled when no member is selected', () => {
    render(<LinkCareReceiverPage />);
    const submitBtn = screen.getByRole('button', { name: /link|caregiver|care_receiver/i });
    // Primary submit should be the disabled one (no selection yet)
    expect(submitBtn).toBeDisabled();
  });

  it('shows search results when query >= 2 chars and API returns users', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url.includes('/v2/users/search')) {
        return Promise.resolve({
          success: true,
          data: [
            { id: 10, name: 'Alice Smith', avatar_url: null },
            { id: 11, name: 'Bob Jones', avatar_url: null },
          ],
        });
      }
      return Promise.resolve({ success: true, data: [] });
    });

    render(<LinkCareReceiverPage />);
    const searchInputs = screen.getAllByRole('textbox');
    const searchInput = searchInputs[0];
    fireEvent.change(searchInput, { target: { value: 'Al' } });

    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
  });

  // 🔴 REGRESSION GUARD — the shape the real endpoint actually returns.
  //
  // `/v2/users/search` answers `{ data: { items: [...] } }`. `api.get()` unwraps
  // one level, so the component receives `{ items: [...] }`, an OBJECT. The page
  // read `.length` on it, got `undefined`, and rendered "No matching members
  // found" for every query — making the caregiver-link form impossible to
  // complete, because no care recipient could be selected.
  //
  // Every other test in this file mocks `data: [ ... ]`, a bare array the real
  // endpoint never returns, so the whole suite passed while the page was broken
  // in the browser. This case pins the real shape so that cannot recur.
  it('shows search results for the paginated { items } shape the API really returns', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url.includes('/v2/users/search')) {
        return Promise.resolve({
          success: true,
          data: { items: [{ id: 900027, name: 'E2E UserB', avatar_url: null }] },
        });
      }
      return Promise.resolve({ success: true, data: [] });
    });

    render(<LinkCareReceiverPage />);
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'UserB' } });

    await waitFor(() => {
      expect(screen.getByText('E2E UserB')).toBeInTheDocument();
    });
  });

  it('does NOT show search results when query is fewer than 2 chars', async () => {
    render(<LinkCareReceiverPage />);
    const searchInputs = screen.getAllByRole('textbox');
    fireEvent.change(searchInputs[0], { target: { value: 'A' } });
    // API should not have been called for a 1-char query
    await waitFor(() => {
      expect(mockedApi.get).not.toHaveBeenCalled();
    });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('shows "no results" state when search returns empty', async () => {
    mockedApi.get.mockResolvedValue({ success: true, data: [] });

    render(<LinkCareReceiverPage />);
    const searchInputs = screen.getAllByRole('textbox');
    fireEvent.change(searchInputs[0], { target: { value: 'xyz' } });

    await waitFor(() => {
      // The API is called — no_search_results text should appear
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  it('calls POST endpoint on submit with correct payload', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url.includes('/v2/users/search')) {
        return Promise.resolve({
          success: true,
          data: [{ id: 42, name: 'Carol Doe', avatar_url: null }],
        });
      }
      return Promise.resolve({ success: true, data: [] });
    });
    mockedApi.post.mockResolvedValue({ success: true });

    render(<LinkCareReceiverPage />);
    const searchInputs = screen.getAllByRole('textbox');
    fireEvent.change(searchInputs[0], { target: { value: 'Car' } });

    // Select the result. The item is a React Aria Button (onPress) — drive it via
    // pointer events on the button element, not a click on the inner text span.
    const carol = (await screen.findByText('Carol Doe')).closest('button')!;
    await userEvent.click(carol);

    const form = document.querySelector('form');
    expect(form).toBeInTheDocument();
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith(
        '/v2/caring-community/caregiver/links',
        expect.objectContaining({ cared_for_id: 42 })
      );
    });
  });

  it('shows error toast when submit fails', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url.includes('/v2/users/search')) {
        return Promise.resolve({
          success: true,
          data: [{ id: 5, name: 'Dave Brown', avatar_url: null }],
        });
      }
      return Promise.resolve({ success: true, data: [] });
    });
    mockedApi.post.mockResolvedValue({ success: false, error: 'Server error' });

    render(<LinkCareReceiverPage />);
    const searchInputs = screen.getAllByRole('textbox');
    fireEvent.change(searchInputs[0], { target: { value: 'Da' } });

    const dave = (await screen.findByText('Dave Brown')).closest('button')!;
    await userEvent.click(dave);

    const form = document.querySelector('form');
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockToast.showToast).toHaveBeenCalledWith(expect.any(String), 'error');
    });
  });

  it('navigates on successful link creation', async () => {
    mockedApi.get.mockImplementation((url: string) => {
      if (url.includes('/v2/users/search')) {
        return Promise.resolve({
          success: true,
          data: [{ id: 7, name: 'Eve Taylor', avatar_url: null }],
        });
      }
      return Promise.resolve({ success: true, data: [] });
    });
    mockedApi.post.mockResolvedValue({ success: true });

    render(<LinkCareReceiverPage />);
    const searchInputs = screen.getAllByRole('textbox');
    fireEvent.change(searchInputs[0], { target: { value: 'Ev' } });

    const eve = (await screen.findByText('Eve Taylor')).closest('button')!;
    await userEvent.click(eve);

    const form = document.querySelector('form');
    fireEvent.submit(form!);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/caring-community/caregiver'),
        expect.objectContaining({ replace: true })
      );
    });
  });
});
