// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The group chat route must exist, sit with the other protected message
 * routes, carry the same `messages` module gate, and render the group page —
 * never the one-to-one ConversationPage, whose id is a member's user id.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, '../../routes/AppRoutes.tsx'), 'utf8');
const protectedStart = source.indexOf('{/* Protected Routes */}');
const protectedEnd = source.indexOf('{/* Admin Panel', protectedStart);
const protectedSource = source.slice(protectedStart, protectedEnd);

function routeBlock(routePath: string): string {
  const start = protectedSource.indexOf(`<Route path="${routePath}" element={`);
  if (start === -1) return '';
  const end = protectedSource.indexOf('} />', start);
  return protectedSource.slice(start, end);
}

describe('group chat route', () => {
  it('is a protected route gated on the messages module that renders GroupConversationPage', () => {
    const block = routeBlock('messages/group/:id');
    expect(block).not.toBe('');
    expect(block).toContain('<FeatureGate module="messages" redirect="/dashboard">');
    expect(block).toContain('<GroupConversationPage />');
    expect(block).not.toContain('<ConversationPage />');
  });

  it('lazy-loads the group page module', () => {
    expect(source).toContain("lazyWithRetry(() => import('@/pages/messages/GroupConversationPage'))");
  });
});
