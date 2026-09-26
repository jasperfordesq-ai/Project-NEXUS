// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type Href, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Card } from 'heroui-native';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { Button } from '@/components/ui/NativeButton';
import { withRouteGate } from '@/components/withRouteGate';
import { useConfirm } from '@/components/ui/useConfirm';
import { ApiResponseError } from '@/lib/api/client';
import { isRefusalStatus } from '@/lib/api/refusal';
import {
  createGroupInviteLink,
  getGroupInvites,
  revokeGroupInvite,
  sendGroupEmailInvites,
  type GroupEmailInviteResult,
  type GroupPendingInvite,
} from '@/lib/api/groups';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uncertain = (error: unknown) => !(error instanceof ApiResponseError) || error.status === 0 || error.status >= 500;

export function parseGroupInviteEmails(value: string): { emails: string[]; invalid: string[] } {
  const candidates = [...new Set(value.split(/[\s,;]+/).map(item => item.trim().toLowerCase()).filter(Boolean))];
  return { emails: candidates.filter(item => EMAIL.test(item)), invalid: candidates.filter(item => !EMAIL.test(item)) };
}

function Workspace({ groupId }: { groupId: number }) {
  const { t } = useTranslation(['groups', 'common']);
  const genericError = t('common:errors.generic');
  const { confirm, confirmDialog } = useConfirm();
  const mounted = useRef(true);
  const actionInFlight = useRef(false);
  const [invites, setInvites] = useState<GroupPendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [emails, setEmails] = useState('');
  const [message, setMessage] = useState('');
  const [expiry, setExpiry] = useState('14');
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [results, setResults] = useState<GroupEmailInviteResult[]>([]);

  useEffect(() => () => { mounted.current = false; }, []);
  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    setLoading(true); setLoadError(null); setLoadStatus(null);
    try { const next = await getGroupInvites(groupId); if (mounted.current) setInvites(next); }
    catch (error) {
      if (!mounted.current) return;
      setInvites([]); setLoadError(error instanceof ApiResponseError ? error.message : genericError);
      setLoadStatus(error instanceof ApiResponseError ? error.status : null);
    } finally { if (mounted.current) setLoading(false); }
  }, [genericError, groupId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const reconcileUncertain = async (error: unknown) => {
    if (!mounted.current) return;
    setActionError(error instanceof ApiResponseError ? error.message : genericError);
    if (uncertain(error)) {
      setNotice(t('groups:invite_manage.uncertain'));
    }
    if (uncertain(error) || (error instanceof ApiResponseError && isRefusalStatus(error.status))) {
      await refresh();
    }
  };

  const shareInvite = async (url: string) => {
    if (!mounted.current) return;
    setActionError(null);
    try { await Share.share({ message: url }); }
    catch { if (mounted.current) setActionError(genericError); }
  };

  async function createLink() {
    if (actionInFlight.current) return;
    const days = Number(expiry);
    if (!Number.isInteger(days) || days < 1 || days > 90) { setActionError(t('groups:invite_manage.expiry_error')); return; }
    actionInFlight.current = true; setBusy(true); setActionError(null); setNotice(null);
    try {
      const invite = await createGroupInviteLink(groupId, days);
      if (!mounted.current) return;
      setInvites(current => [invite, ...current.filter(item => item.id !== invite.id)]);
      if (invite.invite_url) await shareInvite(invite.invite_url);
      await refresh();
    } catch (error) { await reconcileUncertain(error); }
    finally { actionInFlight.current = false; if (mounted.current) setBusy(false); }
  }

  async function sendEmails() {
    if (actionInFlight.current) return;
    const parsed = parseGroupInviteEmails(emails);
    if (!parsed.emails.length || parsed.invalid.length) { setActionError(t('groups:invite_manage.email_error')); return; }
    if (parsed.emails.length > 50) { setActionError(t('groups:invite_manage.email_limit')); return; }
    actionInFlight.current = true; setBusy(true); setActionError(null); setNotice(null);
    try {
      const response = await sendGroupEmailInvites(groupId, parsed.emails, message);
      if (!mounted.current) return;
      setResults(response); setEmails(''); setMessage(''); await refresh();
    } catch (error) { await reconcileUncertain(error); }
    finally { actionInFlight.current = false; if (mounted.current) setBusy(false); }
  }

  function askRevoke(invite: GroupPendingInvite) {
    confirm({
      title: t('groups:invite_manage.revoke_title'), message: t('groups:invite_manage.revoke_message'),
      confirmLabel: t('groups:invite_manage.revoke'), cancelLabel: t('common:buttons.cancel'), variant: 'danger',
      onConfirm: async () => {
        if (actionInFlight.current) return;
        actionInFlight.current = true; setBusy(true); setActionError(null); setNotice(null);
        try {
          await revokeGroupInvite(groupId, invite.id);
          if (mounted.current) setInvites(current => current.filter(item => item.id !== invite.id));
        }
        catch (error) { await reconcileUncertain(error); }
        finally { actionInFlight.current = false; if (mounted.current) setBusy(false); }
      },
    });
  }

  if (loading && !invites.length) return <View className="p-4"><Text>{t('common:loading')}</Text></View>;
  if (isRefusalStatus(loadStatus)) return <EmptyState icon="lock-closed-outline" title={t('groups:invite_manage.access_denied')} />;
  if (loadError) return <EmptyState icon="warning-outline" title={t('groups:invite_manage.load_error')} subtitle={loadError} actionLabel={t('common:buttons.retry')} onAction={() => void refresh()} />;

  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} enabled={!busy} onRefresh={() => void refresh()} />} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <View className="gap-4">
        {notice ? <Text accessibilityRole="alert" className="text-foreground">{notice}</Text> : null}
        {actionError ? <Text accessibilityRole="alert" className="text-danger">{actionError}</Text> : null}
        <Card><Card.Body className="gap-3 p-4">
          <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">{t('groups:invite_manage.link_title')}</Text>
          <Text className="text-muted-foreground">{t('groups:invite_manage.link_description')}</Text>
          <Input testID="group-invite-expiry" label={t('groups:invite_manage.expiry_label')} value={expiry} onChangeText={setExpiry} keyboardType="number-pad" editable={!busy} />
          <Button isDisabled={busy} onPress={() => void createLink()}>{t('groups:invite_manage.create_link')}</Button>
        </Card.Body></Card>
        <Card><Card.Body className="gap-3 p-4">
          <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">{t('groups:invite_manage.email_title')}</Text>
          <Input testID="group-invite-emails" label={t('groups:invite_manage.email_label')} value={emails} onChangeText={setEmails} autoCapitalize="none" keyboardType="email-address" editable={!busy} multiline />
          <Input testID="group-invite-message" label={t('groups:invite_manage.message_label')} value={message} onChangeText={setMessage} editable={!busy} multiline maxLength={10000} />
          <Button isDisabled={busy || !emails.trim()} onPress={() => void sendEmails()}>{t('groups:invite_manage.send')}</Button>
          {results.map(result => <Text key={`${result.email}:${result.status}`} className="text-foreground">{result.email}: {t(`groups:invite_manage.status.${result.status}`)}</Text>)}
        </Card.Body></Card>
        <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">{t('groups:invite_manage.pending_title')}</Text>
        {!invites.length ? <Text className="text-muted-foreground">{t('groups:invite_manage.pending_empty')}</Text> : invites.map(invite => <Card key={invite.id}><Card.Body className="gap-2 p-4">
          <Text className="font-semibold text-foreground">{invite.email ?? t('groups:invite_manage.share_link')}</Text>
          <Text className="text-muted-foreground">{t('groups:invite_manage.expires', { date: new Date(invite.expires_at).toLocaleDateString() })}</Text>
          {invite.invite_url ? <Button variant="secondary" isDisabled={busy} onPress={() => void shareInvite(invite.invite_url!)}>{t('groups:invite_manage.share')}</Button> : null}
          {invite.capabilities?.can_revoke ? <Button variant="danger" isDisabled={busy} onPress={() => askRevoke(invite)}>{t('groups:invite_manage.revoke')}</Button> : null}
        </Card.Body></Card>)}
      </View>
    </ScrollView>{confirmDialog}
  </KeyboardAvoidingView>;
}

function Screen() {
  const { t } = useTranslation(['groups', 'common']);
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const groupId = typeof id === 'string' && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) ? Number(id) : 0;
  return <ModalErrorBoundary><SafeAreaView style={{ flex: 1 }} className="bg-background">
    <AppTopBar title={t('groups:invite_manage.title')} backLabel={t('common:back')} fallbackHref={{ pathname: '/(modals)/group-detail', params: { id: String(groupId) } } as Href} />
    {groupId ? <Workspace groupId={groupId} /> : <EmptyState icon="warning-outline" title={t('groups:invite_manage.invalid_group')} />}
  </SafeAreaView></ModalErrorBoundary>;
}

export default withRouteGate(Screen, 'group-invitations');
