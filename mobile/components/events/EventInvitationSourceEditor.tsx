// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { useMemo, useState } from 'react';
import { Keyboard, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/NativeButton';
import Input from '@/components/ui/Input';
import { buildInvitationSource, emptyAudience, invitationLocales, type AudienceFields, type CampaignPreview } from '@/lib/invitationSource';

type Props = { disabled: boolean; onPreview: (intent: CampaignPreview) => void; onErrorLayout?: () => void };
/** Mount with the tenant/user/event identity as its key so recipient data cannot cross workspaces. */
export default function EventInvitationSourceEditor({ disabled, onPreview, onErrorLayout }: Props) {
  const { t } = useTranslation(['eventRegistration', 'common']);
  const [type, setType] = useState<CampaignPreview['campaignType']>('member');
  const [sources, setSources] = useState({ member: '', email: '', group: '', csv: '' });
  const [audience, setAudience] = useState<AudienceFields>({ ...emptyAudience });
  const [locale, setLocale] = useState<CampaignPreview['defaultLocale']>('en');
  const [attempted, setAttempted] = useState(false);
  const [showLanguages, setShowLanguages] = useState(false);
  const result = useMemo(() => buildInvitationSource(type, type === 'audience' ? '' : sources[type], audience), [type, sources, audience]);
  const invalid = attempted ? result.invalidField : undefined;
  const error = (field: string) => invalid === field ? t('accessible.validation_error') : undefined;
  const field = (key: 'roles' | 'languages' | 'groups' | 'excluded' | 'joinedAfter' | 'joinedBefore') =>
    <Input key={key} label={t('invitations.filters.' + key)} helper={t('invitations.filters.' + key + '_hint')}
      value={audience[key]} onChangeText={value => setAudience(previous => ({ ...previous, [key]: value }))}
      editable={!disabled} autoCapitalize="none" autoCorrect={false} error={error(key)}
      multiline={!['joinedAfter', 'joinedBefore'].includes(key)} />;
  const choices = (key: 'approved' | 'hasEmail' | 'groupMatch', values: readonly string[]) =>
    <View key={key} className="gap-2">
      <Text className="font-semibold text-foreground">{t('invitations.filters.' + key)}</Text>
      {values.map(value => <Button key={value} variant={audience[key] === value ? 'primary' : 'secondary'}
        accessibilityRole="radio" accessibilityState={{ checked: audience[key] === value, disabled }} isDisabled={disabled}
        onPress={() => setAudience(previous => ({ ...previous, [key]: value }))}>
        {t('invitations.filters.' + value)}</Button>)}
    </View>;
  return <View className="gap-3">
    <Text accessibilityRole="header" className="font-semibold text-foreground">{t('invitations.builder_title')}</Text>
    <Text className="text-muted-foreground">{t('invitations.builder_description')}</Text>
    <Text className="font-semibold text-foreground">{t('invitations.type_label')}</Text>
    {(['member', 'email', 'group', 'audience', 'csv'] as const).map(value => <Button key={value}
      variant={type === value ? 'primary' : 'secondary'} accessibilityRole="radio"
      accessibilityState={{ checked: type === value, disabled }} isDisabled={disabled}
      onPress={() => { setType(value); setAttempted(false); }}>{t('invitations.types.' + value)}</Button>)}
    {type !== 'audience' ? <Input label={t('invitations.sources.' + type + '.label')}
      helper={t('invitations.sources.' + type + '.description')} value={sources[type]}
      onChangeText={value => setSources(previous => ({ ...previous, [type]: value }))}
      editable={!disabled} multiline autoCapitalize="none" autoCorrect={false} error={error('source')} /> : <>
      {field('roles')}{field('languages')}{choices('approved', ['any', 'yes', 'no'])}
      {choices('hasEmail', ['any', 'yes', 'no'])}{field('groups')}
      {audience.groups.trim() ? choices('groupMatch', ['any', 'all']) : null}
      {field('excluded')}{field('joinedAfter')}{field('joinedBefore')}
    </>}
    <Text className="text-muted-foreground">{t('invitations.filters.limits')}</Text>
    <Button variant="secondary" isDisabled={disabled} accessibilityState={{ expanded: showLanguages, disabled }}
      onPress={() => setShowLanguages(value => !value)}>
      {t('invitations.locale_label') + ': ' + t('locales.' + locale)}</Button>
    {showLanguages && invitationLocales.map(value => <Button key={value} variant={locale === value ? 'primary' : 'secondary'}
      accessibilityRole="radio" accessibilityState={{ checked: locale === value, disabled }} isDisabled={disabled}
      onPress={() => { setLocale(value); setShowLanguages(false); }}>{t('locales.' + value)}</Button>)}
    {invalid && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" onLayout={onErrorLayout} className="text-danger">{t('accessible.validation_error')}</Text>}
    <Button isDisabled={disabled} onPress={() => {
      if (disabled) return;
      setAttempted(true);
      if (result.source) { Keyboard.dismiss(); onPreview({ action: 'preview', campaignType: type, source: result.source, defaultLocale: locale }); }
    }}>{t('invitations.preview')}</Button>
  </View>;
}
