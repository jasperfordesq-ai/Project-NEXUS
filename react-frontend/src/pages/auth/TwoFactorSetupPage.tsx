// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from '@heroui/react/button';
import { Input } from '@heroui/react/input';
import { Label } from '@heroui/react/label';
import { TextField } from '@heroui/react/textfield';
import ShieldCheck from 'lucide-react/icons/shield-check';
import { useTranslation } from 'react-i18next';
// Auth startup surface: direct context modules, never the @/contexts barrel (bundle budget).
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { api, tokenManager } from '@/lib/api';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageMeta } from '@/components/seo/PageMeta';
import { getFormattingLocale } from '@/lib/helpers';
import { downloadRecoveryCodes, recoveryCodesFilename } from '@/lib/recoveryCodes';
import { consumeAuthReturn } from '@/lib/auth-return';

interface Setup { qr_code_url: string; secret: string; provisioning_uri?: string }

/** The key in groups of four, the way authenticator apps show a typed key. */
function formatSetupKey(secret: string): string {
  return secret.replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();
}

/** The server's otpauth:// link (what the QR code encodes), or null for anything else. */
function openInAppHref(setup: Setup): string | null {
  const uri = setup.provisioning_uri ?? '';
  return uri.startsWith('otpauth://totp/') ? uri : null;
}

interface Completion {
  backup_codes: string[]; access_token: string; refresh_token?: string;
  session_binding?: string;
  login_complete: boolean; expires_in: number;
}

