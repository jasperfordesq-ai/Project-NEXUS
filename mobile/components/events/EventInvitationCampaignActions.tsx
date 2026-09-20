// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { useState } from 'react';
import { Keyboard, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/NativeButton';
import Input from '@/components/ui/Input';
import type { InvitationCampaignIntent, OrganizerInvitationCampaign } from '@/lib/api/eventRegistration';
import { eventLocalInputToIso } from '@/lib/utils/eventDateTime';

type Props = { campaign: OrganizerInvitationCampaign; timezone: string; eventStart: string | null;
  disabled: boolean; onSubmit: (intent: InvitationCampaignIntent) => void };
export default function EventInvitationCampaignActions({ campaign, timezone, eventStart, disabled, onSubmit }: Props) {
  const { t } = useTranslation(['eventRegistration', 'events', 'common']);
  const [action, setAction] = useState<'issue' | 'schedule' | 'cancel' | null>(null);
  const [value, setValue] = useState(''); const [invalid, setInvalid] = useState(false);
  const mutable = ['previewed', 'scheduled'].includes(campaign.status);
  const label = (kind: string) => t('invitations.' + (kind === 'issue' ? 'send_now' : kind));
  function submit() {
    if (disabled || !mutable || !action) return;
    let intent: InvitationCampaignIntent;
    const base = { campaignId: campaign.id, expectedRevision: campaign.revision };
    if (action === 'cancel') {
      if (!value.trim() || Array.from(value.trim()).length > 500) { setInvalid(true); return; }
      intent = { ...base, action, reason: value.trim() };
    } else {
      const instant = eventLocalInputToIso(value.trim().replace(' ', 'T'), timezone);
      const end = eventStart ? Date.parse(eventStart) : NaN;
      if (!instant || !Number.isFinite(end) || Date.parse(instant) <= Date.now()
        || Date.parse(instant) > end || (action === 'schedule' && Date.parse(instant) === end)
        || campaign.valid_count === 0 || (action === 'schedule' && campaign.status !== 'previewed')) { setInvalid(true); return; }
      intent = action === 'issue' ? { ...base, action, expiresAt: instant } : { ...base, action, scheduledFor: instant };
    }
    Keyboard.dismiss(); onSubmit(intent);
  }
  if (!mutable) return null;
  return <View className="gap-3">
    {!action ? <>
      {campaign.valid_count > 0 && (campaign.status === 'previewed' || (campaign.status === 'scheduled' && campaign.scheduled_for_utc && Date.parse(campaign.scheduled_for_utc) <= Date.now())) && <Button isDisabled={disabled} onPress={() => setAction('issue')}>{label('issue')}</Button>}
      {campaign.valid_count > 0 && campaign.status === 'previewed' && <Button variant="secondary" isDisabled={disabled} onPress={() => setAction('schedule')}>{label('schedule')}</Button>}
      <Button variant="secondary" isDisabled={disabled} onPress={() => setAction('cancel')}>{label('cancel')}</Button>
    </> : <>
      <Text accessibilityRole="header" className="font-semibold text-foreground">{label(action)}</Text>
      <Text className="text-foreground">{t('invitations.valid_count', { count: campaign.valid_count })}</Text>
      <Input label={t('invitations.' + (action === 'cancel' ? 'cancel_reason' : action === 'issue' ? 'expires_at' : 'scheduled_for'))}
        helper={action === 'cancel' ? undefined : t('events:registrationSettings.time_hint', { timezone })}
        editable={!disabled} value={value} onChangeText={text => { setValue(text); setInvalid(false); }} multiline={action === 'cancel'}
        autoCapitalize="none" autoCorrect={false} error={invalid ? t('accessible.validation_error') : undefined} />
      <Button isDisabled={disabled} onPress={submit}>{t('common:buttons.confirm')}</Button>
      <Button variant="secondary" isDisabled={disabled} onPress={() => { setAction(null); setValue(''); setInvalid(false); }}>{t('common:buttons.cancel')}</Button>
    </>}
  </View>;
}
