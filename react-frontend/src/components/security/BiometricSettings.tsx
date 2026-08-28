// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState, useEffect, useCallback, useRef } from 'react';

import { getFormattingLocale } from '@/lib/helpers';
import { useDisclosure, Button, Spinner, Input, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Tooltip } from '@/components/ui';

import Fingerprint from 'lucide-react/icons/fingerprint';
import Pencil from 'lucide-react/icons/pencil';
import Trash2 from 'lucide-react/icons/trash-2';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Monitor from 'lucide-react/icons/monitor';
import Smartphone from 'lucide-react/icons/smartphone';
import Tablet from 'lucide-react/icons/tablet';
import Laptop from 'lucide-react/icons/laptop';
import Info from 'lucide-react/icons/info';
import { useTranslation } from 'react-i18next';
import { useAuth, useTenant, useToast } from '@/contexts';
import {
  isWebAuthnSupported,
  registerBiometric,
  getWebAuthnCredentials,
  getWebAuthnStatus,
  confirmWebAuthnSecurity,
  removeWebAuthnCredential,
  renameWebAuthnCredential,
  removeAllWebAuthnCredentials,
  detectPlatform,
  type DevicePlatform,
  type AuthenticatorAttachment,
  type WebAuthnCredential,
  type WebAuthnSecurityConfirmationInput,
} from '@/lib/webauthn';
import { logError } from '@/lib/logger';

type Credential = WebAuthnCredential;
type SecurityConfirmationMethod = 'password' | 'totp' | 'backup';
type PendingSecurityAction =
  | { kind: 'register'; attachment?: AuthenticatorAttachment }
  | { kind: 'remove'; credentialId: string }
  | { kind: 'removeAll' }
  | { kind: 'rename'; credentialId: string; deviceName: string };

interface CachedSecurityConfirmation {
  token: string;
  expiresAt: number;
}

function getDeviceIcon(cred: Credential) {
  const name = (cred.device_name || '').toLowerCase();
  if (name.includes('iphone') || name.includes('android')) return Smartphone;
  if (name.includes('ipad') || name.includes('tablet')) return Tablet;
  if (name.includes('mac') || name.includes('laptop')) return Laptop;
  return Monitor;
}

function getDeviceLabel(cred: Credential, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (cred.device_name) return cred.device_name;
  // Fallback for credentials registered before device_name was added
  if (cred.authenticator_type === 'platform') return t('biometric.label_builtin');
  if (cred.authenticator_type === 'cross-platform') return t('biometric.label_external');
  return t('biometric.label_passkey');
}

function getPlatformInstructions(platform: DevicePlatform, t: (key: string, options?: Record<string, unknown>) => string): { title: string; steps: string[] } {
  const instructions: Record<DevicePlatform, { title: string; steps: string[] }> = {
    windows: {
      title: t('biometric.platform_windows_title'),
      steps: [
        t('biometric.platform_windows_step1'),
        t('biometric.platform_windows_step2'),
        t('biometric.platform_windows_step3'),
        t('biometric.platform_windows_step4'),
      ],
    },
    mac: {
      title: t('biometric.platform_mac_title'),
      steps: [
        t('biometric.platform_mac_step1'),
        t('biometric.platform_mac_step2'),
        t('biometric.platform_mac_step3'),
      ],
    },
    iphone: {
      title: t('biometric.platform_iphone_title'),
      steps: [
        t('biometric.platform_iphone_step1'),
        t('biometric.platform_iphone_step2'),
        t('biometric.platform_iphone_step3'),
      ],
    },
    ipad: {
      title: t('biometric.platform_ipad_title'),
      steps: [
        t('biometric.platform_ipad_step1'),
        t('biometric.platform_ipad_step2'),
        t('biometric.platform_ipad_step3'),
      ],
    },
    android: {
      title: t('biometric.platform_android_title'),
      steps: [
        t('biometric.platform_android_step1'),
        t('biometric.platform_android_step2'),
        t('biometric.platform_android_step3'),
      ],
    },
    linux: {
      title: t('biometric.platform_linux_title'),
      steps: [
        t('biometric.platform_linux_step1'),
        t('biometric.platform_linux_step2'),
      ],
    },
    unknown: {
      title: t('biometric.platform_unknown_title'),
      steps: [
        t('biometric.platform_unknown_step1'),
        t('biometric.platform_unknown_step2'),
      ],
    },
  };
  return instructions[platform];
}

