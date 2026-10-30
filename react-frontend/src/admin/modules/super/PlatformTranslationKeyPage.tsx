// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Super admin → Platform → Translation key.
 *
 * The platform's fallback Google Cloud Translation key (owner, 30 Oct 2026).
 * Google Translate is every community's default translation engine; a community
 * that has saved its own key in Admin → Translation settings uses that, every
 * other community uses this one. The key is stored encrypted and never shown
 * again — the page only says whether one is saved.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import KeyRound from 'lucide-react/icons/key-round';
import { Alert, Button, Card, CardBody, CardHeader, Spinner } from '@/components/ui';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { SecretInput } from '@/admin/components/SecretInput';

interface PlatformKeyStatus {
  platform_key_set: boolean;
  environment_key_set: boolean;
  effective: boolean;
}

const ENDPOINT = '/v2/admin/super/translation/google-key';

export default function PlatformTranslationKeyPage() {
  const { t } = useTranslation('admin_super', { keyPrefix: 'platform_translation' });
  usePageTitle(t('title'));
  const toast = useToast();
  const [status, setStatus] = useState<PlatformKeyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<PlatformKeyStatus>(ENDPOINT);
      if (res.success && res.data) setStatus(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    const key = newKey.trim();
    if (!key) return;
    setSaving(true);
    try {
      const res = await api.put<PlatformKeyStatus>(ENDPOINT, { api_key: key });
      if (res.success && res.data) {
        setStatus(res.data);
        setNewKey('');
        toast.success(t('saved'));
      } else {
        toast.error(t('save_failed'));
      }
    } catch {
      toast.error(t('save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      const res = await api.delete<PlatformKeyStatus>(ENDPOINT);
      if (res.success && res.data) {
        setStatus(res.data);
        toast.success(t('removed'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('description')}</p>
      </div>

      {loading ? (
        <div role="status" aria-busy="true" className="flex justify-center py-12"><Spinner size="lg" /></div>
      ) : (
        <>
          {status && (
            <Alert
              color={status.effective ? 'success' : 'warning'}
              title={status.platform_key_set
                ? t('status_saved')
                : status.environment_key_set ? t('status_environment') : t('status_none')}
            />
          )}

          <Card>
            <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
              <KeyRound size={18} className="text-accent" aria-hidden="true" />
              <h2 className="font-semibold">{t('key_heading')}</h2>
            </CardHeader>
            <CardBody className="space-y-3 px-4 pb-4">
              <p className="text-sm text-muted">{t('key_help')}</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <SecretInput
                  label={t('key_label')}
                  value={newKey}
                  onValueChange={setNewKey}
                  placeholder={status?.platform_key_set ? t('replace_placeholder') : t('placeholder')}
                  className="max-w-md"
                  size="sm"
                />
                <Button variant="primary" size="sm" onPress={save} isDisabled={saving || newKey.trim() === ''}>
                  {t('save')}
                </Button>
                {status?.platform_key_set && (
                  <Button variant="tertiary" size="sm" onPress={remove} isDisabled={saving}>
                    {t('remove')}
                  </Button>
                )}
              </div>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
