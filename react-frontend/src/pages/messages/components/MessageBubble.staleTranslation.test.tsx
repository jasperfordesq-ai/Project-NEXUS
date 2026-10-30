// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AWID audit A4 (30 Oct 2026): a bubble kept showing its auto-translation after
 * auto-translate was turned off, and kept a translation after the message was
 * edited, because it only ever accepted a new translation — never let one go.
 */

import { render, screen } from '@/test/test-utils';
import { vi, describe, it, expect } from 'vitest';
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

vi.mock('@/lib/api', () => ({ api: { post: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
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

const bubble = (msg: Message, autoTranslatedText: string | null) => (
  <MessageBubble
    message={msg}
    isOwn={false}
    showAvatar
    otherUser={{ id: 20, name: 'Ana', avatar_url: null }}
    onReact={vi.fn()}
    onEdit={vi.fn()}
    onDelete={vi.fn()}
    autoTranslatedText={autoTranslatedText}
  />
);

describe('MessageBubble — translations never outlive their source', () => {
  it('drops the auto-translation when auto-translate stops supplying one', () => {
    const { rerender } = render(bubble(message, 'Hi, shall we meet on Saturday?'));
    expect(screen.getAllByText('Hi, shall we meet on Saturday?').length).toBeGreaterThan(0);

    rerender(bubble(message, null));

    expect(screen.queryByText('Hi, shall we meet on Saturday?')).toBeNull();
    expect(screen.getAllByText('Hola, ¿nos vemos el sábado?').length).toBeGreaterThan(0);
  });

  it('drops a translation when the message is edited', () => {
    const { rerender } = render(bubble(message, 'Hi, shall we meet on Saturday?'));
    const edited = { ...message, body: 'Hola, ¿nos vemos el domingo?', content: 'Hola, ¿nos vemos el domingo?', is_edited: true } as Message;

    rerender(bubble(edited, null));

    expect(screen.queryByText('Hi, shall we meet on Saturday?')).toBeNull();
    expect(screen.getAllByText('Hola, ¿nos vemos el domingo?').length).toBeGreaterThan(0);
  });
});
