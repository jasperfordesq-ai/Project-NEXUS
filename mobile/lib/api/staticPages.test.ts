// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/lib/constants', () => ({ API_V2: '/api/v2' }));

import { api } from '@/lib/api/client';
import { submitContactMessage } from './staticPages';

describe('submitContactMessage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends a stable retry key in the body and header', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { message: 'Sent' } });
    await submitContactMessage({
      name: ' Aoife Ryan ',
      email: ' aoife@example.org ',
      subject: ' Account Help ',
      message: ' Please help. ',
    }, 'mobile-contact-key');

    expect(api.post).toHaveBeenCalledWith('/api/v2/contact', {
      name: 'Aoife Ryan',
      email: 'aoife@example.org',
      subject: 'Account Help',
      message: 'Please help.',
      idempotency_key: 'mobile-contact-key',
    }, { headers: { 'Idempotency-Key': 'mobile-contact-key' } });
  });
});
