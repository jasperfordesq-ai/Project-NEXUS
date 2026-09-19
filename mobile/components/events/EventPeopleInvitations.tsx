// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Card } from 'heroui-native';
import { useTranslation } from 'react-i18next';
import SearchInput from '@/components/ui/SearchInput';
import { Button } from '@/components/ui/NativeButton';
import { useApi } from '@/lib/hooks/useApi';
import { searchEventInviteMembers, type EventInviteMember } from '@/lib/api/eventPeople';
import type { EventPeopleIntent } from '@/lib/eventPeopleOperationStore';

export default function EventPeopleInvitations({ blocked, onInvite }: {
  blocked: boolean; onInvite: (intent: EventPeopleIntent) => Promise<void>;
}) {
  const { t } = useTranslation(['events', 'common']);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<EventInviteMember[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const blockedRef = useRef(blocked); blockedRef.current = blocked;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const search = useApi(() => searchEventInviteMembers(query), [query], {
    enabled: Array.from(query).length >= 2 && !blocked, clearOnRefusal: true,
  });
  const p = 'manage.people';
  const runSearch = () => {
    if (!mounted.current || blockedRef.current || submitting.current || Array.from(text.trim()).length < 2) return;
    if (text.trim() === query) search.refresh();
    else setQuery(text.trim());
  };
  const name = (member: EventInviteMember) => member.name?.trim()
    || [member.first_name, member.last_name].filter(Boolean).join(' ').trim()
    || t(`${p}.member_fallback`, { id: member.id });
  const choose = (member: EventInviteMember) => {
    if (!mounted.current || blockedRef.current || submitting.current) return;
    setSelected(current => current.some(item => item.id === member.id)
      ? current.filter(item => item.id !== member.id) : current.length < 100 ? [...current, member] : current);
  };
  async function invite() {
    if (!mounted.current || blockedRef.current || submitting.current || selected.length === 0) return;
    submitting.current = true; setBusy(true); setFailed(false);
    try {
      await onInvite({ action: 'invite', reason: null, targets: selected.map(member => ({ userId: member.id, version: 0 })) });
      if (mounted.current) setSelected([]);
    } catch { if (mounted.current) setFailed(true); }
    finally { submitting.current = false; if (mounted.current) setBusy(false); }
  }
  return <Card variant="secondary"><Card.Body className="gap-3 p-4">
    <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">{t(`${p}.invite_title`)}</Text>
    <Text className="text-foreground">{t(`${p}.invite_description`)}</Text>
    <SearchInput value={text} onChangeText={value => { setText(value); if (!value) setQuery(''); }}
      accessibilityLabel={t(`${p}.invite_search_label`)} placeholder={t(`${p}.invite_search_placeholder`)}
      clearLabel={t(`${p}.clear_invite_search`)} onSubmitEditing={runSearch} returnKeyType="search" />
    <Text className="text-muted-foreground">{t(`${p}.invite_search_hint`)}</Text>
    <Button isDisabled={blocked || busy || search.isLoading || Array.from(text.trim()).length < 2} onPress={runSearch}>
      <Button.Label>{t('common:search')}</Button.Label>
    </Button>
    {search.isLoading ? <Text accessibilityLiveRegion="polite" className="text-muted-foreground">{t(`${p}.searching`)}</Text> : null}
    {search.error ? <Text accessibilityRole="alert" className="text-danger">{t(`${p}.invite_search_error`)}</Text> : null}
    {search.data?.length === 0 && query ? <Text className="text-muted-foreground">{t(`${p}.no_invite_results`)}</Text> : null}
    <View className="gap-2">{search.data?.map(member => <Button key={member.id} variant="secondary"
      isDisabled={blocked || busy || (selected.length >= 100 && !selected.some(item => item.id === member.id))}
      accessibilityState={{ selected: selected.some(item => item.id === member.id) }} onPress={() => choose(member)}>
      <Button.Label>{t(`${p}.select_member`, { name: name(member) })}</Button.Label>
    </Button>)}</View>
    {selected.length ? <View className="gap-2">
      <Text className="text-foreground">{t(`${p}.selected_count`, { count: selected.length })}</Text>
      {selected.map(member => <Button key={member.id} variant="secondary" isDisabled={blocked || busy}
        accessibilityState={{ selected: true }} onPress={() => choose(member)}><Button.Label>{name(member)}</Button.Label></Button>)}
      <Button isDisabled={blocked || busy} accessibilityState={{ busy }} onPress={invite}>
        <Button.Label>{t(`${p}.invite_selected`, { count: selected.length })}</Button.Label>
      </Button>
    </View> : null}
    {failed ? <Text accessibilityRole="alert" className="text-danger">{t(`${p}.invite_error`)}</Text> : null}
  </Card.Body></Card>;
}
