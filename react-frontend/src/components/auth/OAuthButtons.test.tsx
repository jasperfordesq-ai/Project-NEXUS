// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for OAuthButtons component.
 *
 * Behaviour under test:
 *  1. When `enabledProviders` is given, skip the /enabled-providers fetch and
 *     render only the listed providers.
 *  2. When `enabledProviders` is omitted, fetch /api/v2/auth/oauth/enabled-providers
 *     and render the returned providers (or nothing on empty / error).
 *  3. Clicking a provider button fetches /api/v2/auth/oauth/{provider}/redirect
 *     and navigates via window.location.href on success.
 *  4. A failed redirect response renders translated inline feedback.
 *  5. tenant_id / X-Tenant-Id forwarding.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { OAuthButtons } from './OAuthButtons';

const {
  mockCreateOAuthBrowserBinding,
  mockClearOAuthBrowserVerifier,
} = vi.hoisted(() => ({
  mockCreateOAuthBrowserBinding: vi.fn().mockResolvedValue({
    challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  }),
  mockClearOAuthBrowserVerifier: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  API_BASE: 'https://api.example.test/api',
}));

vi.mock('@/lib/oauth-browser-binding', () => ({
  createOAuthBrowserBinding: mockCreateOAuthBrowserBinding,
  clearOAuthBrowserVerifier: mockClearOAuthBrowserVerifier,
}));

// ---------------------------------------------------------------------------
// Stub window.location so we can assert href assignments without navigation
// ---------------------------------------------------------------------------
const locationMock = { href: '' };
beforeEach(() => {
  Object.defineProperty(window, 'location', {
    value: locationMock,
    writable: true,
    configurable: true,
  });
  locationMock.href = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// fetch helper — returns a mock Response-like object
// ---------------------------------------------------------------------------
function mockFetch(responses: Array<{ ok?: boolean; json: () => Promise<unknown> }>) {
  let callCount = 0;
  vi.stubGlobal('fetch', vi.fn(() => {
    const r = responses[callCount] ?? responses[responses.length - 1];
    callCount++;
    return Promise.resolve({ ok: r.ok ?? true, json: r.json });
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OAuthButtons — prop-driven providers (no fetch)', () => {
  it('renders buttons for each enabled provider', async () => {
    render(<OAuthButtons enabledProviders={['google', 'facebook']} />);
    await waitFor(() => {
      expect(screen.getByText('Continue with Google')).toBeInTheDocument();
      expect(screen.getByText('Continue with Facebook')).toBeInTheDocument();
      expect(screen.queryByText('Continue with Apple')).not.toBeInTheDocument();
    });
  });

  it('renders only google when only google is enabled', async () => {
    render(<OAuthButtons enabledProviders={['google']} />);
    await waitFor(() => {
      expect(screen.getByText('Continue with Google')).toBeInTheDocument();
      expect(screen.queryByText('Continue with Apple')).not.toBeInTheDocument();
      expect(screen.queryByText('Continue with Facebook')).not.toBeInTheDocument();
    });
  });

  it('renders nothing when enabledProviders is an empty array', () => {
    render(<OAuthButtons enabledProviders={[]} />);
    expect(screen.queryByText(/Continue with/i)).not.toBeInTheDocument();
  });

  it('renders the "Or continue with email" divider when at least one provider is visible', async () => {
    render(<OAuthButtons enabledProviders={['google']} />);
    await waitFor(() => {
      expect(screen.getByText(/Or continue with email/i)).toBeInTheDocument();
    });
  });

  it('does NOT render the "Or continue with email" divider when no providers are visible', () => {
    render(<OAuthButtons enabledProviders={[]} />);
    expect(screen.queryByText(/Or continue with email/i)).not.toBeInTheDocument();
  });
});

describe('OAuthButtons — server-fetched providers', () => {
  it('renders no provider buttons while waiting for the server response (serverProviders === null)', () => {
    // fetch never resolves → component stays in null state → no provider buttons rendered
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    render(<OAuthButtons />);
    // While pending, no "Continue with" buttons should be present
    expect(screen.queryByText(/Continue with/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Or continue with email/i)).not.toBeInTheDocument();
  });

  it('renders provider buttons returned by the server', async () => {
    mockFetch([{
      json: () => Promise.resolve({ success: true, providers: ['google', 'facebook'] }),
    }]);
    render(<OAuthButtons />);
    await waitFor(() => {
      expect(screen.getByText('Continue with Google')).toBeInTheDocument();
      expect(screen.getByText('Continue with Facebook')).toBeInTheDocument();
      expect(screen.queryByText('Continue with Apple')).not.toBeInTheDocument();
    });
  });

  it('renders nothing when server returns an empty providers array', async () => {
    mockFetch([{
      json: () => Promise.resolve({ success: true, providers: [] }),
    }]);
    render(<OAuthButtons />);
    await waitFor(() => {
      expect(screen.queryByText(/Continue with/i)).not.toBeInTheDocument();
    });
  });

  it('renders nothing when the fetch fails (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network error'))));
    render(<OAuthButtons />);
    await waitFor(() => {
      expect(screen.queryByText(/Continue with/i)).not.toBeInTheDocument();
    });
  });

  it('includes X-Tenant-Id header and tenant_id param when tenantId is set', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true, providers: [] }),
    }));
    vi.stubGlobal('fetch', fetchSpy);
    render(<OAuthButtons tenantId={42} />);
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.example.test/api/v2/auth/oauth/enabled-providers',
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Tenant-Id': '42' }),
        })
      );
    });
  });
});

