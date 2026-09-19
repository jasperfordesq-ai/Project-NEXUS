// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Card } from 'heroui-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/NativeButton';
import { exportEventPeople, type EventPeopleQuery } from '@/lib/api/eventPeople';

export default function EventPeopleExport({ eventId, query, total, disabled }: {
  eventId: number; query: EventPeopleQuery; total: number; disabled: boolean;
}) {
  const { t } = useTranslation('events');
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const active = useRef(true);
  const locked = useRef(false);
  const permitted = useRef(!disabled); permitted.current = !disabled;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const p = 'manage.people';
  async function download() {
    if (!active.current || !permitted.current || locked.current) return;
    locked.current = true; setBusy(true); setFailed(false);
    try {
      await exportEventPeople(eventId, query, () => active.current && permitted.current);
      if (active.current) setReview(false);
    } catch { if (active.current) setFailed(true); }
    finally { locked.current = false; if (active.current) setBusy(false); }
  }
  return <View className="gap-3">
    <Button variant="secondary" isDisabled={disabled || busy} onPress={() => { setReview(true); setFailed(false); }}>
      <Button.Label>{t(`${p}.export`)}</Button.Label>
    </Button>
    {review ? <Card variant="secondary"><Card.Body className="gap-3 p-4">
      <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">{t(`${p}.export_preview_title`)}</Text>
      <Text className="text-foreground">{t(`${p}.export_preview_description`, { count: total })}</Text>
      <Text className="font-semibold text-foreground">{t(`${p}.export_included_title`)}</Text>
      {['member_identity', 'engagement_registration', 'waitlist', 'attendance', 'timestamps'].map(field =>
        <Text key={field} className="text-foreground">{t(`${p}.export_included_fields.${field}`)}</Text>)}
      <Text className="font-semibold text-foreground">{t(`${p}.export_excluded_title`)}</Text>
      <Text className="text-muted-foreground">{t(`${p}.export_excluded_description`)}</Text>
      {['contact_details', 'form_answers', 'incident_records', 'support_notes', 'audit_metadata'].map(field =>
        <Text key={field} className="text-muted-foreground">{t(`${p}.export_excluded_fields.${field}`)}</Text>)}
      <View className="flex-row flex-wrap gap-2">
        <Button isDisabled={disabled || busy} accessibilityState={{ busy }} onPress={download}><Button.Label>{t(`${p}.export_confirm`)}</Button.Label></Button>
        <Button variant="secondary" isDisabled={busy} onPress={() => setReview(false)}><Button.Label>{t(`${p}.export_cancel`)}</Button.Label></Button>
      </View>
      {failed ? <Text accessibilityRole="alert" className="text-danger">{t(`${p}.export_error`)}</Text> : null}
    </Card.Body></Card> : null}
  </View>;
}
