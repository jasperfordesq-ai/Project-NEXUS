// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Regression (AWID pilot, Oct 2026): pressing "Translate" on a message after the
 * member's daily AI allowance was used up did nothing at all — the API's 429
 * resolved as { success: false } and the bubble treated it as an empty
 * translation. It must say why instead.
 */

import { render, screen, fireEvent, waitFor } from '@/test/test-utils';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Message } from '@/types/api';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/lib/motion', () => ({
  motion: new Proxy({}, {
    get: (_: object, prop: string) => {
      const { createElement, forwardRef } = require('react');
      return forwardRef(({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>, ref: React.Ref<unknown>) =>
        createElement(prop as string, { ...props, ref }, children)
      );
    },
  }),
  AnimatePresence: ({ children }: React.PropsWithChildren) => children,
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    hasModule: vi.fn(() => true),
    tenantPath: (path: string) => `/test${path}`,
    hasFeature: vi.fn(() => true),
  }),
}));

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { post: mockPost, get: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

vi.mock('./VoiceMessagePlayer', () => ({ VoiceMessagePlayer: () => null }));

import { MessageBubble } from './MessageBubble';

const message = {
  id: 5,
  body: 'Hola, ¿nos vemos el sábado?',
  content: 'Hola, ¿nos vemos el sábado?',
  created_at: '2026-10-30T09:00:00Z',
  sender_id: 20,
  is_own: false,
  is_read: true,
  is_deleted: false,
  is_edited: false,
  is_voice: false,
  attachments: [],
  reactions: {},
} as unknown as Message;

describe('MessageBubble translate — allowance used up', () => {
  beforeEach(() => mockPost.mockReset());

  it('says the translation limit was reached instead of doing nothing', async () => {
    mockPost.mockResolvedValue({ success: false, code: 'RATE_LIMIT', error: 'Usage limit reached' });
    render(
      <MessageBubble
        message={message}
        isOwn={false}
        showAvatar
        otherUser={{ id: 20, name: 'Ana', avatar_url: null }}
        onReact={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: /translate\.translate_to/ })[0]!);

    await waitFor(() => expect(screen.getAllByText('translate.limit_reached').length).toBeGreaterThan(0));
  });
});