describe('OAuthButtons — click → redirect flow', () => {
  it('navigates to the redirect_url on successful redirect fetch', async () => {
    // First call: enabled-providers check
    // Second call: redirect endpoint
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, providers: ['google'] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, redirect_url: 'https://accounts.google.com/o/oauth2/auth?state=abc' }),
      });
    vi.stubGlobal('fetch', fetchSpy);

    render(<OAuthButtons />);
    await waitFor(() => expect(screen.getByText('Continue with Google')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Continue with Google'));

    await waitFor(() => {
      expect(locationMock.href).toBe('https://accounts.google.com/o/oauth2/auth?state=abc');
    });
  });

  it('calls startFlow with correct URL including intent=login (default)', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, providers: ['google'] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, redirect_url: 'https://example.com' }),
      });
    vi.stubGlobal('fetch', fetchSpy);

    render(<OAuthButtons intent="login" />);
    await waitFor(() => expect(screen.getByText('Continue with Google')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Continue with Google'));

    await waitFor(() => {
      const [url] = fetchSpy.mock.calls[1] as [string, ...unknown[]];
      expect(url).toContain('/api/v2/auth/oauth/google/redirect');
      expect(url).toContain('intent=login');
      expect(url).toContain(
        'browser_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      );
    });
  });

  it('uses intent=register when prop is set', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, providers: ['google'] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, redirect_url: 'https://example.com' }),
      });
    vi.stubGlobal('fetch', fetchSpy);

    render(
      <OAuthButtons
        intent="register"
        consent={{ accepted: true, onChange: vi.fn(), label: 'I agree and I am 18 or older' }}
      />
    );
    await waitFor(() => expect(screen.getByText('Continue with Google')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Continue with Google'));

    await waitFor(() => {
      const [url] = fetchSpy.mock.calls[1] as [string, ...unknown[]];
      expect(url).toContain('intent=register');
    });
  });

  it('includes tenant_id in the redirect URL when tenantId prop is set', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, providers: ['google'] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, redirect_url: 'https://example.com' }),
      });
    vi.stubGlobal('fetch', fetchSpy);

    render(<OAuthButtons enabledProviders={['google']} tenantId={7} />);
    await waitFor(() => expect(screen.getByText('Continue with Google')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Continue with Google'));

    await waitFor(() => {
      const [url] = fetchSpy.mock.calls[0] as [string, ...unknown[]];
      expect(url).toContain('tenant_id=7');
    });
  });

  it('renders translated inline feedback instead of exposing the server message', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, providers: ['google'] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: false, message: 'OAuth is disabled for this tenant.' }),
      });
    vi.stubGlobal('fetch', fetchSpy);

    render(<OAuthButtons />);
    await waitFor(() => expect(screen.getByText('Continue with Google')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Continue with Google'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Sign-in failed. Please try again.');
      expect(screen.queryByText('OAuth is disabled for this tenant.')).not.toBeInTheDocument();
    });
    expect(mockClearOAuthBrowserVerifier).toHaveBeenCalledWith(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('renders translated inline feedback when redirect fetch fails with network error', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, providers: ['facebook'] }),
      })
      .mockRejectedValueOnce(new Error('network failure'));
    vi.stubGlobal('fetch', fetchSpy);

    render(<OAuthButtons />);
    await waitFor(() => expect(screen.getByText('Continue with Facebook')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Continue with Facebook'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Sign-in failed. Please try again.');
    });
  });
});

