// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AWID re-audit R1/R2 (30 Oct 2026, independent probes by Codex, kept as
 * regressions): the manual Translate cache was keyed by message and language
 * only, so an edited message re-showed the old translation; and a reply still
 * in flight when the message was edited was applied to the edited message.
 */

import { render, screen, fireEvent, waitFor, act } from '@/test/test-utils';
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

import { api } from '@/lib/api';
const edited = { ...message, body: 'Hola, domingo', content: 'Hola, domingo', is_edited: true } as Message;
const translate = () => fireEvent.click(screen.getAllByRole('button', { name: /translate\.translate_to/ })[0]!);

describe('MessageBubble — manual translation follows the current source', () => {
  beforeEach(() => vi.mocked(api.post).mockReset());

  it('requests a fresh manual translation after the same message is edited', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true, data: { translated_text: 'Meet Saturday' } });
    const { rerender } = render(bubble(message, null));
    translate();
    await waitFor(() => expect(screen.getAllByText('Meet Saturday').length).toBeGreaterThan(0));
    rerender(bubble(edited, null));
    expect(screen.queryByText('Meet Saturday')).toBeNull();
    vi.mocked(api.post).mockResolvedValueOnce({ success: true, data: { translated_text: 'Meet Sunday' } });
    translate();
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText('Meet Sunday').length).toBeGreaterThan(0);
  });

  it('ignores a pending manual response after its source message changes', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(api.post).mockReturnValueOnce(
      new Promise((r) => { resolve = r as (value: unknown) => void; }) as ReturnType<typeof api.post>,
    );
    const { rerender } = render(bubble(message, null));
    translate();
    expect(api.post).toHaveBeenCalledTimes(1);
    rerender(bubble(edited, null));
    await act(async () => { resolve({ success: true, data: { translated_text: 'Meet Saturday' } }); });
    expect(screen.queryByText('Meet Saturday')).toBeNull();
    expect(screen.getAllByText('Hola, domingo').length).toBeGreaterThan(0);
  });

  it('requests a fresh translation when a voice message transcript changes', async () => {
    const voice = { ...message, body: '', content: '', is_voice: true, audio_url: '/a.webm', transcript: 'Nos vemos el sábado', transcript_language: 'es' } as unknown as Message;
    vi.mocked(api.post).mockResolvedValueOnce({ success: true, data: { translated_text: 'See you Saturday' } });
    const { rerender } = render(bubble(voice, null));
    translate();
    await waitFor(() => expect(screen.getAllByText('See you Saturday').length).toBeGreaterThan(0));

    rerender(bubble({ ...voice, transcript: 'Nos vemos el domingo' } as unknown as Message, null));
    expect(screen.queryByText('See you Saturday')).toBeNull();

    vi.mocked(api.post).mockResolvedValueOnce({ success: true, data: { translated_text: 'See you Sunday' } });
    translate();
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText('See you Sunday').length).toBeGreaterThan(0);
  });
});
