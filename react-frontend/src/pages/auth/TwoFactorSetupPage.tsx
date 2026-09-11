// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button, Label, TextField, Input } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { useAuth, useTenant } from '@/contexts';
import { api, tokenManager } from '@/lib/api';
import { usePageTitle } from '@/hooks/usePageTitle';

interface Setup { qr_code_url: string; secret: string }
interface Completion {
  backup_codes: string[]; access_token: string; refresh_token: string;
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
    try {
      const result = await api.post<Completion>('/v2/auth/2fa/verify', {
        two_factor_token: twoFactorToken, code,
      }, { skipAuth: true });
      if (result.success && result.data?.login_complete && result.data.access_token && result.data.refresh_token) {
        setCompletion(result.data);
        setSetup(null);
        setCode('');
      } else setError(result.error || t('mandatory_setup.failed'));
    } catch { setError(t('mandatory_setup.failed')); }
    finally { setBusy(false); }
  }

  async function finish() {
    if (!completion) return;
    setBusy(true);
    tokenManager.setRefreshToken(completion.refresh_token);
    tokenManager.setAccessToken(completion.access_token);
    scheduleSessionWarning(completion.expires_in);
    await refreshUser();
    navigate(tenantPath('/dashboard'), { replace: true });
  }

  return (
    <section className="mx-auto max-w-lg space-y-5 px-6 py-20">
      <h1 className="text-2xl font-semibold">{t('mandatory_setup.title')}</h1>
      <p>{t('mandatory_setup.reason')}</p>
      {error && <p role="alert" className="text-danger">{error}</p>}
      {completion ? <>
        <h2 className="text-xl font-semibold">{t('mandatory_setup.recovery_title')}</h2>
        <p>{t('mandatory_setup.recovery_help')}</p>
        <ul className="grid grid-cols-2 gap-2 font-mono" aria-label={t('mandatory_setup.recovery_title')}>
          {completion.backup_codes.map(value => <li key={value}>{value}</li>)}
        </ul>
        <Button onPress={() => void finish()} isDisabled={busy}>{t('mandatory_setup.saved')}</Button>
      </> : setup ? <form onSubmit={verify} className="space-y-5">
        <p>{t('mandatory_setup.scan')}</p>
        <img src={setup.qr_code_url} alt={t('mandatory_setup.qr_alt')} className="h-52 w-52 bg-white p-2" />
        <p>{t('mandatory_setup.manual')} <code className="break-all select-all">{setup.secret}</code></p>
        <TextField isRequired name="code" value={code} onChange={setCode}>
          <Label>{t('mandatory_setup.code')}</Label>
          <Input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} />
        </TextField>
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
