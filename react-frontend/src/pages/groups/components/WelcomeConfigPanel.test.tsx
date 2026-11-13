// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
};

vi.mock('@/contexts', () => createMockContexts({
  useToast: () => mockToast,
}));

import { api } from '@/lib/api';
import { WelcomeConfigPanel } from './WelcomeConfigPanel';

const DEFAULT_CONFIG = { enabled: false, message: '' };
const ENABLED_CONFIG = { enabled: true, message: 'Welcome to our group, {{name}}!' };

describe('WelcomeConfigPanel — access control', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing when isAdmin=false', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: DEFAULT_CONFIG });
    render(<WelcomeConfigPanel groupId={1} isAdmin={false} />);
    // Wait for any effects to settle; the component early-returns null when not admin
    // The Toast provider always injects a role="status" node so don't assert on that.
    // Instead assert no panel-specific content is shown.
    await waitFor(() => {}, { timeout: 200 });
    expect(screen.queryByText("Welcome message")).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('renders the panel when isAdmin=true', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: DEFAULT_CONFIG });
    render(<WelcomeConfigPanel groupId={1} isAdmin={true} />);
    // Eventually loads and shows the panel title
    await waitFor(() => expect(screen.getByText("Welcome message")).toBeInTheDocument());
  });
});

describe('WelcomeConfigPanel — loading state', () => {
  it('shows a loading spinner while fetching config', () => {
    // Never resolve so we see the spinner
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<WelcomeConfigPanel groupId={1} isAdmin={true} />);
    // Multiple role="status" exist (Toast provider + spinner); find the aria-busy one
    const statuses = screen.getAllByRole('status', { hidden: true });
    const loadingSpinner = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(loadingSpinner).toBeInTheDocument();
  });
});

describe('WelcomeConfigPanel — form rendering after load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ success: true, data: ENABLED_CONFIG });
  });

  it('calls GET /v2/groups/:id/welcome on mount', async () => {
    render(<WelcomeConfigPanel groupId={7} isAdmin={true} />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        '/v2/groups/7/welcome',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });
  });

  it('renders the switch with toggle label', async () => {
    render(<WelcomeConfigPanel groupId={1} isAdmin={true} />);
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /enable welcome message/i })).toBeInTheDocument();
    });
  });

  it('reflects loaded enabled state in the switch', async () => {
    render(<WelcomeConfigPanel groupId={1} isAdmin={true} />);
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: /enable welcome message/i })).toBeChecked();
    });
  });

  it('renders the message textarea with loaded message value', async () => {
    render(<WelcomeConfigPanel groupId={1} isAdmin={true} />);
    await waitFor(() => {
      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeInTheDocument();
      expect(textarea).toHaveValue('Welcome to our group, {{name}}!');
    });
  });

  it('renders the Save button', async () => {
    render(<WelcomeConfigPanel groupId={1} isAdmin={true} />);
    await waitFor(() => {
      // "save" key resolves to "Save" via the common namespace
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    });
  });

  it('textarea is disabled when enabled=false', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: DEFAULT_CONFIG });
    render(<WelcomeConfigPanel groupId={1} isAdmin={true} />);
    await waitFor(() => {
      expect(screen.getByRole('textbox')).toBeDisabled();
    });
  });

  it('textarea is enabled when enabled=true', async () => {
    render(<WelcomeConfigPanel groupId={1} isAdmin={true} />);
    await waitFor(() => {
      expect(screen.getByRole('textbox')).not.toBeDisabled();
    });
  });
});

describe('WelcomeConfigPanel — save action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ success: true, data: ENABLED_CONFIG });
  });

  it('calls PUT /v2/groups/:id/welcome with current config on save', async () => {
    vi.mocked(api.put).mockResolvedValue({ success: true, data: ENABLED_CONFIG });
    render(<WelcomeConfigPanel groupId={5} isAdmin={true} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith(
        '/v2/groups/5/welcome',
        expect.objectContaining({ enabled: true, message: 'Welcome to our group, {{name}}!' })
      );
    });
  });

  it('shows success toast on successful save', async () => {
    vi.mocked(api.put).mockResolvedValue({ success: true, data: ENABLED_CONFIG });
    render(<WelcomeConfigPanel groupId={5} isAdmin={true} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows error toast when PUT returns success:false', async () => {
    vi.mocked(api.put).mockResolvedValue({ success: false });
    render(<WelcomeConfigPanel groupId={5} isAdmin={true} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows error toast when PUT throws', async () => {
    vi.mocked(api.put).mockRejectedValue(new Error('Network error'));
    render(<WelcomeConfigPanel groupId={5} isAdmin={true} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });
});

describe('WelcomeConfigPanel — toggle enabled state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ success: true, data: DEFAULT_CONFIG });
  });

  it('toggling the switch enables the textarea', async () => {
    render(<WelcomeConfigPanel groupId={1} isAdmin={true} />);
    await waitFor(() => expect(screen.getByRole('textbox')).toBeDisabled());

    // Toggle the switch on
    fireEvent.click(screen.getByRole('switch', { name: /enable welcome message/i }));

    await waitFor(() => {
      expect(screen.getByRole('textbox')).not.toBeDisabled();
    });
  });
});

describe('WelcomeConfigPanel — graceful degradation', () => {
  it('uses defaults when API GET fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));
    render(<WelcomeConfigPanel groupId={1} isAdmin={true} />);
    // Falls through to the panel with defaults
    await waitFor(() => {
      expect(screen.getByText("Welcome message")).toBeInTheDocument();
    });
    // Textarea starts empty and disabled (enabled defaults to false)
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('uses defaults when API GET resolves with success:false', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: false,
      code: 'HTTP_500',
      error: 'Raw server copy',
    });
    render(<WelcomeConfigPanel groupId={1} isAdmin={true} />);

    await waitFor(() => expect(screen.getByText("Welcome message")).toBeInTheDocument());
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.queryByText('Raw server copy')).not.toBeInTheDocument();
  });
});
