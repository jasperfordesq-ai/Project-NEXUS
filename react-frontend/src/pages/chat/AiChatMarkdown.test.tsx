// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';

vi.mock('@/contexts', () => ({
  useTenant: vi.fn(() => ({
    tenantPath: (p: string) => (p.startsWith('/hour-timebank/') ? p : `/hour-timebank${p}`),
  })),
}));

import { AiChatMarkdown, internalPath } from './AiChatMarkdown';

describe('internalPath', () => {
  it('keeps paths on this site inside the app', () => {
    expect(internalPath('/listings/create')).toBe('/listings/create');
    expect(internalPath(`${window.location.origin}/help?x=1#y`)).toBe('/help?x=1#y');
  });

  it('leaves other addresses alone', () => {
    expect(internalPath('https://example.org/page')).toBeNull();
    expect(internalPath('//example.org/page')).toBeNull();
    expect(internalPath('mailto:team@example.org')).toBeNull();
    expect(internalPath(undefined)).toBeNull();
  });
});

describe('AiChatMarkdown', () => {
  it('shows lists and bold text instead of their symbols', () => {
    render(<AiChatMarkdown content={'Steps:\n\n1. Open **Wallet**\n2. Press **Send**\n\n- a tip'} />);
    expect(screen.getAllByRole('list')).toHaveLength(2);
    expect(screen.getByText('Wallet').tagName).toBe('STRONG');
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });

  it('adds the community address to links on this site, once', () => {
    render(<AiChatMarkdown content={'[Create](/listings/create) or [Help](/hour-timebank/help)'} />);
    expect(screen.getByRole('link', { name: 'Create' })).toHaveAttribute('href', '/hour-timebank/listings/create');
    expect(screen.getByRole('link', { name: 'Help' })).toHaveAttribute('href', '/hour-timebank/help');
  });

  it('opens other websites in a new tab', () => {
    render(<AiChatMarkdown content={'[Citizens Information](https://www.citizensinformation.ie/)'} />);
    const link = screen.getByRole('link', { name: 'Citizens Information' });
    expect(link).toHaveAttribute('href', 'https://www.citizensinformation.ie/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('never makes an unsafe or bare-word link', () => {
    render(<AiChatMarkdown content={'[bad](javascript:alert(1)) and [data](data:text/html,hi) and [word](listings)'} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('bad')).toBeInTheDocument();
    expect(screen.getByText('word')).toBeInTheDocument();
  });

  it('does not render HTML or load pictures from an answer', () => {
    const { container } = render(
      <AiChatMarkdown content={'<img src="https://tracker.example/x.png" onerror="alert(1)"> ![a picture](https://tracker.example/y.png) <b>raw</b>'} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText('a picture')).toBeInTheDocument();
  });
});