export default function TwoFactorSetupPage() {
  const { t } = useTranslation('auth');
  const { twoFactorToken, status, cancel2FA, refreshUser, scheduleSessionWarning } = useAuth();
  const { tenantPath } = useTenant();
  const navigate = useNavigate();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  // A refused code is reported under the box, not at the top of the page (7 Nov 2026).
  const [codeError, setCodeError] = useState('');
  const [keyCopied, setKeyCopied] = useState(false);
  const completionGenerationRef = useRef<string | null>(null);
  usePageTitle(t('mandatory_setup.title'));

  useEffect(() => {
    if (!twoFactorToken || status !== 'requires_2fa_setup') return;
    let active = true;
    setBusy(true);
    setError('');
    void api.post<Setup>('/v2/auth/2fa/setup', { two_factor_token: twoFactorToken }, { skipAuth: true })
      .then(result => {
        if (!active) return;
        if (result.success && result.data) setSetup(result.data);
        else setError(result.error || t('mandatory_setup.failed'));
      }).catch(() => { if (active) setError(t('mandatory_setup.failed')); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [twoFactorToken, status, attempt, t]);

  if ((!twoFactorToken || status !== 'requires_2fa_setup') && !completion) {
    return <Navigate to={tenantPath('/login')} replace />;
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setCodeError('');
    const sessionGenerationAtStart = tokenManager.getSessionGeneration();
    try {
      const result = await api.post<Completion>('/v2/auth/2fa/verify', {
        two_factor_token: twoFactorToken, code,
      }, { skipAuth: true });
      if (tokenManager.getSessionGeneration() !== sessionGenerationAtStart) {
        setError(t('mandatory_setup.failed'));
        return;
      }
      if (result.success && result.data?.login_complete && result.data.access_token && result.data.session_binding) {
        completionGenerationRef.current = sessionGenerationAtStart;
        setCompletion(result.data);
        setSetup(null);
        setCode('');
      } else {
        // Beside the box, and empty it for the next try.
        setCodeError(result.error || t('mandatory_setup.failed'));
        setCode('');
      }
    } catch {
      setCodeError(t('mandatory_setup.failed'));
    }
    finally { setBusy(false); }
  }

  async function copyKey() {
    if (!setup) return;
    try {
      await navigator.clipboard.writeText(setup.secret.replace(/\s+/g, ''));
      setKeyCopied(true);
    } catch {
      setError(t('mandatory_setup.key_copy_failed'));
    }
  }

  /**
   * 🔴 Both of these read the codes straight out of component state and go no further.
   * Nothing is sent, nothing is logged, and the failure paths say so on screen rather
   * than to the console — a recovery code in a log is a password in a log.
   */
  async function copyCodes() {
    if (!completion) return;
    try {
      await navigator.clipboard.writeText(completion.backup_codes.join('\n'));
      setCopied(true);
      setError('');
    } catch {
      setError(t('mandatory_setup.recovery_copy_failed'));
    }
  }

  function saveCodes() {
    if (!completion) return;
    try {
      downloadRecoveryCodes({
        title: t('mandatory_setup.recovery_file_title'),
        generated: t('mandatory_setup.recovery_file_generated', {
          // getFormattingLocale(), never i18n.language: the helper adds the community's
          // region, so a date reads the way the member expects. A contract check enforces it.
          date: new Date().toLocaleDateString(getFormattingLocale()),
        }),
        guidance: t('mandatory_setup.recovery_file_guidance'),
        codes: completion.backup_codes,
      }, recoveryCodesFilename());
      setError('');
    } catch {
      setError(t('mandatory_setup.recovery_download_failed'));
    }
  }

  async function finish() {
    if (!completion) return;
    setBusy(true);
    if (tokenManager.getSessionGeneration() !== completionGenerationRef.current) {
      setError(t('mandatory_setup.failed'));
      setBusy(false);
      return;
    }
    const generation = await tokenManager.adoptSessionIfCurrent(
      completionGenerationRef.current,
      completion.access_token,
      completion.refresh_token,
      undefined,
      completion.session_binding,
    );
    if (!generation || tokenManager.getSessionGeneration() !== generation) {
      setError(t('mandatory_setup.failed'));
      setBusy(false);
      return;
    }
    scheduleSessionWarning(completion.expires_in);
    await refreshUser();
    // Back to the page the member was signing in to reach (an email link,
    // say), not always the dashboard.
    navigate(consumeAuthReturn(tenantPath('/dashboard')), { replace: true });
  }

  return (
    <section className="mx-auto max-w-lg space-y-5 px-6 py-20">
      <PageMeta title={t('mandatory_setup.title')} noIndex />
      {/* A picture on a tile in the community colour, as on the sign-in page. */}
      <div className="inline-flex rounded-2xl bg-gradient-to-br from-accent/20 to-companion/20 p-3">
        <ShieldCheck className="h-8 w-8 text-accent" aria-hidden="true" />
      </div>
      <h1 className="text-2xl font-semibold">{t('mandatory_setup.title')}</h1>
      <p>{t('mandatory_setup.reason')}</p>
      {error && <p role="alert" className="text-danger">{error}</p>}
      {completion ? <>
        <h2 className="text-xl font-semibold">{t('mandatory_setup.recovery_title')}</h2>
        <p>{t('mandatory_setup.recovery_help')}</p>
        <p role="alert" className="rounded-md border border-warning bg-warning/10 px-3 py-2 text-sm">
          {t('mandatory_setup.recovery_once')}
        </p>
        <ul
          className="grid grid-cols-2 gap-2 rounded-md border border-theme-default bg-theme-elevated p-4 font-mono select-all"
          aria-label={t('mandatory_setup.recovery_title')}
        >
          {completion.backup_codes.map(value => <li key={value}>{value}</li>)}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onPress={() => void copyCodes()}>
            {t(copied ? 'mandatory_setup.recovery_copied' : 'mandatory_setup.recovery_copy')}
          </Button>
          <Button variant="secondary" onPress={saveCodes}>{t('mandatory_setup.recovery_download')}</Button>
        </div>
        <Button onPress={() => void finish()} isDisabled={busy}>{t('mandatory_setup.saved')}</Button>
      </> : setup ? <form onSubmit={verify} className="space-y-5">
        <p>{t('mandatory_setup.scan')}</p>
        <img src={setup.qr_code_url} alt={t('mandatory_setup.qr_alt')} className="h-52 w-52 bg-white p-2" />
        {openInAppHref(setup) && (
          // A phone cannot scan its own screen: on touch screens, open the
          // authenticator app with the key filled in. HeroUI's own button classes,
          // so this auth surface pulls in nothing new.
          <div className="hidden pointer-coarse:block">
            <a href={openInAppHref(setup) ?? undefined} className="button button--secondary button--md">
              {t('mandatory_setup.open_app')}
            </a>
          </div>
        )}
        <div className="space-y-2">
          <p>{t('mandatory_setup.manual')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-md bg-theme-elevated px-2 py-1 font-mono tracking-wide break-words">{formatSetupKey(setup.secret)}</code>
            <Button type="button" variant="secondary" size="sm" onPress={() => void copyKey()}>
              {t(keyCopied ? 'mandatory_setup.key_copied' : 'mandatory_setup.copy_key')}
            </Button>
          </div>
        </div>
        <TextField
          isRequired
          name="code"
          value={code}
          onChange={(value) => { setCode(value); setCodeError(''); }}
          isInvalid={codeError !== ''}
        >
          <Label>{t('mandatory_setup.code')}</Label>
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            aria-describedby={codeError ? 'mandatory-code-error' : undefined}
          />
        </TextField>
        {codeError && <p id="mandatory-code-error" role="alert" className="text-sm text-danger">{codeError}</p>}
        <Button type="submit" isDisabled={busy || !/^\d{6}$/.test(code)}>{t('mandatory_setup.verify')}</Button>
      </form> : <Button onPress={() => setAttempt(value => value + 1)} isDisabled={busy}>
        {t(busy ? 'mandatory_setup.loading' : 'mandatory_setup.retry')}
      </Button>}
      {!completion && <Button variant="secondary" onPress={() => { cancel2FA(); navigate(tenantPath('/login'), { replace: true }); }}>
        {t('mandatory_setup.cancel')}
      </Button>}
    </section>
  );
}
