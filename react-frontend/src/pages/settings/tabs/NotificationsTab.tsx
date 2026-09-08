import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Select, SelectItem } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.


import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Save from 'lucide-react/icons/save';
import Mail from 'lucide-react/icons/mail';
import Smartphone from 'lucide-react/icons/smartphone';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import CreditCard from 'lucide-react/icons/credit-card';
import Trophy from 'lucide-react/icons/trophy';
import Building2 from 'lucide-react/icons/building-2';
import Search from 'lucide-react/icons/search';
import ArrowRight from 'lucide-react/icons/arrow-right';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { useWebPush } from '@/hooks/useWebPush';
import { useTenant } from '@/contexts';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface NotificationSettings {
  email_messages: boolean;
  email_listings: boolean;
  email_digest: boolean;
  email_connections: boolean;
  email_transactions: boolean;
  email_reviews: boolean;
  email_events: boolean;
  email_gamification_digest: boolean;
  email_gamification_milestones: boolean;
  email_org_payments: boolean;
  email_org_transfers: boolean;
  email_org_membership: boolean;
  email_org_admin: boolean;
  caring_smart_nudges: boolean;
  federation_notifications_enabled: boolean;
  push_enabled: boolean;
  push_campaigns_opted_in: boolean;
}

interface NotificationsTabProps {
  notifications: NotificationSettings;
  notificationError: string | null;
  notificationLoading: boolean;
  isSaving: boolean;
  matchDigestFrequency: string;
  notifyHotMatches: boolean;
  notifyMutualMatches: boolean;
  marketingConsent: boolean;
  marketingConsentLoading: boolean;
  isOrganisation: boolean;
  /**
   * Global activity-digest frequency from notification_settings
   * (off/instant/daily/monthly). Default is 'off' so members do not get
   * unsolicited digest email until they opt in here.
   */
  digestFrequency: string;
  onNotificationsChange: (updater: (prev: NotificationSettings) => NotificationSettings) => void;
  onMatchDigestFrequencyChange: (value: string) => void;
  onNotifyHotMatchesChange: (value: boolean) => void;
  onNotifyMutualMatchesChange: (value: boolean) => void;
  onMarketingConsentToggle: (checked: boolean) => void;
  onDigestFrequencyChange: (value: string) => void;
  onSave: () => void;
  onRetry: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// SettingToggle helper
// ─────────────────────────────────────────────────────────────────────────────

interface SettingToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

function SettingToggle({ label, description, checked, onChange, disabled }: SettingToggleProps) {
  return (
    <div className="flex items-center justify-between gap-4 p-4 rounded-lg bg-theme-elevated">
      <div className="min-w-0">
        <p className="font-medium text-theme-primary">{label}</p>
        <p className="text-sm text-theme-subtle">{description}</p>
      </div>
      <Switch
        aria-label={label}
        isSelected={checked}
        onValueChange={onChange}
        isDisabled={disabled}
        className="shrink-0"
        classNames={{
          wrapper: 'group-data-[selected=true]:bg-accent',
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function NotificationsTab({
  notifications,
  notificationError,
  notificationLoading,
  isSaving,
  matchDigestFrequency,
  notifyHotMatches,
  notifyMutualMatches,
  marketingConsent,
  marketingConsentLoading,
  isOrganisation,
  digestFrequency,
  onNotificationsChange,
  onMatchDigestFrequencyChange,
  onNotifyHotMatchesChange,
  onNotifyMutualMatchesChange,
  onMarketingConsentToggle,
  onDigestFrequencyChange,
  onSave,
  onRetry,
}: NotificationsTabProps) {
  const { t } = useTranslation('settings');
  const webPush = useWebPush();
  const { tenantPath, hasModule, hasFeature } = useTenant();
  const hasMessages = hasModule('messages');
  const hasListings = hasModule('listings');
  const hasWallet = hasModule('wallet');
  const hasConnections = hasFeature('connections');
  const hasCaringCommunity = hasFeature('caring_community');
  const hasFederation = hasFeature('federation');
  const hasEvents = hasFeature('events');
  const hasReviews = hasFeature('reviews');
  const hasGamification = hasFeature('gamification');
  const hasOrganisations = hasFeature('volunteering') && hasFeature('organisations');
  const hasCommunicationPreferences = hasMessages || hasConnections || hasCaringCommunity || hasFederation;
  const hasActivityPreferences = hasEvents || hasListings || hasWallet || hasReviews;

  // The push_enabled toggle is the source of truth for *consent*. The actual
  // browser subscription is managed by useWebPush. When the user flips the
  // toggle on, we request permission + create the PushSubscription before
  // marking the preference. When they flip it off, we tear down the
  // subscription locally + on the server. The preference itself still
  // persists via the existing onSave flow so the user's choice is durable.
  const handlePushToggle = async (checked: boolean) => {
    if (checked) {
      const ok = await webPush.subscribe();
      if (ok) onNotificationsChange((prev) => ({ ...prev, push_enabled: true }));
      return;
    }
    await webPush.unsubscribe();
    onNotificationsChange((prev) => ({ ...prev, push_enabled: false }));
  };

  // The visible state of the toggle reflects BOTH the saved preference AND
  // the actual browser subscription. If the preference says "on" but the
  // subscription is gone (browser cleared, key rotated, denied permission),
  // show as off so the user knows they need to re-enable.
  const pushToggleChecked = notifications.push_enabled && webPush.isSubscribed;

  // Why the toggle might be unavailable: unsupported browser (Safari < 16.4
  // pre-iOS install), or explicitly denied permission (user must re-enable
  // in browser settings — we can't re-ask).
  const pushDisabled = !webPush.isSupported || webPush.permission === 'denied' || webPush.isPending;

  return (
    <GlassCard className="p-6">
      <h2 className="text-lg font-semibold text-theme-primary mb-6">{t('notifications')}</h2>

      {notificationLoading ? (
        <div role="status" className="flex items-center justify-center gap-2 py-8 text-theme-muted">
          <RefreshCw className="h-5 w-5 animate-spin" aria-hidden="true" />
          <span>{t('notifications_loading')}</span>
        </div>
      ) : notificationError ? (
        <div role="alert" className="text-center py-8">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <p className="text-theme-muted mb-4">{notificationError}</p>
          <Button
            className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
            onPress={onRetry}
          >
            {t('try_again')}
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Messages & Communication */}
          {hasCommunicationPreferences && <div className="space-y-4">
            <h3 className="text-sm font-medium text-theme-muted flex items-center gap-2">
              <Mail className="w-4 h-4" aria-hidden="true" />
              {hasMessages ? t('notification_sections.messages_communication') : t('notification_sections.title')}
            </h3>

            {hasMessages && <SettingToggle
              label={t('notification_prefs.new_messages')}
              description={t('notification_descriptions.new_messages')}
              checked={notifications.email_messages}
              onChange={(checked) => onNotificationsChange((prev) => ({ ...prev, email_messages: checked }))}
            />}

            {hasConnections && <SettingToggle
              label={t('notification_prefs.connection_requests')}
              description={t('notification_descriptions.connection_requests')}
              checked={notifications.email_connections}
              onChange={(checked) => onNotificationsChange((prev) => ({ ...prev, email_connections: checked }))}
            />}

            {hasCaringCommunity && <SettingToggle
              label={t('notification_prefs.caring_smart_nudges')}
              description={t('notification_descriptions.caring_smart_nudges')}
              checked={notifications.caring_smart_nudges}
              onChange={(checked) => onNotificationsChange((prev) => ({ ...prev, caring_smart_nudges: checked }))}
            />}

            {hasFederation && <SettingToggle
              label={t('notification_prefs.federation_notifications')}
              description={t('notification_descriptions.federation_notifications')}
              checked={notifications.federation_notifications_enabled}
              onChange={(checked) => onNotificationsChange((prev) => ({ ...prev, federation_notifications_enabled: checked }))}
            />}
          </div>}

          {/* Activity & Listings */}
          {hasActivityPreferences && <div className="pt-4 border-t border-theme-default space-y-4">
            <h3 className="text-sm font-medium text-theme-muted flex items-center gap-2">
              <CreditCard className="w-4 h-4" aria-hidden="true" />
              {hasListings ? t('notification_sections.activity_listings') : t('notification_sections.title')}
            </h3>

            {hasEvents && <SettingToggle
              label={t('notification_prefs.event_emails')}
              description={t('notification_descriptions.event_emails')}
              checked={notifications.email_events}
              onChange={(checked) => onNotificationsChange((prev) => ({ ...prev, email_events: checked }))}
            />}

            {hasListings && <SettingToggle
              label={t('notification_prefs.listing_activity')}
              description={t('notification_descriptions.listing_activity')}
              checked={notifications.email_listings}
              onChange={(checked) => onNotificationsChange((prev) => ({ ...prev, email_listings: checked }))}
            />}

            {hasWallet && <SettingToggle
              label={t('notification_prefs.credit_transactions')}
              description={t('notification_descriptions.credit_transactions')}
              checked={notifications.email_transactions}
              onChange={(checked) => onNotificationsChange((prev) => ({ ...prev, email_transactions: checked }))}
            />}

            {hasReviews && <SettingToggle
              label={t('notification_prefs.new_reviews')}
              description={t('notification_descriptions.new_reviews')}
              checked={notifications.email_reviews}
              onChange={(checked) => onNotificationsChange((prev) => ({ ...prev, email_reviews: checked }))}
            />}
          </div>}

          {/* Community & Achievements */}
          <div className="pt-4 border-t border-theme-default space-y-4">
            <h3 className="text-sm font-medium text-theme-muted flex items-center gap-2">
              <Trophy className="w-4 h-4" aria-hidden="true" />
              {hasGamification ? t('notification_sections.community_achievements') : t('notification_sections.title')}
            </h3>

            {hasGamification && <SettingToggle
              label={t('notification_prefs.gamification_digest')}
              description={t('notification_descriptions.gamification_digest')}
              checked={notifications.email_gamification_digest}
              onChange={(checked) => onNotificationsChange((prev) => ({ ...prev, email_gamification_digest: checked }))}
            />}

            {hasGamification && <SettingToggle
              label={t('notification_prefs.achievement_milestones')}
              description={t('notification_descriptions.achievement_milestones')}
              checked={notifications.email_gamification_milestones}
              onChange={(checked) => onNotificationsChange((prev) => ({ ...prev, email_gamification_milestones: checked }))}
            />}

            <SettingToggle
              label={t('notification_prefs.weekly_digest')}
              description={t('notification_descriptions.weekly_digest')}
              checked={notifications.email_digest}
              onChange={(checked) => onNotificationsChange((prev) => ({ ...prev, email_digest: checked }))}
            />

            {/*
              Activity digest frequency — controls how often we batch
              non-critical activity (new topics, replies, mentions in groups
              the user joined) into a digest email. Default is 'off' so
              members do not receive unsolicited digest mail. They opt in
              here if they want it. Critical events (direct messages,
              connection requests, transaction confirmations) are always
              instant regardless of this setting.
            */}
            <div className="p-4 rounded-lg bg-theme-elevated">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="font-medium text-theme-primary">
                    {t('notification_prefs.activity_digest')}
                  </p>
                  <p className="text-sm text-theme-subtle">
                    {t('notification_descriptions.activity_digest')}
                  </p>
                </div>
                <Select
                  label={t('notification_prefs.activity_digest')}
                  selectedKeys={[digestFrequency]}
                  onSelectionChange={(keys) => {
                    const value = Array.from(keys)[0] as string;
                    if (value) onDigestFrequencyChange(value);
                  }}
                  className="sm:max-w-[180px]"
                  classNames={{
                    trigger: 'bg-theme-elevated border-theme-default',
                    value: 'text-theme-primary',
                  }}
                >
                  <SelectItem key="off" id="off">{t('activity_digest.off')}</SelectItem>
                  <SelectItem key="instant" id="instant">{t('activity_digest.instant')}</SelectItem>
                  <SelectItem key="daily" id="daily">{t('activity_digest.daily')}</SelectItem>
                  <SelectItem key="monthly" id="monthly">{t('activity_digest.monthly')}</SelectItem>
                </Select>
              </div>
            </div>
          </div>

          {/* Organisation Notifications */}
          {isOrganisation && hasOrganisations && (
            <div className="pt-4 border-t border-theme-default space-y-4">
              <h3 className="text-sm font-medium text-theme-muted flex items-center gap-2">
                <Building2 className="w-4 h-4" aria-hidden="true" />
                {t('notification_sections.organisation_notifications')}
              </h3>

              <SettingToggle
                label={t('notification_prefs.payment_notifications')}
                description={t('notification_descriptions.payment_notifications')}
                checked={notifications.email_org_payments}
                onChange={(checked) => onNotificationsChange((prev) => ({ ...prev, email_org_payments: checked }))}
              />

              <SettingToggle
                label={t('notification_prefs.transfer_notifications')}
                description={t('notification_descriptions.transfer_notifications')}
                checked={notifications.email_org_transfers}
                onChange={(checked) => onNotificationsChange((prev) => ({ ...prev, email_org_transfers: checked }))}
              />

              <SettingToggle
                label={t('notification_prefs.membership_updates')}
                description={t('notification_descriptions.membership_updates')}
                checked={notifications.email_org_membership}
                onChange={(checked) => onNotificationsChange((prev) => ({ ...prev, email_org_membership: checked }))}
              />

              <SettingToggle
                label={t('notification_prefs.admin_notifications')}
                description={t('notification_descriptions.admin_notifications')}
                checked={notifications.email_org_admin}
                onChange={(checked) => onNotificationsChange((prev) => ({ ...prev, email_org_admin: checked }))}
              />
            </div>
          )}

          {/* Match Digest */}
          {hasListings && <div className="pt-4 border-t border-theme-default space-y-4">
            <h3 className="text-sm font-medium text-theme-muted flex items-center gap-2">
              <Search className="w-4 h-4" aria-hidden="true" />
              {t('notification_sections.match_digest')}
            </h3>

            <div className="p-4 rounded-lg bg-theme-elevated">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <p className="font-medium text-theme-primary">{t('match_digest.frequency')}</p>
                  <p className="text-sm text-theme-subtle">{t('match_digest.frequency_description')}</p>
                </div>
                <Select
                  label={t('match_digest.frequency')}
                  selectedKeys={[matchDigestFrequency]}
                  onSelectionChange={(keys) => {
                    const value = Array.from(keys)[0] as string;
                    if (value) onMatchDigestFrequencyChange(value);
                  }}
                  className="sm:max-w-[180px]"
                  classNames={{
                    trigger: 'bg-theme-elevated border-theme-default',
                    value: 'text-theme-primary',
                  }}
                >
                  <SelectItem key="daily" id="daily">{t('match_digest.daily')}</SelectItem>
                  <SelectItem key="monthly" id="monthly">{t('match_digest.monthly')}</SelectItem>
                  <SelectItem key="fortnightly" id="fortnightly">{t('match_digest.fortnightly')}</SelectItem>
                  <SelectItem key="never" id="never">{t('match_digest.never')}</SelectItem>
                </Select>
              </div>
            </div>

            <SettingToggle
              label={t('notification_prefs.hot_match_alerts')}
              description={t('notification_descriptions.hot_match_alerts')}
              checked={notifyHotMatches}
              onChange={onNotifyHotMatchesChange}
            />

            <SettingToggle
              label={t('notification_prefs.mutual_match_alerts')}
              description={t('notification_descriptions.mutual_match_alerts')}
              checked={notifyMutualMatches}
              onChange={onNotifyMutualMatchesChange}
            />

            <Link
              to={tenantPath('/matches/preferences')}
              className="flex items-center justify-between gap-2 p-4 rounded-lg bg-theme-elevated text-sm text-theme-secondary hover:text-theme-primary hover:bg-theme-hover transition-colors"
            >
              {t('match_digest.manage_in_preferences')}
              <ArrowRight className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            </Link>
          </div>}

          {/* Push Notifications */}
          <div className="pt-4 border-t border-theme-default space-y-4">
            <h3 className="text-sm font-medium text-theme-muted flex items-center gap-2">
              <Smartphone className="w-4 h-4" aria-hidden="true" />
              {t('notification_sections.push_notifications')}
            </h3>

            <SettingToggle
              label={t('notification_prefs.enable_push')}
              description={
                !webPush.isSupported
                  ? t('push_status.unsupported')
                  : webPush.permission === 'denied'
                    ? t('push_status.denied')
                    : webPush.isSubscribed
                      ? t('push_status.subscribed')
                      : t('notification_descriptions.enable_push')
              }
              checked={pushToggleChecked}
              onChange={handlePushToggle}
              disabled={pushDisabled}
            />
            {webPush.error ? (
              <p className="text-xs text-[var(--color-error)] -mt-2 px-4">{webPush.error}</p>
            ) : null}

            <SettingToggle
              label={t('push_campaign_opt_in')}
              description={t('push_campaign_opt_in_description')}
              checked={notifications.push_campaigns_opted_in}
              onChange={(checked) => onNotificationsChange((prev) => ({ ...prev, push_campaigns_opted_in: checked }))}
            />
          </div>

          {/* Marketing & Communications */}
          <div className="pt-4 border-t border-theme-default space-y-4">
            <h3 className="text-sm font-medium text-theme-muted flex items-center gap-2">
              <Mail className="w-4 h-4" aria-hidden="true" />
              {t('notification_sections.marketing_communications')}
            </h3>

            <SettingToggle
              label={t('notification_prefs.marketing_emails')}
              description={t('notification_descriptions.marketing_emails')}
              checked={marketingConsent}
              onChange={onMarketingConsentToggle}
              disabled={marketingConsentLoading}
            />
          </div>

          <Button
            onPress={onSave}
            className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
            startContent={<Save className="w-4 h-4" aria-hidden="true" />}
            isLoading={isSaving}
          >
            {t('save_preferences')}
          </Button>
        </div>
      )}
    </GlassCard>
  );
}
