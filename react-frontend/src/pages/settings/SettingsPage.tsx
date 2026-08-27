// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Settings Page - User account settings
 *
 * Tabs:
 *  1. Profile       - name, phone, bio, location, avatar, profile type
 *  2. Notifications - email & push notification toggles
 *  3. Privacy       - visibility, search indexing, contact, GDPR
 *  4. Security      - password, 2FA, sessions, account actions
 *  5. Skills        - skill tags
 *  6. Availability  - weekly availability grid
 *  7. Linked Accounts - sub-account management
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Key } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from '@/lib/motion';

import User from 'lucide-react/icons/user';
import Bell from 'lucide-react/icons/bell';
import Shield from 'lucide-react/icons/shield';
import Lock from 'lucide-react/icons/lock';
import Settings from 'lucide-react/icons/settings';
import Sparkles from 'lucide-react/icons/sparkles';
import Calendar from 'lucide-react/icons/calendar';
import Users from 'lucide-react/icons/users';
import Info from 'lucide-react/icons/info';
import Languages from 'lucide-react/icons/languages';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { sanitizeRichText } from '@/lib/sanitize';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Tabs, Tab } from '@/components/ui/Tabs';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { AvailabilityGrid } from '@/components/availability/AvailabilityGrid';
import { AppearanceSettings } from '@/components/settings/AppearanceSettings';
import { useAuth, useToast, useTenant } from '@/contexts';
import { api, tokenManager } from '@/lib/api';
import { isAvatarFileTooLarge, isSupportedAvatarFile } from '@/lib/avatarUpload';
import { logError } from '@/lib/logger';
import { usePageTitle } from '@/hooks';
import { useWebPush } from '@/hooks/useWebPush';
import { PageMeta } from '@/components/seo';
import { useTranslation } from 'react-i18next';

// Tab components
import { ProfileTab } from './tabs/ProfileTab';
import type { ProfileFormData } from './tabs/ProfileTab';
import { NotificationsTab } from './tabs/NotificationsTab';
import type { NotificationSettings } from './tabs/NotificationsTab';
import { PrivacyTab } from './tabs/PrivacyTab';
import type { PrivacySettings, UserInsuranceCert } from './tabs/PrivacyTab';
import { SecurityTab } from './tabs/SecurityTab';
import type { SessionInfo, TwoFactorSetup } from './tabs/SecurityTab';
import { isDeleteConfirmed } from './deleteConfirmation';
import { DeleteConfirmationField } from './DeleteConfirmationField';
import { SkillsTab } from './tabs/SkillsTab';
import { LinkedAccountsTab } from './tabs/LinkedAccountsTab';
import { ConnectedAccountsTab } from './tabs/ConnectedAccountsTab';
import { SafeguardingTab } from './tabs/SafeguardingTab';
import { TranslationTab } from './tabs/TranslationTab';
import { buildStoredUserName } from '@/lib/helpers';

const SETTINGS_TABS = [
  'profile',
  'notifications',
  'privacy',
  'security',
  'skills',
  'availability',
  'linked-accounts',
  'connected-accounts',
  'safeguarding',
  'translation',
] as const;

type SettingsTabKey = (typeof SETTINGS_TABS)[number];

interface NotificationSettingsSnapshot {
  notifications: NotificationSettings;
  matchDigestFrequency: string;
  notifyHotMatches: boolean;
  notifyMutualMatches: boolean;
  digestFrequency: string;
}

interface AtomicNotificationSettingsResponse {
  notifications: NotificationSettings;
  match_preferences: {
    notification_frequency: string;
    notify_hot_matches: boolean;
    notify_mutual_matches: boolean;
  };
  digest_frequency: string;
}

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  email_messages: true,
  email_listings: true,
  email_digest: false,
  email_connections: true,
  email_transactions: true,
  email_reviews: true,
  email_events: true,
  email_gamification_digest: true,
  email_gamification_milestones: true,
  email_org_payments: true,
  email_org_transfers: true,
  email_org_membership: true,
  email_org_admin: true,
  caring_smart_nudges: true,
  federation_notifications_enabled: true,
  push_enabled: true,
  push_campaigns_opted_in: false,
};

function isSettingsTabKey(value: string | null): value is SettingsTabKey {
  return !!value && SETTINGS_TABS.includes(value as SettingsTabKey);
}

