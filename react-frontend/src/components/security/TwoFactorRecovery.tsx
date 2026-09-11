// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState } from 'react';
import { Button, Input, Label, TextField } from '@heroui/react';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';

export function TwoFactorRecovery({ onCodesChanged }: { onCodesChanged?: (count: number) => void }) {
  const { t } = useTranslation('settings');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revoked, setRevoked] = useState(false);

  async function replaceCodes() {
    setBusy(true); setError('');
    try {
      const result = await api.post<{ backup_codes: string[] }>('/v2/auth/2fa/recovery-codes', { code });
      if (!result.success || !result.data?.backup_codes?.length) throw new Error();
      setCodes(result.data.backup_codes); setCode('');
      onCodesChanged?.(result.data.backup_codes.length);
    } catch { setError(t('mfa_recovery.failed')); }
    finally { setBusy(false); }
  }

  async function revokeDevices() {
    setBusy(true); setError('');
    try {
      const result = await api.post('/v2/auth/2fa/trusted-devices/revoke', {});
      if (!result.success) throw new Error();
      setRevoked(true);
    } catch { setError(t('mfa_recovery.failed')); }
    finally { setBusy(false); }
  }

  return <section className="mt-4 space-y-3" aria-label={t('mfa_recovery.title')}>
    <h3 className="font-semibold">{t('mfa_recovery.title')}</h3>
    {error && <p role="alert">{error}</p>}
    {codes.length ? <>
      <p role="status">{t('mfa_recovery.save')}</p>
      <ul className="grid grid-cols-2 gap-2 font-mono">{codes.map(value => <li key={value}>{value}</li>)}</ul>
      <Button onPress={() => setCodes([])}>{t('mfa_recovery.saved')}</Button>
    </> : <form className="space-y-3" onSubmit={event => { event.preventDefault(); void replaceCodes(); }}>
      <p className="text-sm">{t('mfa_recovery.warning')}</p>
      <TextField value={code} onChange={setCode} isRequired isDisabled={busy}>
        <Label>{t('mfa_recovery.code')}</Label>
        <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" />
      </TextField>
      <Button type="submit" isDisabled={busy || !/^[0-9]{6}$/.test(code)}>{t('mfa_recovery.replace')}</Button>
    </form>}
    <Button variant="secondary" isDisabled={busy} onPress={() => void revokeDevices()}>{t('mfa_recovery.revoke')}</Button>
    {revoked && <p role="status">{t('mfa_recovery.revoked')}</p>}
  </section>;
}