// E-121: signing up through a provider needs the same tick as the sign-up form
// ("I agree to the Terms and Privacy Policy, and I am 18 years of age or
// older"). The box sits beside the buttons because on phones the form's own box
// is on its last screen while the buttons are on the first.
describe('OAuthButtons — the sign-up tick-box', () => {
  function providersThenRedirect() {
    return vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, providers: ['google'] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, redirect_url: 'https://accounts.google.com/o/oauth2/auth?state=xyz' }),
      });
  }

  it('shows the box beside the buttons when signing up', async () => {
    vi.stubGlobal('fetch', providersThenRedirect());
    render(
      <OAuthButtons
        intent="register"
        consent={{ accepted: false, onChange: vi.fn(), label: 'I agree to the terms and I am 18 or older' }}
      />
    );
    expect(await screen.findByRole('checkbox', { name: /I agree to the terms and I am 18 or older/ })).toBeInTheDocument();
  });

  it('does not start a sign-up until the box is ticked, and says why', async () => {
    const fetchSpy = providersThenRedirect();
    vi.stubGlobal('fetch', fetchSpy);
    render(
      <OAuthButtons
        intent="register"
        consent={{ accepted: false, onChange: vi.fn(), label: 'I agree to the terms and I am 18 or older' }}
      />
    );
    await waitFor(() => expect(screen.getByText('Continue with Google')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Continue with Google'));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tick the box to confirm you agree to the Terms and Privacy Policy and are 18 or older.'
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1); // only the provider list, no redirect
    expect(mockCreateOAuthBrowserBinding).not.toHaveBeenCalled();
    expect(locationMock.href).toBe('');
  });

  it('sends the tick with the sign-up once the box is ticked', async () => {
    const fetchSpy = providersThenRedirect();
    vi.stubGlobal('fetch', fetchSpy);
    render(
      <OAuthButtons
        intent="register"
        consent={{ accepted: true, onChange: vi.fn(), label: 'I agree to the terms and I am 18 or older' }}
      />
    );
    await waitFor(() => expect(screen.getByText('Continue with Google')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Continue with Google'));

    await waitFor(() => {
      const [url] = fetchSpy.mock.calls[1] as [string, ...unknown[]];
      expect(url).toContain('intent=register');
      expect(url).toContain('terms_accepted=1');
    });
  });

  it('reports a tick back to the sign-up form', async () => {
    vi.stubGlobal('fetch', providersThenRedirect());
    const onChange = vi.fn();
    render(
      <OAuthButtons
        intent="register"
        consent={{ accepted: false, onChange, label: 'I agree to the terms and I am 18 or older' }}
      />
    );
    fireEvent.click(await screen.findByRole('checkbox', { name: /I agree to the terms/ }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('shows no box and sends no tick when signing in', async () => {
    const fetchSpy = providersThenRedirect();
    vi.stubGlobal('fetch', fetchSpy);
    render(<OAuthButtons intent="login" />);
    await waitFor(() => expect(screen.getByText('Continue with Google')).toBeInTheDocument());
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Continue with Google'));

    await waitFor(() => {
      const [url] = fetchSpy.mock.calls[1] as [string, ...unknown[]];
      expect(url).not.toContain('terms_accepted');
    });
  });
});
