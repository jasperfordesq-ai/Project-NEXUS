// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 Regression, 14 Nov 2026. Overlays (bottom sheets, dialogs) render above TenantProvider
 * and ErrorBoundary, so a Translate control inside one sees no community. It used to read
 * the community with the throwing hook, which closed the whole Android app when a comment
 * panel opened. With no community it must simply render — the REAL TenantContext module
 * is used here, with no provider, on purpose.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import ContentTranslation from './ContentTranslation';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
jest.mock('@/lib/hooks/useTheme', () => ({ useTheme: () => ({ text: '#111', textMuted: '#444', textSecondary: '#333' }) }));
jest.mock('@/lib/api/client', () => ({ api: { post: jest.fn().mockResolvedValue({ data: null }) } }));
jest.mock('@/components/ui/NativeButton', () => {
  const { Pressable, Text } = require('react-native');
  const Button = ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => <Pressable onPress={onPress}>{children}</Pressable>;
  Button.Label = Text;
  return { Button };
});

it('renders without a community instead of throwing', async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<ContentTranslation contentType="comment" contentId={7} fields={{ body: 'Bonjour à tous, merci pour votre aide' }} />);
  });
  // A French comment for an English reader: the control is offered, not crashed.
  expect(tree.root.findAllByProps({ children: 'ugcTranslation.translate' }).length).toBeGreaterThan(0);
});
