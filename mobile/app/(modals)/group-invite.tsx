// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href, useLocalSearchParams } from 'expo-router';
import { Button as HeroButton, Card as HeroCard } from 'heroui-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { Chip } from '@/components/ui/StatusChip';
import { acceptGroupInvite, getGroupInvitePreview } from '@/lib/api/groups';
import { useApi } from '@/lib/hooks/useApi';
import { useTheme } from '@/lib/hooks/useTheme';

export default function GroupInviteScreen() {
  const { t } = useTranslation(['groups', 'common']);
  const { token = '' } = useLocalSearchParams<{ token?: string }>();
  const theme = useTheme();
  const validToken = /^[A-Za-z0-9]{40}$/.test(token);
  const previewState = useApi(() => getGroupInvitePreview(token), [token], { enabled: validToken });
  const [accepting, setAccepting] = useState(false);
  const [acceptedGroupId, setAcceptedGroupId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const preview = previewState.data;
  const alreadyMember = preview?.membership.status === 'active';

  async function accept() {
    if (accepting) return;
    setAccepting(true);
    setActionError(null);
    try { setAcceptedGroupId((await acceptGroupInvite(token)).group.id); }
    catch (error) { setActionError(error instanceof Error ? error.message : t('groups:invite_accept.error_invalid')); }
    finally { setAccepting(false); }
  }

  const openGroup = (groupId: number) => router.replace({ pathname: '/(modals)/group-detail', params: { id: String(groupId) } } as unknown as Href);
  return <ModalErrorBoundary><SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}><AppTopBar title={t('groups:invite_accept.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/groups' as Href} /><ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 16, paddingBottom: 40 }}>
    {!validToken ? <EmptyState icon="warning-outline" title={t('groups:invite_accept.title')} subtitle={t('groups:invite_accept.error_invalid')} /> : previewState.isLoading && !preview ? <LoadingSpinner /> : previewState.error || !preview ? <EmptyState icon="warning-outline" title={t('groups:invite_accept.title')} subtitle={previewState.error ?? t('groups:invite_accept.error_invalid')} actionLabel={t('groups:detail.try_again')} onAction={previewState.refresh} /> : <HeroCard className="rounded-panel"><HeroCard.Body className="items-center gap-4 p-6"><Text accessibilityRole="header" className="text-center text-2xl font-bold" style={{ color: theme.text }}>{acceptedGroupId ? t('groups:invite_accept.success_title') : preview.group.name}</Text><Chip size="sm" variant="secondary"><Chip.Label>{t('groups:members_count', { count: preview.group.member_count })}</Chip.Label></Chip><Text className="text-center text-base leading-6" style={{ color: theme.textSecondary }}>{acceptedGroupId || alreadyMember ? t('groups:invite_accept.success_description') : t('groups:invite_accept.description')}</Text>{actionError ? <Text accessibilityRole="alert" className="text-center text-sm text-danger">{actionError}</Text> : null}<HeroButton className="w-full" isDisabled={accepting} onPress={() => acceptedGroupId ? openGroup(acceptedGroupId) : alreadyMember ? openGroup(preview.group.id) : void accept()}><HeroButton.Label>{acceptedGroupId || alreadyMember ? t('groups:invite_accept.go_to_group') : accepting ? t('groups:invite_accept.accepting') : t('groups:invite_accept.accept')}</HeroButton.Label></HeroButton></HeroCard.Body></HeroCard>}
  </ScrollView></SafeAreaView></ModalErrorBoundary>;
}
