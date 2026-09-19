// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Card } from 'heroui-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/NativeButton';
import Input from '@/components/ui/Input';
import type { EventPeopleIntent } from '@/lib/eventPeopleOperationStore';

type Action = Exclude<EventPeopleIntent['action'], 'invite'>;
interface Props {
  action: Action;
  targets: EventPeopleIntent['targets'];
  disabled?: boolean;
  onConfirm: (intent: EventPeopleIntent) => Promise<void>;
  onCancel: () => void;
}

/** A changed selection requires a fresh confirmation and reason. */
export default function EventPeopleConfirmation(props: Props) {
  return <ConfirmationContent key={JSON.stringify([props.action, props.targets])} {...props} />;
}

function ConfirmationContent({ action, targets, disabled = false, onConfirm, onCancel }: Props) {
  const { t } = useTranslation('events');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const active = useRef(true);
  const submitting = useRef(false);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const validTargets = targets.length > 0 && targets.length <= 100
    && new Set(targets.map(target => target.userId)).size === targets.length
    && targets.every(target => Number.isSafeInteger(target.userId) && target.userId > 0
      && Number.isSafeInteger(target.version) && target.version >= 0);
  const canConfirm = validTargets && (action === 'approve' || reason.trim().length > 0);
  async function confirm() {
    if (!active.current || disabledRef.current || submitting.current || !canConfirm) return;
    submitting.current = true; setBusy(true); setFailed(false);
    try {
      await onConfirm({ action, targets: targets.map(target => ({ ...target })), reason: reason.trim() || null });
    } catch {
      if (active.current) setFailed(true);
    } finally {
      submitting.current = false;
      if (active.current) setBusy(false);
    }
  }
  const p = 'manage.people';
  return <Card variant="secondary"><Card.Body className="gap-3 p-4">
    <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">{t(`${p}.confirm.${action}_title`)}</Text>
    <Text className="text-foreground">{t(`${p}.confirm.${action}_description`, { count: targets.length })}</Text>
    {action !== 'approve' ? <Input label={t(`${p}.reason_label`)} accessibilityLabel={t(`${p}.reason_label`)}
      value={reason} onChangeText={value => setReason(Array.from(value).slice(0, 4000).join(''))}
      editable={!busy && !disabled} multiline textAlignVertical="top" /> : null}
    {failed ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" className="text-danger">{t(`${p}.action_error`)}</Text> : null}
    <View className="flex-row flex-wrap gap-2">
      <Button isDisabled={disabled || busy || !canConfirm} accessibilityState={{ busy }} onPress={confirm}>
        <Button.Label>{t(`${p}.actions.${action}`)}</Button.Label>
      </Button>
      <Button variant="secondary" isDisabled={busy} onPress={() => {
        if (active.current && !submitting.current) onCancel();
      }}><Button.Label>{t(`${p}.keep_unchanged`)}</Button.Label></Button>
    </View>
  </Card.Body></Card>;
}