export function BiometricSettings() {
  const { t } = useTranslation('settings');
  const toast = useToast();
  const { logout } = useAuth();
  const { hasFeature, authenticationConfig } = useTenant();
  const passkeyAuthenticationEnabled = hasFeature('biometric_login');
  const passkeyEnrollmentAllowed = passkeyAuthenticationEnabled
    && ((authenticationConfig as { 'passkeys.enrollment_enabled'?: boolean } | undefined)?.['passkeys.enrollment_enabled'] ?? true);

  const [supported, setSupported] = useState<boolean | null>(null);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [currentRpId, setCurrentRpId] = useState<string | null>(null);
  const [maxCredentials, setMaxCredentials] = useState<number | null>(null);
  const [registering, setRegistering] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removingAll, setRemovingAll] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [pendingRemoval, setPendingRemoval] = useState<Credential | null>(null);
  const [showInstructions, setShowInstructions] = useState(true); // Auto-show on first visit
  const [confirmationMethods, setConfirmationMethods] = useState({
    password: true,
    passkey: false,
    totp: false,
  });
  const [confirmationMethod, setConfirmationMethod] = useState<SecurityConfirmationMethod>('password');
  const [confirmationValue, setConfirmationValue] = useState('');
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [confirmingSecurity, setConfirmingSecurity] = useState(false);
  const [securityActionBusy, setSecurityActionBusy] = useState(false);
  const [pendingSecurityAction, setPendingSecurityAction] = useState<PendingSecurityAction | null>(null);
  const securityConfirmationRef = useRef<CachedSecurityConfirmation | null>(null);
  const recentSessionCheckedRef = useRef(false);
  const securityActionInFlightRef = useRef(false);

  const platform = detectPlatform();
  const instructions = getPlatformInstructions(platform, (key, options) => t(key, options));
  const removeAllConfirm = useDisclosure();
  const securityConfirm = useDisclosure();

  const loadCredentials = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [creds, status] = await Promise.all([
        getWebAuthnCredentials(),
        getWebAuthnStatus(),
      ]);
      setCredentials(creds);
      setCurrentRpId(status.current_rp_id ?? null);
      setMaxCredentials(
        typeof status.max_credentials === 'number' && status.max_credentials > 0
          ? status.max_credentials
          : null,
      );
      const methods = status.confirmation_methods;
      if (methods) {
        const available = {
          password: methods.password === true,
          passkey: methods.passkey === true,
          totp: methods.totp === true,
        };
        setConfirmationMethods(available);
        setConfirmationMethod(available.password ? 'password' : available.totp ? 'totp' : 'backup');
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!passkeyAuthenticationEnabled) {
      setSupported(false);
      setLoading(false);
      return;
    }

    setSupported(isWebAuthnSupported());
    void loadCredentials();
  }, [loadCredentials, passkeyAuthenticationEnabled]);

  const confirmationExpiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (confirmationExpiryTimerRef.current) clearTimeout(confirmationExpiryTimerRef.current);
    securityConfirmationRef.current = null;
  }, []);

  const clearSecurityConfirmation = () => {
    securityConfirmationRef.current = null;
    if (confirmationExpiryTimerRef.current) {
      clearTimeout(confirmationExpiryTimerRef.current);
      confirmationExpiryTimerRef.current = null;
    }
  };

  const cacheSecurityConfirmation = (token: string, expiresIn: number) => {
    clearSecurityConfirmation();
    const lifetimeMs = Math.max(1, expiresIn) * 1000;
    securityConfirmationRef.current = { token, expiresAt: Date.now() + lifetimeMs };
    confirmationExpiryTimerRef.current = setTimeout(() => {
      securityConfirmationRef.current = null;
      confirmationExpiryTimerRef.current = null;
    }, lifetimeMs);
  };

  const getCachedSecurityConfirmation = (): string | null => {
    const cached = securityConfirmationRef.current;
    if (!cached || cached.expiresAt <= Date.now() + 5_000) {
      clearSecurityConfirmation();
      return null;
    }
    return cached.token;
  };

  const openSecurityConfirmation = (action: PendingSecurityAction, error?: string) => {
    setPendingSecurityAction(action);
    setConfirmationValue('');
    setConfirmationError(error ?? null);
    setConfirmationMethod(confirmationMethods.password ? 'password' : confirmationMethods.totp ? 'totp' : 'backup');
    securityConfirm.onOpen();
  };

  const confirmationWasRejected = (errorCode?: string) =>
    errorCode === 'SECURITY_CONFIRMATION_REQUIRED';

  const finishRevokedSession = async () => {
    clearSecurityConfirmation();
    toast.success(t('passkey_sessions_revoked'));
    await logout();
  };

  const performRegister = async (
    action: Extract<PendingSecurityAction, { kind: 'register' }>,
    securityToken: string,
  ) => {
    if (!passkeyEnrollmentAllowed || !supported) return;
    setRegistering(true);
    try {
      const result = await registerBiometric(
        t('passkey_default_device_name'),
        action.attachment,
        securityToken,
      );

      if (result.success) {
        toast.success(t('biometric_registered'));
        void loadCredentials();
      } else if (confirmationWasRejected(result.errorCode)) {
        clearSecurityConfirmation();
        openSecurityConfirmation(action, t('passkey_security_confirm_failed'));
      } else if (
        result.errorCode === 'domain_not_allowed'
        || result.errorCode === 'AUTH_WEBAUTHN_ORIGIN_NOT_ALLOWED'
      ) {
        logError('[webauthn] RP ID rejected for this origin', result.error);
        toast.error(t('passkey_error_domain'));
      } else if (result.errorCode === 'cancelled') {
        toast.error(t('passkey_cancelled'));
      } else if (result.errorCode === 'FEATURE_DISABLED') {
        toast.error(t('passkey_enrollment_disabled'));
      } else if (result.errorCode === 'WEBAUTHN_CREDENTIAL_LIMIT') {
        toast.error(t('passkey_limit_reached', { count: maxCredentials ?? credentials.length }));
      } else {
        if (result.errorCode === 'unknown') {
          logError('[webauthn] registration failed', result.error);
        }
        toast.error(t('passkey_registration_failed'));
      }
    } catch (err) {
      logError('[webauthn] registration failed', err);
      toast.error(t('passkey_registration_failed'));
    } finally {
      setRegistering(false);
    }
  };

  const performRemove = async (
    action: Extract<PendingSecurityAction, { kind: 'remove' }>,
    securityToken: string,
  ) => {
    setRemovingId(action.credentialId);
    try {
      const result = await removeWebAuthnCredential(action.credentialId, securityToken);
      if (result.success) {
        setCredentials(prev => prev.filter(c => c.credential_id !== action.credentialId));
        if (result.sessionsRevoked) {
          await finishRevokedSession();
        } else {
          toast.success(t('biometric_removed'));
        }
      } else if (confirmationWasRejected(result.errorCode)) {
        clearSecurityConfirmation();
        openSecurityConfirmation(action, t('passkey_security_confirm_failed'));
      } else if (result.errorCode === 'LAST_SIGN_IN_METHOD') {
        toast.error(t('common:oauth.cannot_disconnect_last'));
      } else {
        toast.error(t('passkey_remove_failed'));
      }
    } catch {
      toast.error(t('passkey_remove_failed'));
    } finally {
      setRemovingId(null);
    }
  };

  const performRemoveAll = async (
    action: Extract<PendingSecurityAction, { kind: 'removeAll' }>,
    securityToken: string,
  ) => {
    setRemovingAll(true);
    try {
      const result = await removeAllWebAuthnCredentials(securityToken);
      if (result.success) {
        setCredentials([]);
        if (result.sessionsRevoked) {
          await finishRevokedSession();
        } else {
          toast.success(t('biometric_all_removed', { count: result.removedCount }));
        }
      } else if (confirmationWasRejected(result.errorCode)) {
        clearSecurityConfirmation();
        openSecurityConfirmation(action, t('passkey_security_confirm_failed'));
      } else if (result.errorCode === 'LAST_SIGN_IN_METHOD') {
        toast.error(t('common:oauth.cannot_disconnect_last'));
      } else {
        toast.error(t('passkey_remove_all_failed'));
      }
    } catch {
      toast.error(t('passkey_remove_all_failed'));
    } finally {
      setRemovingAll(false);
    }
  };

  const performRename = async (
    action: Extract<PendingSecurityAction, { kind: 'rename' }>,
    securityToken: string,
  ) => {
    try {
      const result = await renameWebAuthnCredential(
        action.credentialId,
        action.deviceName,
        securityToken,
      );
      if (result.success) {
        setCredentials(prev => prev.map(c => c.credential_id === action.credentialId
          ? { ...c, device_name: action.deviceName }
          : c));
        toast.success(t('passkey_renamed'));
      } else if (confirmationWasRejected(result.errorCode)) {
        clearSecurityConfirmation();
        openSecurityConfirmation(action, t('passkey_security_confirm_failed'));
      } else {
        toast.error(t('passkey_rename_failed'));
      }
    } catch {
      toast.error(t('passkey_rename_failed'));
    }
  };

  const executeSecurityAction = async (action: PendingSecurityAction, securityToken: string) => {
    if (action.kind === 'register') await performRegister(action, securityToken);
    if (action.kind === 'remove') await performRemove(action, securityToken);
    if (action.kind === 'removeAll') await performRemoveAll(action, securityToken);
    if (action.kind === 'rename') await performRename(action, securityToken);
  };

  const requestSecurityAction = async (action: PendingSecurityAction) => {
    if (securityActionInFlightRef.current) return;
    securityActionInFlightRef.current = true;
    setSecurityActionBusy(true);
    try {
      const cachedToken = getCachedSecurityConfirmation();
      if (cachedToken) {
        await executeSecurityAction(action, cachedToken);
        return;
      }

      // Passkey and federated logins carry a five-minute, UV-backed proof. Ask
      // the server once whether this session is still inside that window before
      // showing another prompt.
      if (!recentSessionCheckedRef.current) {
        recentSessionCheckedRef.current = true;
        const recentSession = await confirmWebAuthnSecurity();
        if (
          recentSession.success
          && recentSession.securityConfirmationToken
          && recentSession.expiresIn
        ) {
          cacheSecurityConfirmation(recentSession.securityConfirmationToken, recentSession.expiresIn);
          await executeSecurityAction(action, recentSession.securityConfirmationToken);
          return;
        }
      }

      openSecurityConfirmation(action);
    } finally {
      securityActionInFlightRef.current = false;
      setSecurityActionBusy(false);
    }
  };

  const handleRename = async (credentialId: string) => {
    const trimmed = editName.trim();
    setEditingId(null);
    if (!trimmed) return;
    const credential = credentials.find((candidate) => candidate.credential_id === credentialId);
    if (credential && trimmed === getDeviceLabel(credential, (key, options) => t(key, options)).trim()) {
      return;
    }
    await requestSecurityAction({ kind: 'rename', credentialId, deviceName: trimmed });
  };

  const submitSecurityConfirmation = async () => {
    if (!pendingSecurityAction || !confirmationValue.trim() || securityActionInFlightRef.current) return;
    securityActionInFlightRef.current = true;
    setSecurityActionBusy(true);
    setConfirmingSecurity(true);
    setConfirmationError(null);
    try {
      const value = confirmationValue.trim();
      const input: WebAuthnSecurityConfirmationInput = confirmationMethod === 'password'
        ? { current_password: confirmationValue }
        : confirmationMethod === 'totp'
          ? { totp_code: value.replace(/\s+/g, '') }
          : { backup_code: value };
      const result = await confirmWebAuthnSecurity(input);
      if (!result.success || !result.securityConfirmationToken || !result.expiresIn) {
        setConfirmationError(t('passkey_security_confirm_failed'));
        return;
      }

      const action = pendingSecurityAction;
      cacheSecurityConfirmation(result.securityConfirmationToken, result.expiresIn);
      setPendingSecurityAction(null);
      setConfirmationValue('');
      securityConfirm.onClose();
      await executeSecurityAction(action, result.securityConfirmationToken);
    } catch {
      setConfirmationError(t('passkey_security_confirm_failed'));
    } finally {
      setConfirmingSecurity(false);
      securityActionInFlightRef.current = false;
      setSecurityActionBusy(false);
    }
  };

  if (!passkeyAuthenticationEnabled) return null;

  // Still checking
  if (supported === null || loading) {
    return (
      <div className="w-full p-4 rounded-lg bg-theme-elevated text-left" role="status" aria-busy="true" aria-label={t('common:loading')}>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-accent/20">
            <Fingerprint className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
          </div>
          <div className="flex items-center gap-2">
            <Spinner size="sm" />
            <span className="text-sm text-theme-muted">
              {t('biometric_checking')}
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="w-full p-4 rounded-lg bg-theme-elevated text-left" role="alert">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/20">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <p className="font-medium text-theme-primary">{t('biometric_title')}</p>
            <p className="text-sm text-theme-subtle">{t('passkey_load_failed')}</p>
          </div>
          <Button size="sm" variant="secondary" onPress={() => { void loadCredentials(); }}>
            {t('try_again')}
          </Button>
        </div>
      </div>
    );
  }

  const hasCredentials = credentials.length > 0;
  const credentialLimitReached = maxCredentials !== null && credentials.length >= maxCredentials;
  const canEnroll = passkeyEnrollmentAllowed && supported && !credentialLimitReached;
  const pendingRemovalLabel = pendingRemoval
    ? getDeviceLabel(pendingRemoval, (key, options) => t(key, options))
    : '';

  return (
    <div className="w-full p-4 rounded-lg bg-theme-elevated text-left space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-accent/20">
            <Fingerprint className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
          </div>
          <div>
            <p className="font-medium text-theme-primary">
              {t('biometric_title')}
            </p>
            <p className="text-sm text-theme-subtle">
              {hasCredentials ? (
                <span className="flex items-center gap-1">
                  <CheckCircle className="w-3 h-3 text-emerald-500" aria-hidden="true" />
                  {t('biometric_enabled', {
                    count: credentials.length,
                  })}
                </span>
              ) : (
                t('biometric_not_enabled')
              )}
            </p>
          </div>
        </div>

        {canEnroll && <Tooltip content={t('passkey_setup_tooltip')}>
          <Button
            isIconOnly
            size="sm"
            variant="light"
            className="text-theme-subtle"
            onPress={() => setShowInstructions(!showInstructions)}
            aria-label={t('passkey_show_instructions')}
          >
            <Info className="w-4 h-4" />
          </Button>
        </Tooltip>}
      </div>

      {supported === false && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <p className="text-sm text-theme-subtle">{t('biometric_not_supported')}</p>
        </div>
      )}

      {!passkeyEnrollmentAllowed && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <p className="text-sm text-theme-subtle">{t('passkey_enrollment_disabled')}</p>
        </div>
      )}

      {passkeyEnrollmentAllowed && credentialLimitReached && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
          <p className="text-sm text-theme-subtle">
            {t('passkey_limit_reached', { count: maxCredentials })}
          </p>
        </div>
      )}

      {/* Platform-specific instructions */}
      {canEnroll && showInstructions && (
        <div className="p-3 rounded-lg bg-accent/5 border border-accent/20 space-y-2">
          <p className="text-sm font-medium text-accent dark:text-accent">
            {instructions.title} - {t('passkey_setup_subtitle')}
          </p>
          <ol className="text-sm text-theme-subtle space-y-1 list-decimal list-inside">
            {instructions.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <div className="pt-2 border-t border-accent/10">
            <p className="text-xs text-theme-muted">
              {t('passkey_multi_device_note')}
            </p>
          </div>
        </div>
      )}

      {/* Registration button — no attachment restriction, let browser show all options */}
      {canEnroll && <Button
        size="md"
        className="w-full bg-gradient-to-r from-accent to-accent-gradient-end text-white"
        onPress={() => { void requestSecurityAction({ kind: 'register' }); }}
        isLoading={registering}
        isDisabled={securityActionBusy}
        startContent={!registering ? <Fingerprint className="w-4 h-4" /> : undefined}
      >
        {hasCredentials ? t('passkey_add_another') : t('passkey_create')}
      </Button>}

      {/* Registered credentials list */}
      {hasCredentials && (
        <div className="pt-2 border-t border-theme-default">
          <ul className="space-y-2" aria-label={t('biometric_title')}>
            {credentials.map((cred) => {
              const DeviceIcon = getDeviceIcon(cred);
              const credentialLabel = getDeviceLabel(cred, (key, options) => t(key, options));
              const needsLegacyUpgrade = cred.credential_discoverable === null
                || cred.credential_discoverable === false;
              return (
                <li
                  key={cred.credential_id}
                  className="flex items-center justify-between p-2.5 rounded-lg bg-theme-hover/50"
                >
                <div className="flex items-center gap-3 min-w-0">
                  <DeviceIcon className="w-4 h-4 text-theme-muted flex-shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    {editingId === cred.credential_id ? (
                      <Input
                        size="sm"
                        variant="underlined"
                        value={editName}
                        onValueChange={setEditName}
                        autoFocus
                        className="max-w-[200px]"
                        aria-label={t('passkey_rename_input')}
                        onBlur={() => handleRename(cred.credential_id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRename(cred.credential_id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                      />
                    ) : (
                      <p className="text-sm font-medium text-theme-primary truncate">
                        {credentialLabel}{' '}
                        <span className="text-theme-subtle font-mono text-xs">
                          ...{cred.credential_id.slice(-8)}
                        </span>
                      </p>
                    )}
                    <div className="flex items-center gap-2 text-xs text-theme-subtle">
                      <span>
                        {t('biometric_registered_on')}{' '}
                        {new Date(cred.created_at).toLocaleDateString(getFormattingLocale())}
                      </span>
                      {cred.last_used_at && (
                        <>
                          <span>&middot;</span>
                          <span>
                            {t('biometric_last_used')}{' '}
                            {new Date(cred.last_used_at).toLocaleDateString(getFormattingLocale())}
                          </span>
                        </>
                      )}
                    </div>
                    {cred.rp_id ? (
                      <p className={`mt-0.5 text-xs ${currentRpId && cred.rp_id !== currentRpId ? 'text-warning' : 'text-theme-muted'}`}>
                        {currentRpId && cred.rp_id !== currentRpId
                          ? t('passkey_rp_mismatch', { rpId: cred.rp_id, currentRpId })
                          : t('passkey_rp_label', { rpId: cred.rp_id })}
                      </p>
                    ) : null}
                    {(!cred.rp_id || needsLegacyUpgrade) && (
                      <p className="mt-0.5 text-xs text-warning">
                        {t('passkey_rp_unknown')}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    isIconOnly
                    size="sm"
                    variant="light"
                    className="text-theme-subtle hover:bg-theme-hover"
                    onPress={() => {
                      setEditingId(cred.credential_id);
                      setEditName(credentialLabel);
                    }}
                    isDisabled={securityActionBusy}
                    aria-label={t('passkey_rename_named', { name: credentialLabel })}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="light"
                    className="text-[var(--color-error)] hover:bg-red-500/10"
                    onPress={() => setPendingRemoval(cred)}
                    isLoading={removingId === cred.credential_id}
                    isDisabled={securityActionBusy}
                    aria-label={t('passkey_remove_named', { name: credentialLabel })}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                </li>
              );
            })}
          </ul>

          {/* Remove all button */}
          {credentials.length > 1 && (
            <div className="pt-1">
              <Button
                size="sm"
                variant="flat"
                className="bg-red-500/10 text-[var(--color-error)]"
                onPress={removeAllConfirm.onOpen}
                isLoading={removingAll}
                isDisabled={securityActionBusy}
                startContent={!removingAll ? <Trash2 className="w-3 h-3" /> : undefined}
              >
                {t('biometric_remove_all')}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Multi-device tip */}
      {canEnroll && !showInstructions && (
        <p className="text-xs text-theme-muted">
          {t('passkey_device_tip')}{' '}
          <Button
            variant="tertiary"
            size="sm"
            className="min-h-7 min-w-0 px-1 text-accent hover:underline"
            onPress={() => setShowInstructions(true)}
          >
            {t('passkey_setup_guide')}
          </Button>
        </p>
      )}

      {/* Individual passkey confirmation modal */}
      <Modal
        isOpen={pendingRemoval !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen && !removingId) setPendingRemoval(null);
        }}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                {t('biometric_remove')}
              </ModalHeader>
              <ModalBody>
                <p className="text-theme-subtle">
                  {t('passkey_remove_warning', { name: pendingRemovalLabel })}
                </p>
              </ModalBody>
              <ModalFooter>
                <Button
                  variant="light"
                  onPress={() => {
                    setPendingRemoval(null);
                    onClose();
                  }}
                  isDisabled={removingId !== null}
                >
                  {t('cancel')}
                </Button>
                <Button
                  color="danger"
                  isLoading={removingId !== null}
                  isDisabled={securityActionBusy}
                  onPress={async () => {
                    if (!pendingRemoval) return;
                    await requestSecurityAction({
                      kind: 'remove',
                      credentialId: pendingRemoval.credential_id,
                    });
                    setPendingRemoval(null);
                    onClose();
                  }}
                >
                  {t('biometric_remove')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Remove All confirmation modal */}
      <Modal isOpen={removeAllConfirm.isOpen} onOpenChange={removeAllConfirm.onOpenChange}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                {t('passkey_remove_all_title')}
              </ModalHeader>
              <ModalBody>
                <p className="text-theme-subtle">
                  {t('passkey_remove_all_warning')}
                </p>
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>
                  {t('cancel')}
                </Button>
                <Button
                  color="danger"
                  isDisabled={securityActionBusy}
                  onPress={() => {
                    void requestSecurityAction({ kind: 'removeAll' });
                    onClose();
                  }}
                >
                  {t('passkey_remove_all_confirm')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Re-authentication for sensitive authenticator changes */}
      <Modal
        isOpen={securityConfirm.isOpen}
        onOpenChange={(isOpen) => {
          securityConfirm.onOpenChange(isOpen);
          if (!isOpen && !confirmingSecurity) {
            setPendingSecurityAction(null);
            setConfirmationValue('');
            setConfirmationError(null);
          }
        }}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                {t('passkey_security_confirm_title')}
              </ModalHeader>
              <ModalBody className="space-y-4">
                <p className="text-sm text-theme-subtle">
                  {t('passkey_security_confirm_description')}
                </p>

                {!confirmationMethods.password && !confirmationMethods.totp ? (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-theme-subtle" role="alert">
                    {t('passkey_security_confirm_no_method')}
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2" role="group" aria-label={t('passkey_security_confirm_method_label')}>
                      {confirmationMethods.password && (
                        <Button
                          size="sm"
                          variant={confirmationMethod === 'password' ? 'primary' : 'secondary'}
                          aria-pressed={confirmationMethod === 'password'}
                          onPress={() => {
                            setConfirmationMethod('password');
                            setConfirmationValue('');
                            setConfirmationError(null);
                          }}
                        >
                          {t('passkey_security_confirm_password')}
                        </Button>
                      )}
                      {confirmationMethods.totp && (
                        <>
                          <Button
                            size="sm"
                            variant={confirmationMethod === 'totp' ? 'primary' : 'secondary'}
                            aria-pressed={confirmationMethod === 'totp'}
                            onPress={() => {
                              setConfirmationMethod('totp');
                              setConfirmationValue('');
                              setConfirmationError(null);
                            }}
                          >
                            {t('passkey_security_confirm_totp')}
                          </Button>
                          <Button
                            size="sm"
                            variant={confirmationMethod === 'backup' ? 'primary' : 'secondary'}
                            aria-pressed={confirmationMethod === 'backup'}
                            onPress={() => {
                              setConfirmationMethod('backup');
                              setConfirmationValue('');
                              setConfirmationError(null);
                            }}
                          >
                            {t('passkey_security_confirm_backup')}
                          </Button>
                        </>
                      )}
                    </div>

                    <Input
                      autoFocus
                      type={confirmationMethod === 'password' ? 'password' : 'text'}
                      inputMode={confirmationMethod === 'totp' ? 'numeric' : 'text'}
                      autoComplete={confirmationMethod === 'password' ? 'current-password' : 'one-time-code'}
                      label={confirmationMethod === 'password'
                        ? t('passkey_security_confirm_password')
                        : confirmationMethod === 'totp'
                          ? t('passkey_security_confirm_totp')
                          : t('passkey_security_confirm_backup')}
                      value={confirmationValue}
                      onValueChange={setConfirmationValue}
                      isInvalid={confirmationError !== null}
                      errorMessage={confirmationError ?? undefined}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void submitSecurityConfirmation();
                        }
                      }}
                    />
                  </>
                )}
              </ModalBody>
              <ModalFooter>
                <Button
                  variant="light"
                  onPress={() => {
                    setPendingSecurityAction(null);
                    onClose();
                  }}
                  isDisabled={confirmingSecurity}
                >
                  {t('cancel')}
                </Button>
                {(confirmationMethods.password || confirmationMethods.totp) && (
                  <Button
                    color="primary"
                    onPress={() => { void submitSecurityConfirmation(); }}
                    isLoading={confirmingSecurity}
                    isDisabled={!confirmationValue.trim() || securityActionBusy}
                  >
                    {t('passkey_security_confirm_action')}
                  </Button>
                )}
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