// ─────────────────────────────────────────────────────────────────────────────
// Animation Variants
// ─────────────────────────────────────────────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function SettingsPage() {
  const { t } = useTranslation('settings');
  usePageTitle(t('page_meta.title'));
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, logout, refreshUser } = useAuth();
  const { tenantPath, tenant, hasFeature } = useTenant();
  const toast = useToast();
  const { subscribe: subscribeWebPush, unsubscribe: unsubscribeWebPush } = useWebPush();
  const tabParam = searchParams.get('tab');
  const initialTab: SettingsTabKey = isSettingsTabKey(tabParam) ? tabParam : 'profile';
  const [activeTab, setActiveTab] = useState<SettingsTabKey>(initialTab);
  const [pendingTab, setPendingTab] = useState<SettingsTabKey | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const dirtyTab = useRef<SettingsTabKey | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const profileSnapshot = useRef<ProfileFormData | null>(null);
  const notificationSnapshot = useRef<NotificationSettingsSnapshot | null>(null);
  const privacySnapshot = useRef<PrivacySettings | null>(null);
  const loadedTabs = useRef<Set<SettingsTabKey>>(new Set());
  const insuranceLoaded = useRef(false);
  const markDirty = useCallback((tab: SettingsTabKey) => {
    dirtyTab.current = tab;
    setIsDirty(true);
  }, []);

  // Warn on browser close/refresh when form is dirty
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Modal states
  const passwordModal = useDisclosure();
  const deleteModal = useDisclosure();
  const logoutModal = useDisclosure();
  const twoFactorSetupModal = useDisclosure();
  const twoFactorDisableModal = useDisclosure();
  const backupCodesModal = useDisclosure();
  const gdprModal = useDisclosure();
  const marketingConsentModal = useDisclosure();
  const unsavedChangesModal = useDisclosure();

  // Password form
  const [passwordData, setPasswordData] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // Delete confirmation
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  // Error state for notification settings
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [notificationLoading, setNotificationLoading] = useState(false);

  // Identity verification status — lock name fields if verified
  interface IdentityStatusResponse {
    has_id_verified_badge: boolean;
  }
  const [isIdVerified, setIsIdVerified] = useState(false);
  useEffect(() => {
    if (!user?.id || activeTab !== 'profile') return;
    let cancelled = false;
    api.get<IdentityStatusResponse>('/v2/identity/status').then((res) => {
      if (!cancelled && res?.data?.has_id_verified_badge) setIsIdVerified(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [activeTab, user?.id]);

  // Profile form
  const [profileData, setProfileData] = useState<ProfileFormData>({
    first_name: '',
    last_name: '',
    name: '',
    date_of_birth: '',
    phone: '',
    tagline: '',
    bio: '',
    location: '',
    latitude: undefined,
    longitude: undefined,
    avatar: null,
    profile_type: 'individual',
    organization_name: '',
  });

  // Notification settings
  const [notifications, setNotifications] = useState<NotificationSettings>({ ...DEFAULT_NOTIFICATION_SETTINGS });

  // Match digest frequency & preferences
  const [matchDigestFrequency, setMatchDigestFrequency] = useState<string>('monthly');
  const [notifyHotMatches, setNotifyHotMatches] = useState(true);
  const [notifyMutualMatches, setNotifyMutualMatches] = useState(true);

  // Global activity-digest frequency (notification_settings.global). 'off' is
  // the spam-safe default — members opt in to receive a digest of group/thread
  // activity. Critical events (DMs, connection requests, transactions) are
  // always instant regardless of this value.
  const [digestFrequency, setDigestFrequency] = useState<string>('off');

  // Marketing consent
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [marketingConsentLoading, setMarketingConsentLoading] = useState(false);

  // Privacy settings
  const [privacy, setPrivacy] = useState<PrivacySettings>({
    profile_visibility: 'members',
    search_indexing: true,
  });
  const [isSavingPrivacy, setIsSavingPrivacy] = useState(false);
  const [privacyLoading, setPrivacyLoading] = useState(false);
  const [privacyError, setPrivacyError] = useState<string | null>(null);

  // 2FA state
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [twoFactorLoading, setTwoFactorLoading] = useState(true);
  const [twoFactorSetupData, setTwoFactorSetupData] = useState<TwoFactorSetup | null>(null);
  const [twoFactorVerifyCode, setTwoFactorVerifyCode] = useState('');
  const [isVerifying2FA, setIsVerifying2FA] = useState(false);
  const [twoFactorDisablePassword, setTwoFactorDisablePassword] = useState('');
  const [isDisabling2FA, setIsDisabling2FA] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [backupCodesRemaining, setBackupCodesRemaining] = useState(0);

  // Sessions state
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  // GDPR state
  const [gdprRequestType, setGdprRequestType] = useState<string>('');
  const [isSubmittingGdpr, setIsSubmittingGdpr] = useState(false);

  // Insurance certificates (user-facing)
  const [insuranceCerts, setInsuranceCerts] = useState<UserInsuranceCert[]>([]);
  const [insuranceLoading, setInsuranceLoading] = useState(false);
  const [insuranceUploading, setInsuranceUploading] = useState(false);
  const [insuranceType, setInsuranceType] = useState('public_liability');
  const [insuranceProvider, setInsuranceProvider] = useState('');
  const [insuranceExpiry, setInsuranceExpiry] = useState('');
  const activeTabLabel = t(`tabs.${activeTab === 'linked-accounts' ? 'linked' : activeTab === 'connected-accounts' ? 'connected_accounts' : activeTab}`);

  const setTabSearchParam = useCallback((tab: SettingsTabKey) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (tab === 'profile') {
        next.delete('tab');
      } else {
        next.set('tab', tab);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const applyTabSelection = useCallback((tab: SettingsTabKey) => {
    setActiveTab(tab);
    setTabSearchParam(tab);
  }, [setTabSearchParam]);

  // Keep controlled tab state aligned with deep links and browser history.
  // When history navigation occurs with unsaved edits, restore the current URL
  // until the member explicitly chooses whether to leave the edited section.
  useEffect(() => {
    const requestedTab: SettingsTabKey = isSettingsTabKey(tabParam) ? tabParam : 'profile';
    if (!isSettingsTabKey(tabParam) && tabParam !== null) {
      setTabSearchParam('profile');
    }
    if (requestedTab === activeTab) return;
    if (isDirty) {
      setPendingTab(requestedTab);
      setTabSearchParam(activeTab);
      unsavedChangesModal.onOpen();
      return;
    }
    setActiveTab(requestedTab);
  }, [activeTab, isDirty, setTabSearchParam, tabParam, unsavedChangesModal]);

  const handleTabSelection = useCallback((key: Key) => {
    const nextTab = String(key);
    if (!isSettingsTabKey(nextTab) || nextTab === activeTab) return;
    if (isDirty) {
      setPendingTab(nextTab);
      unsavedChangesModal.onOpen();
      return;
    }
    applyTabSelection(nextTab);
  }, [activeTab, applyTabSelection, isDirty, unsavedChangesModal]);

  const restoreActiveTab = useCallback(() => {
    if (activeTab === 'profile' && profileSnapshot.current) {
      setProfileData({ ...profileSnapshot.current });
    } else if (activeTab === 'notifications' && notificationSnapshot.current) {
      const snapshot = notificationSnapshot.current;
      if (notifications.push_enabled !== snapshot.notifications.push_enabled) {
        // The browser subscription is changed immediately by the push toggle.
        // Reconcile that external side effect as well as React state when the
        // member discards the notification form.
        void (snapshot.notifications.push_enabled ? subscribeWebPush() : unsubscribeWebPush());
      }
      setNotifications({ ...snapshot.notifications });
      setMatchDigestFrequency(snapshot.matchDigestFrequency);
      setNotifyHotMatches(snapshot.notifyHotMatches);
      setNotifyMutualMatches(snapshot.notifyMutualMatches);
      setDigestFrequency(snapshot.digestFrequency);
    } else if (activeTab === 'privacy' && privacySnapshot.current) {
      setPrivacy({ ...privacySnapshot.current });
    }
  }, [activeTab, notifications.push_enabled, subscribeWebPush, unsubscribeWebPush]);

  const discardChangesAndSwitchTab = useCallback(() => {
    if (pendingTab) {
      restoreActiveTab();
      dirtyTab.current = null;
      setIsDirty(false);
      applyTabSelection(pendingTab);
    }
    setPendingTab(null);
    unsavedChangesModal.onClose();
  }, [applyTabSelection, pendingTab, restoreActiveTab, unsavedChangesModal]);

  // ─────────────────────────────────────────────────────────────────────────
  // Data Loading
  // ─────────────────────────────────────────────────────────────────────────

  const loadNotificationSettings = useCallback(async () => {
    try {
      setNotificationLoading(true);
      setNotificationError(null);
      const [notificationResponse, matchResponse, digestResponse, consentResponse] = await Promise.all([
        api.get<NotificationSettings>('/v2/users/me/notifications'),
        api.get<{ notification_frequency: string; notify_hot_matches: boolean; notify_mutual_matches: boolean }>('/v2/users/me/match-preferences'),
        api.get<{ global_frequency: string }>('/v2/notifications/settings'),
        api.get<Array<{ consent_type_slug: string; given: boolean }>>('/v2/users/me/consent'),
      ]);

      if (
        !notificationResponse.success || !notificationResponse.data
        || !matchResponse.success || !matchResponse.data
        || !digestResponse.success || !digestResponse.data
        || !consentResponse.success || !Array.isArray(consentResponse.data)
      ) {
        setNotificationError(t('notification_load_failed'));
        loadedTabs.current.delete('notifications');
        return;
      }

      const nextNotifications = { ...DEFAULT_NOTIFICATION_SETTINGS, ...notificationResponse.data };
      const nextMatchFrequency = matchResponse.data.notification_frequency === 'weekly'
        ? 'monthly'
        : matchResponse.data.notification_frequency || 'monthly';
      const nextDigestFrequency = digestResponse.data.global_frequency === 'weekly'
        ? 'monthly'
        : digestResponse.data.global_frequency || 'off';
      const marketing = consentResponse.data.find((consent) => consent.consent_type_slug === 'marketing_email');

      setNotifications(nextNotifications);
      setMatchDigestFrequency(nextMatchFrequency);
      setNotifyHotMatches(matchResponse.data.notify_hot_matches ?? true);
      setNotifyMutualMatches(matchResponse.data.notify_mutual_matches ?? true);
      setDigestFrequency(nextDigestFrequency);
      setMarketingConsent(marketing?.given ?? false);
      notificationSnapshot.current = {
        notifications: { ...nextNotifications },
        matchDigestFrequency: nextMatchFrequency,
        notifyHotMatches: matchResponse.data.notify_hot_matches ?? true,
        notifyMutualMatches: matchResponse.data.notify_mutual_matches ?? true,
        digestFrequency: nextDigestFrequency,
      };
      loadedTabs.current.add('notifications');
    } catch (error) {
      logError('Failed to load notification settings', error);
      setNotificationError(t('notification_load_failed'));
      loadedTabs.current.delete('notifications');
    } finally {
      setNotificationLoading(false);
    }
  }, [t]);

  const loadPrivacySettings = useCallback(async () => {
    try {
      setPrivacyLoading(true);
      setPrivacyError(null);
      const response = await api.get<{ privacy: { privacy_profile: string; privacy_search: boolean } }>('/v2/users/me/preferences');
      if (response.success && response.data?.privacy) {
        const p = response.data.privacy;
        const nextPrivacy: PrivacySettings = {
          profile_visibility: (p.privacy_profile as 'public' | 'members' | 'connections') || 'members',
          search_indexing: p.privacy_search ?? true,
        };
        setPrivacy(nextPrivacy);
        privacySnapshot.current = { ...nextPrivacy };
        loadedTabs.current.add('privacy');
      } else {
        setPrivacyError(t('privacy_load_failed'));
        loadedTabs.current.delete('privacy');
      }
    } catch (error) {
      logError('Failed to load privacy settings', error);
      setPrivacyError(t('privacy_load_failed'));
      loadedTabs.current.delete('privacy');
    } finally {
      setPrivacyLoading(false);
    }
  }, [t]);

  const loadTwoFactorStatus = useCallback(async () => {
    try {
      setTwoFactorLoading(true);
      const response = await api.get<{
        enabled: boolean;
        backup_codes_remaining: number;
      }>('/v2/auth/2fa/status');
      if (response.success && response.data) {
        setTwoFactorEnabled(response.data.enabled);
        setBackupCodesRemaining(response.data.backup_codes_remaining);
      }
    } catch (error) {
      logError('Failed to load 2FA status', error);
    } finally {
      setTwoFactorLoading(false);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      setSessionsLoading(true);
      setSessionsError(null);
      const response = await api.get<SessionInfo[]>('/v2/users/me/sessions');
      if (response.success && response.data) {
        setSessions(Array.isArray(response.data) ? response.data : []);
      } else {
        // The sessions endpoint is live — a failure here is a real API error,
        // not a missing feature. Never mask it as "coming soon".
        setSessionsError(t('sessions_load_error'));
      }
    } catch (error) {
      logError('Failed to load sessions', error);
      setSessionsError(t('sessions_load_error'));
    } finally {
      setSessionsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (user) {
      const nextProfileData: ProfileFormData = {
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        name: user.name || '',
        date_of_birth: user.date_of_birth || '',
        phone: user.phone || '',
        tagline: user.tagline || '',
        bio: user.bio || '',
        location: user.location || '',
        latitude: user.latitude ?? undefined,
        longitude: user.longitude ?? undefined,
        avatar: user.avatar_url || user.avatar || null,
        profile_type: user.profile_type || 'individual',
        organization_name: user.organization_name || '',
      };
      if (dirtyTab.current !== 'profile') {
        setProfileData(nextProfileData);
        profileSnapshot.current = { ...nextProfileData };
      }
      loadedTabs.current.add('profile');
      setTwoFactorEnabled(user.has_2fa_enabled || false);
    }
  }, [user]);

  // Load insurance certificates when insurance is enabled
  const loadInsuranceCerts = useCallback(async () => {
    if (!tenant?.compliance?.insurance_enabled) return;
    setInsuranceLoading(true);
    try {
      const res = await api.get<UserInsuranceCert[]>('/v2/users/me/insurance');
      if (res.success && Array.isArray(res.data)) {
        setInsuranceCerts(res.data);
        insuranceLoaded.current = true;
      } else {
        insuranceLoaded.current = false;
      }
    } catch {
      // Insurance table may not exist
      insuranceLoaded.current = false;
    } finally {
      setInsuranceLoading(false);
    }
  }, [tenant?.compliance?.insurance_enabled]);

  // Load only the data needed by the first visit to each tab. Tab components
  // with their own data contracts continue to load when they mount.
  useEffect(() => {
    if (!user) return;

    if (activeTab === 'notifications' && !loadedTabs.current.has('notifications')) {
      loadedTabs.current.add('notifications');
      void loadNotificationSettings();
    } else if (activeTab === 'privacy' && !loadedTabs.current.has('privacy')) {
      loadedTabs.current.add('privacy');
      void loadPrivacySettings();
    } else if (activeTab === 'security' && !loadedTabs.current.has('security')) {
      loadedTabs.current.add('security');
      void Promise.all([loadTwoFactorStatus(), loadSessions()]);
    }

    if (activeTab === 'privacy' && tenant?.compliance?.insurance_enabled && !insuranceLoaded.current) {
      insuranceLoaded.current = true;
      void loadInsuranceCerts();
    }
  }, [activeTab, loadInsuranceCerts, loadNotificationSettings, loadPrivacySettings, loadSessions, loadTwoFactorStatus, tenant?.compliance?.insurance_enabled, user]);

  // ─────────────────────────────────────────────────────────────────────────
  // Save Handlers
  // ─────────────────────────────────────────────────────────────────────────

  const saveProfile = useCallback(async () => {
    try {
      setIsSaving(true);
      // Sanitize bio with the unified rich-text profile (XSS guard).
      const sanitizedBio = sanitizeRichText(profileData.bio);
      const payload: Record<string, unknown> = {
        first_name: profileData.first_name,
        last_name: profileData.last_name,
        // A SAVE, so build the name from the parts being saved rather than
        // reusing the display name (which would prefer the pre-edit value).
        // The API recomputes `users.name` itself; this keeps the payload honest.
        name: buildStoredUserName(profileData) || profileData.name,
        phone: profileData.phone,
        tagline: profileData.tagline,
        bio: sanitizedBio,
        location: profileData.location,
        latitude: profileData.latitude,
        longitude: profileData.longitude,
        profile_type: profileData.profile_type,
        organization_name: profileData.profile_type === 'organisation' ? profileData.organization_name : '',
      };
      // Let unverified members clear DOB; verified profiles are locked server-side.
      if (!isIdVerified) {
        payload.date_of_birth = profileData.date_of_birth || null;
      }
      const response = await api.put('/v2/users/me', payload);
      if (response.success) {
        const savedProfile = {
          ...profileData,
          bio: sanitizedBio,
          name: payload.name as string,
          organization_name: payload.organization_name as string,
        };
        setProfileData(savedProfile);
        profileSnapshot.current = { ...savedProfile };
        dirtyTab.current = null;
        setIsDirty(false);
        toast.success(t('toasts.profile_updated'));
        if (refreshUser) await refreshUser();
      } else {
        toast.error(response.error || t('toasts.profile_save_failed'));
      }
    } catch (error) {
      logError('Failed to save profile', error);
      toast.error(t('toasts.profile_save_failed'));
    } finally {
      setIsSaving(false);
    }
  }, [isIdVerified, profileData, refreshUser, toast, t]);

  const saveNotifications = useCallback(async () => {
    try {
      setIsSaving(true);
      const response = await api.put<AtomicNotificationSettingsResponse>('/v2/users/me/notification-settings', {
        notifications,
        match_preferences: {
          notification_frequency: matchDigestFrequency,
          notify_hot_matches: notifyHotMatches,
          notify_mutual_matches: notifyMutualMatches,
        },
        digest_frequency: digestFrequency,
      });
      if (response.success) {
        const canonical = response.data;
        const savedNotifications = canonical?.notifications
          ? { ...DEFAULT_NOTIFICATION_SETTINGS, ...canonical.notifications }
          : { ...notifications };
        const savedMatchFrequency = canonical?.match_preferences?.notification_frequency === 'weekly'
          ? 'monthly'
          : canonical?.match_preferences?.notification_frequency || matchDigestFrequency;
        const savedNotifyHotMatches = canonical?.match_preferences?.notify_hot_matches ?? notifyHotMatches;
        const savedNotifyMutualMatches = canonical?.match_preferences?.notify_mutual_matches ?? notifyMutualMatches;
        const savedDigestFrequency = canonical?.digest_frequency === 'weekly'
          ? 'monthly'
          : canonical?.digest_frequency || digestFrequency;

        setNotifications(savedNotifications);
        setMatchDigestFrequency(savedMatchFrequency);
        setNotifyHotMatches(savedNotifyHotMatches);
        setNotifyMutualMatches(savedNotifyMutualMatches);
        setDigestFrequency(savedDigestFrequency);
        notificationSnapshot.current = {
          notifications: { ...savedNotifications },
          matchDigestFrequency: savedMatchFrequency,
          notifyHotMatches: savedNotifyHotMatches,
          notifyMutualMatches: savedNotifyMutualMatches,
          digestFrequency: savedDigestFrequency,
        };
        dirtyTab.current = null;
        setIsDirty(false);
        toast.success(t('toasts.notifications_saved'));
      } else {
        toast.error(response.error || t('toasts.notifications_save_failed'));
      }
    } catch (error) {
      logError('Failed to save notifications', error);
      toast.error(t('toasts.notifications_save_failed'));
    } finally {
      setIsSaving(false);
    }
  }, [notifications, matchDigestFrequency, notifyHotMatches, notifyMutualMatches, digestFrequency, toast, t]);

  const savePrivacy = useCallback(async () => {
    if (!privacySnapshot.current || privacyLoading || privacyError) return;
    try {
      setIsSavingPrivacy(true);
      // Map React field names to PHP field names
      const response = await api.put('/v2/users/me/preferences', {
        privacy: {
          privacy_profile: privacy.profile_visibility,
          privacy_search: privacy.search_indexing,
        },
      });
      if (response.success) {
        privacySnapshot.current = { ...privacy };
        dirtyTab.current = null;
        setIsDirty(false);
        toast.success(t('toasts.privacy_saved'));
      } else {
        toast.error(response.error || t('toasts.privacy_save_failed'));
      }
    } catch (error) {
      logError('Failed to save privacy settings', error);
      toast.error(t('toasts.privacy_save_failed'));
    } finally {
      setIsSavingPrivacy(false);
    }
  }, [privacy, privacyError, privacyLoading, toast, t]);

  // ─────────────────────────────────────────────────────────────────────────
  // Auth Handlers
  // ─────────────────────────────────────────────────────────────────────────

  function handleLogout() {
    logout();
    logoutModal.onClose();
  }

  // Avatar upload handler
  async function handleAvatarUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset input so the same file can be re-selected
    event.target.value = '';

    if (!isSupportedAvatarFile(file)) {
      toast.error(t('toasts.invalid_file_type'), t('toasts.invalid_file_type_desc'));
      return;
    }

    if (isAvatarFileTooLarge(file)) {
      toast.error(t('toasts.file_too_large'), t('toasts.avatar_file_too_large_desc'));
      return;
    }

    try {
      setIsUploading(true);
      const formData = new FormData();
      formData.append('avatar', file);

      const response = await api.upload<{ avatar_url: string }>('/v2/users/me/avatar', formData);

      if (response.success && response.data) {
        setProfileData((prev) => ({ ...prev, avatar: response.data!.avatar_url }));
        if (profileSnapshot.current) {
          profileSnapshot.current = { ...profileSnapshot.current, avatar: response.data.avatar_url };
        }
        if (refreshUser) await refreshUser();
        toast.success(t('toasts.avatar_updated'), t('toasts.avatar_updated_desc'));
      } else {
        logError('Failed to upload avatar', response);
        toast.error(t('toasts.upload_failed'), t('toasts.avatar_upload_failed_desc'));
      }
    } catch (error) {
      logError('Failed to upload avatar', error);
      toast.error(t('toasts.upload_failed'), t('toasts.avatar_upload_failed_desc'));
    } finally {
      setIsUploading(false);
    }
  }

  // Password change handler
  async function handleChangePassword() {
    if (!passwordData.current_password || !passwordData.new_password || !passwordData.confirm_password) {
      toast.error(t('toasts.missing_fields'), t('toasts.missing_password_fields'));
      return;
    }

    if (passwordData.new_password.length < 12) {
      toast.error(t('toasts.password_too_short'), t('toasts.password_too_short_desc'));
      return;
    }

    if (passwordData.new_password !== passwordData.confirm_password) {
      toast.error(t('toasts.passwords_dont_match'), t('toasts.passwords_dont_match_desc'));
      return;
    }

    try {
      setIsChangingPassword(true);
      const response = await api.post('/v2/users/me/password', {
        current_password: passwordData.current_password,
        new_password: passwordData.new_password,
      });

      if (response.success) {
        toast.success(t('toasts.password_changed'), t('toasts.password_changed_desc'));
        passwordModal.onClose();
        setPasswordData({ current_password: '', new_password: '', confirm_password: '' });
      } else {
        toast.error(t('toasts.password_change_failed'), response.error || t('toasts.password_change_failed'));
      }
    } catch (error) {
      logError('Failed to change password', error);
      toast.error(t('toasts.password_change_failed'), t('toasts.password_incorrect_desc'));
    } finally {
      setIsChangingPassword(false);
    }
  }

  // Delete account handler
  async function handleDeleteAccount() {
    // Accept the localized keyword the UI told the user to type (or canonical
    // "DELETE"); case-insensitive + trimmed. See deleteConfirmation.ts.
    if (!isDeleteConfirmed(deleteConfirmation, t('delete_modal.placeholder'))) {
      toast.error(t('toasts.confirmation_required'), t('toasts.type_delete_to_confirm'));
      return;
    }

    try {
      setIsDeleting(true);
      // Backend requires password re-authentication before erasure.
      const response = await api.delete('/v2/users/me', { body: { password: deletePassword } });

      if (response.success) {
        setDeletePassword('');
        toast.success(t('toasts.account_deleted'), t('toasts.account_deleted_desc'));
        await logout();
        navigate(tenantPath('/'));
      } else {
        toast.error(t('toasts.delete_failed'), t('toasts.delete_failed_desc'));
      }
    } catch (error) {
      logError('Failed to delete account', error);
      toast.error(t('toasts.delete_failed'), t('toasts.delete_failed_desc'));
    } finally {
      setIsDeleting(false);
    }
  }

  // Open the shared Delete Account modal with a clean slate. Used by both the
  // Security tab and the Privacy tab so the destructive action is identical
  // wherever it is surfaced.
  function handleOpenDeleteModal() {
    setDeleteConfirmation('');
    setDeletePassword('');
    deleteModal.onOpen();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2FA Handlers
  // ─────────────────────────────────────────────────────────────────────────

  async function handleSetup2FA() {
    try {
      setTwoFactorSetupData(null);
      setTwoFactorVerifyCode('');
      twoFactorSetupModal.onOpen();

      const response = await api.post<TwoFactorSetup>('/v2/auth/2fa/setup');
      if (response.success && response.data) {
        setTwoFactorSetupData(response.data);
      } else {
        toast.error(t('toasts.twofa_setup_failed'), response.error || t('toasts.twofa_setup_failed_desc'));
        twoFactorSetupModal.onClose();
      }
    } catch (error) {
      logError('Failed to setup 2FA', error);
      toast.error(t('toasts.twofa_setup_failed'), t('toasts.twofa_setup_failed_desc'));
      twoFactorSetupModal.onClose();
    }
  }

  async function handleVerify2FA() {
    if (!twoFactorVerifyCode || twoFactorVerifyCode.length < 6) {
      toast.error(t('toasts.invalid_code'), t('toasts.invalid_code_desc'));
      return;
    }

    try {
      setIsVerifying2FA(true);
      const response = await api.post<{ backup_codes: string[] }>('/v2/auth/2fa/verify', {
        code: twoFactorVerifyCode,
      });

      if (response.success) {
        setTwoFactorEnabled(true);
        if (response.data?.backup_codes) {
          setBackupCodes(response.data.backup_codes);
          setBackupCodesRemaining(response.data.backup_codes.length);
        }
        toast.success(t('toasts.twofa_enabled'), t('toasts.twofa_enabled_desc'));
        twoFactorSetupModal.onClose();
        // Refresh 2FA status from server to ensure UI is in sync
        loadTwoFactorStatus();
        // Show backup codes
        if (response.data?.backup_codes?.length) {
          backupCodesModal.onOpen();
        }
      } else {
        toast.error(t('toasts.verification_failed'), response.error || t('toasts.verification_failed'));
      }
    } catch (error) {
      logError('Failed to verify 2FA', error);
      toast.error(t('toasts.verification_failed'), t('toasts.verification_failed_desc'));
    } finally {
      setIsVerifying2FA(false);
    }
  }

  async function handleDisable2FA() {
    if (!twoFactorDisablePassword) {
      toast.error(t('toasts.password_required'), t('toasts.password_required_desc'));
      return;
    }

    try {
      setIsDisabling2FA(true);
      const response = await api.post('/v2/auth/2fa/disable', {
        password: twoFactorDisablePassword,
      });

      if (response.success) {
        setTwoFactorEnabled(false);
        setBackupCodesRemaining(0);
        toast.success(t('toasts.twofa_disabled'), t('toasts.twofa_disabled_desc'));
        twoFactorDisableModal.onClose();
        setTwoFactorDisablePassword('');
      } else {
        toast.error(t('toasts.twofa_disable_failed'), response.error || t('toasts.twofa_disable_failed_desc'));
      }
    } catch (error) {
      logError('Failed to disable 2FA', error);
      toast.error(t('toasts.twofa_disable_failed'), t('toasts.twofa_disable_failed_desc'));
    } finally {
      setIsDisabling2FA(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Marketing Consent Handler
  // ─────────────────────────────────────────────────────────────────────────

  async function applyMarketingConsent(checked: boolean) {
    try {
      setMarketingConsentLoading(true);
      const response = await api.put('/v2/users/me/consent', {
        slug: 'marketing_email',
        given: checked,
      });
      if (response.success) {
        setMarketingConsent(checked);
        toast.success(checked ? t('toasts.marketing_subscribed') : t('toasts.marketing_unsubscribed'));
      } else {
        toast.error(t('toasts.marketing_consent_failed'));
      }
    } catch (error) {
      logError('Failed to update marketing consent', error);
      toast.error(t('toasts.marketing_consent_failed'));
    } finally {
      setMarketingConsentLoading(false);
    }
  }

  function handleMarketingConsentToggle(checked: boolean) {
    if (checked) {
      // Turning ON — show confirmation dialog first
      marketingConsentModal.onOpen();
    } else {
      // Turning OFF — apply immediately, no confirmation needed
      applyMarketingConsent(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GDPR Handler
  // ─────────────────────────────────────────────────────────────────────────

  async function handleGdprRequest() {
    if (!gdprRequestType) return;

    // Map UI types to GDPR API types. Access/portability are now served by the
    // instant Data Export page, and erasure by the Delete Account modal — so the
    // request flow only covers rectification, restriction, and objection.
    const typeMap: Record<string, string> = {
      rectification: 'rectification',
      restriction: 'restriction',
      objection: 'objection',
    };

    try {
      setIsSubmittingGdpr(true);
      const response = await api.post('/v2/users/me/gdpr-request', {
        type: typeMap[gdprRequestType] || gdprRequestType,
      });

      if (response.success) {
        toast.success(t('toasts.request_submitted'), t('toasts.gdpr_request_submitted_desc'));
        gdprModal.onClose();
        setGdprRequestType('');
      } else {
        toast.error(t('toasts.request_failed'), response.error || t('toasts.gdpr_request_failed_desc'));
      }
    } catch (error) {
      logError('Failed to submit GDPR request', error);
      toast.error(t('toasts.request_failed'), t('toasts.gdpr_request_failed_desc'));
    } finally {
      setIsSubmittingGdpr(false);
    }
  }

  function openGdprModal(type: string) {
    setGdprRequestType(type);
    gdprModal.onOpen();
  }

  // Insurance metadata only. Raw documents and sensitive policy data are prohibited.
  async function handleInsuranceRecord() {
    if (!insuranceExpiry) {
      toast.error(t('toasts.request_failed'), t('insurance.expiry_required'));
      return;
    }

    setInsuranceUploading(true);
    try {
      const res = await api.post('/v2/users/me/insurance', {
        insurance_type: insuranceType,
        provider_name: insuranceProvider.trim() || null,
        expiry_date: insuranceExpiry,
      });

      if (res.success) {
        toast.success(t('insurance.record_saved'), t('insurance.record_saved_desc'));
        loadInsuranceCerts();
        setInsuranceType('public_liability');
        setInsuranceProvider('');
        setInsuranceExpiry('');
      } else {
        toast.error(t('toasts.request_failed'), res.error || t('insurance.record_failed_desc'));
      }
    } catch {
      toast.error(t('toasts.request_failed'), t('insurance.record_failed_desc'));
    } finally {
      setInsuranceUploading(false);
    }
  }

  // Copy backup codes to clipboard
  async function handleCopyBackupCodes() {
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      toast.success(t('toasts.copied'), t('toasts.backup_codes_copied_desc'));
    } catch {
      toast.error(t('toasts.copy_failed'), t('toasts.copy_failed_desc'));
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="mx-auto max-w-5xl space-y-6"
    >
      <PageMeta title={t('page_meta.title')} noIndex />
      {/* Header */}
      <motion.div variants={itemVariants} className="overflow-hidden rounded-2xl border border-theme-default bg-theme-surface">
        <div className="flex flex-col gap-5 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <Chip size="sm" variant="soft" color={isDirty ? 'warning' : 'accent'} className="mb-3 font-medium">
              {isDirty ? t('header.unsaved_badge') : t('header.badge')}
            </Chip>
            <h1 className="flex items-center gap-3 text-3xl font-bold leading-tight text-theme-primary sm:text-4xl">
              <Settings className="h-8 w-8 text-accent" aria-hidden="true" />
              {t('header.title')}
            </h1>
            <p className="mt-2 text-sm leading-6 text-theme-muted sm:text-base">{t('header.subtitle')}</p>
          </div>
          <div className="rounded-xl border border-theme-default bg-theme-elevated px-4 py-3 lg:min-w-72">
            <span className="block text-xs font-medium uppercase tracking-wide text-theme-subtle">
              {t('header.current_section')}
            </span>
            <span className="mt-1 block font-semibold text-theme-primary">{activeTabLabel}</span>
          </div>
        </div>
      </motion.div>

      {/* Tabs */}
      <motion.div
        variants={itemVariants}
        className="relative max-w-full rounded-2xl border border-theme-default bg-theme-surface p-2"
      >
        <Tabs
          aria-label={t('tabs_aria')}
          selectedKey={activeTab}
          onSelectionChange={handleTabSelection}
          scrollAffordance
          classNames={{
            base: 'w-full max-w-full',
            tabList: 'w-full max-w-full justify-start gap-1 bg-transparent p-0',
            cursor: 'bg-theme-elevated shadow-sm',
            tab: 'w-auto flex-none px-2.5 sm:px-3 text-sm text-theme-muted data-[selected=true]:text-theme-primary',
            tabContent: 'whitespace-nowrap',
          }}
        >
          <Tab
            key="profile"
            title={
              <span className="flex items-center gap-2">
                <User className="w-4 h-4" aria-hidden="true" />
                {t("tabs.profile")}
              </span>
            }
          />
          <Tab
            key="notifications"
            title={
              <span className="flex items-center gap-2">
                <Bell className="w-4 h-4" aria-hidden="true" />
                {t("tabs.notifications")}
              </span>
            }
          />
          <Tab
            key="privacy"
            title={
              <span className="flex items-center gap-2">
                <Shield className="w-4 h-4" aria-hidden="true" />
                {t("tabs.privacy")}
              </span>
            }
          />
          <Tab
            key="security"
            title={
              <span className="flex items-center gap-2">
                <Lock className="w-4 h-4" aria-hidden="true" />
                {t("tabs.security")}
              </span>
            }
          />
          <Tab
            key="skills"
            title={
              <span className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" aria-hidden="true" />
                {t("tabs.skills")}
              </span>
            }
          />
          <Tab
            key="availability"
            title={
              <span className="flex items-center gap-2">
                <Calendar className="w-4 h-4" aria-hidden="true" />
                {t("tabs.availability")}
              </span>
            }
          />
          <Tab
            key="linked-accounts"
            title={
              <span className="flex items-center gap-2">
                <Users className="w-4 h-4" aria-hidden="true" />
                {t("tabs.linked")}
              </span>
            }
          />
          <Tab
            key="connected-accounts"
            title={
              <span className="flex items-center gap-2">
                <Lock className="w-4 h-4" aria-hidden="true" />
                {t("tabs.connected_accounts")}
              </span>
            }
          />
          <Tab
            key="safeguarding"
            title={
              <span className="flex items-center gap-2">
                <Shield className="w-4 h-4" aria-hidden="true" />
                {t("tabs.safeguarding")}
              </span>
            }
          />
          <Tab
            key="translation"
            title={
              <span className="flex items-center gap-2">
                <Languages className="w-4 h-4" aria-hidden="true" />
                {t("tabs.translation")}
              </span>
            }
          />
        </Tabs>
      </motion.div>

      {/* Tab Content */}
      <motion.div variants={itemVariants}>
        {/* PROFILE TAB */}
        {activeTab === 'profile' && (
          <>
            <ProfileTab
              profileData={profileData}
              isSaving={isSaving}
              isUploading={isUploading}
              isIdVerified={isIdVerified}
              isDirty={isDirty}
              onProfileDataChange={(updater) => {
                setProfileData(updater);
                markDirty('profile');
              }}
              onSave={saveProfile}
              onAvatarUpload={handleAvatarUpload}
            />
            {/* Appearance Preferences (not included in ProfileTab component) */}
            <GlassCard className="p-6 mt-6">
              <h2 className="text-lg font-semibold text-theme-primary mb-6 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-accent" aria-hidden="true" />
                {t('appearance_prefs.title')}
              </h2>
              <AppearanceSettings />
            </GlassCard>
          </>
        )}

        {/* NOTIFICATIONS TAB */}
        {activeTab === 'notifications' && (
          <NotificationsTab
            notifications={notifications}
            notificationError={notificationError}
            notificationLoading={notificationLoading}
            isSaving={isSaving}
            matchDigestFrequency={matchDigestFrequency}
            notifyHotMatches={notifyHotMatches}
            notifyMutualMatches={notifyMutualMatches}
            marketingConsent={marketingConsent}
            marketingConsentLoading={marketingConsentLoading}
            isOrganisation={profileData.profile_type === 'organisation'}
            digestFrequency={digestFrequency}
            onNotificationsChange={(updater) => { setNotifications(updater); markDirty('notifications'); }}
            onMatchDigestFrequencyChange={(v) => { setMatchDigestFrequency(v); markDirty('notifications'); }}
            onNotifyHotMatchesChange={(v) => { setNotifyHotMatches(v); markDirty('notifications'); }}
            onNotifyMutualMatchesChange={(v) => { setNotifyMutualMatches(v); markDirty('notifications'); }}
            onMarketingConsentToggle={handleMarketingConsentToggle}
            onDigestFrequencyChange={(v) => { setDigestFrequency(v); markDirty('notifications'); }}
            onSave={saveNotifications}
            onRetry={loadNotificationSettings}
          />
        )}

        {/* PRIVACY TAB */}
        {activeTab === 'privacy' && (
          <PrivacyTab
            privacy={privacy}
            isSavingPrivacy={isSavingPrivacy}
            privacyLoading={privacyLoading}
            privacyError={privacyError}
            insuranceCerts={insuranceCerts}
            insuranceLoading={insuranceLoading}
            insuranceUploading={insuranceUploading}
            insuranceType={insuranceType}
            insuranceProvider={insuranceProvider}
            insuranceExpiry={insuranceExpiry}
            insuranceEnabled={!!tenant?.compliance?.insurance_enabled}
            federationEnabled={!!hasFeature?.('federation')}
            onPrivacyChange={(updater) => { setPrivacy(updater); markDirty('privacy'); }}
            onSavePrivacy={savePrivacy}
            onRetryPrivacy={loadPrivacySettings}
            onInsuranceSave={handleInsuranceRecord}
            onInsuranceTypeChange={setInsuranceType}
            onInsuranceProviderChange={setInsuranceProvider}
            onInsuranceExpiryChange={setInsuranceExpiry}
            onOpenGdprModal={openGdprModal}
            onOpenDeleteModal={handleOpenDeleteModal}
          />
        )}

        {/* SECURITY TAB */}
        {activeTab === 'security' && (
          <SecurityTab
            twoFactorEnabled={twoFactorEnabled}
            twoFactorLoading={twoFactorLoading}
            twoFactorSetupData={twoFactorSetupData}
            twoFactorVerifyCode={twoFactorVerifyCode}
            isVerifying2FA={isVerifying2FA}
            twoFactorDisablePassword={twoFactorDisablePassword}
            isDisabling2FA={isDisabling2FA}
            backupCodes={backupCodes}
            backupCodesRemaining={backupCodesRemaining}
            sessions={sessions}
            sessionsLoading={sessionsLoading}
            sessionsError={sessionsError}
            onReloadSessions={loadSessions}
            passwordData={passwordData}
            showCurrentPassword={showCurrentPassword}
            showNewPassword={showNewPassword}
            isChangingPassword={isChangingPassword}
            passwordModalOpen={passwordModal.isOpen}
            passwordModalOnClose={passwordModal.onClose}
            passwordModalOnOpen={passwordModal.onOpen}
            logoutModalOpen={logoutModal.isOpen}
            logoutModalOnClose={logoutModal.onClose}
            logoutModalOnOpen={logoutModal.onOpen}
            deleteModalOnOpen={handleOpenDeleteModal}
            twoFactorSetupModalOpen={twoFactorSetupModal.isOpen}
            twoFactorSetupModalOnClose={twoFactorSetupModal.onClose}
            twoFactorDisableModalOpen={twoFactorDisableModal.isOpen}
            twoFactorDisableModalOnClose={twoFactorDisableModal.onClose}
            twoFactorDisableModalOnOpen={twoFactorDisableModal.onOpen}
            backupCodesModalOpen={backupCodesModal.isOpen}
            backupCodesModalOnClose={backupCodesModal.onClose}
            onPasswordDataChange={setPasswordData}
            onShowCurrentPasswordToggle={() => setShowCurrentPassword(!showCurrentPassword)}
            onShowNewPasswordToggle={() => setShowNewPassword(!showNewPassword)}
            onChangePassword={handleChangePassword}
            onLogout={handleLogout}
            onSetup2FA={handleSetup2FA}
            onVerify2FA={handleVerify2FA}
            onDisable2FA={handleDisable2FA}
            onTwoFactorVerifyCodeChange={setTwoFactorVerifyCode}
            onTwoFactorDisablePasswordChange={setTwoFactorDisablePassword}
            onCopyBackupCodes={handleCopyBackupCodes}
          />
        )}

        {/* SKILLS TAB */}
        {activeTab === 'skills' && <SkillsTab />}

        {/* AVAILABILITY TAB (no separate tab component) */}
        {activeTab === 'availability' && (
          <div className="space-y-6">
            <GlassCard className="p-6">
              <AvailabilityGrid editable />
            </GlassCard>
          </div>
        )}

        {/* LINKED ACCOUNTS TAB */}
        {activeTab === 'linked-accounts' && <LinkedAccountsTab />}

        {/* CONNECTED ACCOUNTS TAB (OAuth — SOC13) */}
        {activeTab === 'connected-accounts' && <ConnectedAccountsTab />}

        {/* SAFEGUARDING TAB */}
        {activeTab === 'safeguarding' && <SafeguardingTab />}
        {activeTab === 'translation' && <TranslationTab />}
      </motion.div>

      {/* Unsaved Changes Confirmation Modal */}
      <Modal
        isOpen={unsavedChangesModal.isOpen}
        onClose={() => {
          setPendingTab(null);
          unsavedChangesModal.onClose();
        }}
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          body: 'py-6',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          <ModalHeader className="text-theme-primary">
            {t('unsaved_changes.title')}
          </ModalHeader>
          <ModalBody>
            <p className="text-theme-muted">
              {t('unsaved_changes.message')}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="tertiary"
              onPress={() => {
                setPendingTab(null);
                unsavedChangesModal.onClose();
              }}
            >
              {t('unsaved_changes.stay')}
            </Button>
            <Button variant="danger" onPress={discardChangesAndSwitchTab}>
              {t('unsaved_changes.leave')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Marketing Consent Confirmation Modal */}
      <Modal
        isOpen={marketingConsentModal.isOpen}
        onClose={marketingConsentModal.onClose}
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          body: 'py-6',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          <ModalHeader className="text-theme-primary">
            {t('marketing_consent_confirm_title')}
          </ModalHeader>
          <ModalBody>
            <p className="text-theme-muted">
              {t('marketing_consent_confirm_body')}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={marketingConsentModal.onClose}>
              {t('cancel')}
            </Button>
            <Button
              className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
              onPress={() => { marketingConsentModal.onClose(); applyMarketingConsent(true); }}
              isLoading={marketingConsentLoading}
            >
              {t('marketing_consent_confirm_button')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* GDPR Request Modal (triggered from PrivacyTab) */}
      <Modal
        isOpen={gdprModal.isOpen}
        onClose={gdprModal.onClose}
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          body: 'py-6',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          <ModalHeader className="text-theme-primary">
            {gdprRequestType === 'rectification' && t('gdpr.rectification_title')}
            {gdprRequestType === 'restriction' && t('gdpr.restriction_title')}
            {gdprRequestType === 'objection' && t('gdpr.objection_title')}
          </ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              {gdprRequestType === 'rectification' && (
                <p className="text-theme-muted">
                  {t("gdpr.rectification_modal_desc")}
                </p>
              )}

              {gdprRequestType === 'restriction' && (
                <p className="text-theme-muted">
                  {t("gdpr.restriction_modal_desc")}
                </p>
              )}

              {gdprRequestType === 'objection' && (
                <p className="text-theme-muted">
                  {t("gdpr.objection_modal_desc")}
                </p>
              )}

              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <p className="text-sm text-theme-muted flex items-start gap-2">
                  <Info className="w-4 h-4 text-[var(--color-info)] flex-shrink-0 mt-0.5" aria-hidden="true" />
                  {t("gdpr.confirmation_email")}
                </p>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={gdprModal.onClose}>
              {t("cancel")}
            </Button>
            <Button
              className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
              onPress={handleGdprRequest}
              isLoading={isSubmittingGdpr}
            >
              {t('gdpr.submit_request')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Delete Account Modal — page-level so it can be opened from both the
          Security tab and the Privacy tab. Performs the immediate, real GDPR
          Article 17 erasure (password re-auth required). */}
      <Modal
        isOpen={deleteModal.isOpen}
        onClose={deleteModal.onClose}
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          body: 'py-6',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          <ModalHeader className="text-red-600 dark:text-red-400 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" aria-hidden="true" />
            {t('delete_modal.title')}
          </ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                <p className="text-theme-danger font-medium">{t('delete_modal.warning')}</p>
                <p className="text-theme-muted text-sm mt-1">
                  {t('delete_modal.warning_desc')}
                </p>
              </div>
              <div>
                <p className="text-theme-muted mb-2">
                  {t('delete_modal.type_confirm')}
                </p>
                <DeleteConfirmationField
                  value={deleteConfirmation}
                  onValueChange={setDeleteConfirmation}
                  placeholder={t('delete_modal.placeholder')}
                  ariaLabel={t('delete_modal.aria_label')}
                  armKey={deleteModal.isOpen}
                />
              </div>
              {/* Password re-authentication — required by the backend before erasure. */}
              <Input
                type="password"
                label={t('password.current')}
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                isRequired
                autoComplete="current-password"
                classNames={{
                  input: 'bg-transparent text-theme-primary',
                  inputWrapper: 'bg-theme-elevated border-theme-default',
                  label: 'text-theme-muted',
                }}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={deleteModal.onClose}>
              {t('cancel')}
            </Button>
            <Button
              variant="danger"
              onPress={handleDeleteAccount}
              isLoading={isDeleting}
              isDisabled={!isDeleteConfirmed(deleteConfirmation, t('delete_modal.placeholder')) || !deletePassword}
            >
              {t('delete_modal.submit')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </motion.div>
  );
}

export default SettingsPage;
