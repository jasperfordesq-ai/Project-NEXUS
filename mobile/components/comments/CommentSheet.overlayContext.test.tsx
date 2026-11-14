// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 Regression, 14 Nov 2026: opening a feed post's comments on Android closed the app
 * the moment the list held a comment.
 *
 * heroui-native draws its bottom sheet at a PortalHost inside HeroUINativeProvider, which
 * sits ABOVE TenantProvider, the translation-preferences provider AND ErrorBoundary in
 * app/_layout.tsx. Everything inside the sheet therefore saw no community. Each comment
 * row renders ContentTranslation, which read the community with the throwing
 * `useTenantContext` — "useTenantContext must be used within <TenantProvider>" — and,
 * being outside ErrorBoundary too, the throw took the whole app down without a report.
 *
 * The Portal mock below reproduces that: it renders the sheet's contents with the
 * community and translation preferences removed, exactly as the real host does.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { TenantContextBridge } from '@/lib/context/TenantContext';
import { UgcTranslationPreferencesBridge } from '@/lib/context/UgcTranslationPreferencesContext';
import CommentSheet from './CommentSheet';

const mockGetComments = jest.fn();

jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    BottomSheetFlatList: ({ data, renderItem, ListEmptyComponent }: {
      data: unknown[];
      renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
      ListEmptyComponent?: React.ReactNode;
    }) => (
      <View>{data.length ? data.map((item, index) => <View key={index}>{renderItem({ item, index })}</View>) : ListEmptyComponent}</View>
    ),
    BottomSheetFooter: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
  };
});

jest.mock('heroui-native', () => {
  const React = require('react');
  const { View, Text } = require('react-native');
  const { TenantContextBridge: TenantReset } = jest.requireActual('@/lib/context/TenantContext');
  const { UgcTranslationPreferencesBridge: UgcReset } = jest.requireActual('@/lib/context/UgcTranslationPreferencesContext');
  const BottomSheet = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  // The real PortalHost lives above every app provider: the contents lose them.
  BottomSheet.Portal = ({ children }: { children: React.ReactNode }) => (
    <TenantReset value={null}>
      <UgcReset value={{ identity: '', automatic: false, target: null }}>
        <View>{children}</View>
      </UgcReset>
    </TenantReset>
  );
  BottomSheet.Overlay = () => null;
  BottomSheet.Content = ({ children, footerComponent }: {
    children: React.ReactNode;
    footerComponent?: (props: object) => React.ReactNode;
  }) => <View>{children}{footerComponent?.({})}</View>;
  BottomSheet.Title = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  BottomSheet.Close = () => null;
  return {
    BottomSheet,
    Spinner: () => null,
    Surface: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
    useBottomSheetAwareHandlers: () => ({ onBlur: jest.fn(), onFocus: jest.fn() }),
  };
});

// Stands in for ContentTranslation and reports what it can see. Reading the community
// with the THROWING hook is deliberate: before the fix this is exactly what crashed.
jest.mock('@/components/ContentTranslation', () => {
  const { Text } = require('react-native');
  const { useTenantContext } = jest.requireActual('@/lib/context/TenantContext');
  const { useUgcTranslationPreferences: usePrefs } = jest.requireActual('@/lib/context/UgcTranslationPreferencesContext');
  return function ProbeTranslation() {
    const { tenant } = useTenantContext();
    const preferences = usePrefs();
    return <Text testID="translation-probe">{`${tenant?.slug}|${preferences.identity}|${preferences.target}`}</Text>;
  };
});

jest.mock('@/components/ui/NativeButton', () => {
  const { Pressable } = require('react-native');
  return { Button: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => <Pressable onPress={onPress}>{children}</Pressable> };
});
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/AccentIcon', () => 'View');
jest.mock('@/components/ui/ErrorState', () => 'View');
jest.mock('@/components/ui/RefreshFailedNotice', () => () => null);
jest.mock('@/components/ui/TextArea', () => 'TextInput');
jest.mock('@/components/ui/ActionSheet', () => () => null);
jest.mock('@/components/ui/useConfirm', () => ({ useConfirm: () => ({ confirm: jest.fn(), confirmDialog: null }) }));
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: jest.fn() }) }));
jest.mock('@/components/ui/useDeferredBottomSheetState', () => ({
  useDeferredBottomSheetState: (visible: boolean) => ({ mounted: visible, open: visible, shouldHonorClose: () => true }),
}));
jest.mock('@/lib/api/comments', () => ({
  ...jest.requireActual('@/lib/api/comments'),
  getComments: (...args: unknown[]) => mockGetComments(...args),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ bg: '#000', text: '#fff', textMuted: '#aaa', textSecondary: '#ccc' }),
}));
jest.mock('@/lib/ui/rootInsets', () => ({ useBottomInset: () => 0 }));
jest.mock('@/lib/haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: {},
  NotificationFeedbackType: {},
}));

const strings = {
  title: 'Comments', placeholder: 'Write', empty: 'None', loadFailed: 'Load failed', submitFailed: 'Send failed',
  actionFailedTitle: 'Failed', send: 'Send', authorFallback: 'Member', reply: 'Reply', replyingTo: 'Replying to {name}',
  edit: 'Edit', editing: 'Editing', delete: 'Delete', deleteConfirmTitle: 'Delete?', deleteConfirmMessage: 'Sure?',
  edited: '(edited)', cancel: 'Cancel', like: 'Like', editFailed: 'Edit failed', deleteFailed: 'Delete failed',
  reactionFailed: 'Reaction failed',
};

const tenantValue = {
  tenant: { id: 2, slug: 'hour-timebank', branding: { primary_color: '#123456' } },
} as unknown as Parameters<typeof TenantContextBridge>[0]['value'];

describe('CommentSheet inside an overlay host', () => {
  beforeEach(() => {
    mockGetComments.mockResolvedValue({
      data: {
        comments: [{
          id: 7, content: 'Hello from the test', created_at: '2026-11-14T10:00:00Z', edited: false,
          is_own: false, author: { id: 3, name: 'Sam', avatar: null }, reactions: {}, user_reactions: [], replies: [],
        }],
        count: 1,
      },
    });
  });

  it('opens with a comment in it, and its rows still see the community and translation preferences', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <TenantContextBridge value={tenantValue}>
          <UgcTranslationPreferencesBridge value={{ identity: '2:674', automatic: true, target: 'es' }}>
            <CommentSheet visible targetType="post" targetId={183} strings={strings} onClose={jest.fn()} />
          </UgcTranslationPreferencesBridge>
        </TenantContextBridge>,
      );
    });

    const probe = tree.root.findByProps({ testID: 'translation-probe' });
    expect(probe.props.children).toBe('hour-timebank|2:674|es');
  });
});

