// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Card, CardBody, CardHeader, Input, Button, Checkbox, Snippet } from '@/components/ui';
import { useState } from 'react';

import Key from 'lucide-react/icons/key';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Copy from 'lucide-react/icons/copy';
import Calendar from 'lucide-react/icons/calendar';
import { useNavigate } from 'react-router-dom';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { logError } from '@/lib/logger';
import { adminFederation } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { useTranslation } from 'react-i18next';
import { PartnerTimebankGuidance } from './PartnerTimebankGuidance';

/**
 * Create Federation API Key
 * Form for generating a new federation API key.
 */


/** Scopes must match the `fedAuth('...')` permission strings in FederationController.php */
const SCOPE_KEYS = [
  'timebanks:read',
  'members:read',
  'listings:read',
  'messages:read',
  'messages:write',
  'transactions:read',
  'transactions:write',
  'reviews:read',
  'reviews:write',
] as const;

interface CreateApiKeyProps {
  /**
   * Embedded mode (e.g. inside the Partner Timebanks panel's create
   * drawer): called instead of navigating back to the api-keys list,
   * and the standalone PageHeader/guidance chrome is suppressed.
   */
  onDone?: () => void;
}

export function CreateApiKey({ onDone }: CreateApiKeyProps = {}) {
  const { t } = useTranslation('admin_federation');
  usePageTitle(t('federation.page_title'));
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const toast = useToast();
  const embedded = Boolean(onDone);

  const finish = () => {
    if (onDone) {
      onDone();
    } else {
      navigate(tenantPath('/partner-timebanks/api-keys'));
    }
  };

  const AVAILABLE_SCOPES = SCOPE_KEYS.map((key) => ({
    key,
    description: t(`federation.scope_${key.replace(':', '_')}`),
  }));
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const toggleScope = (scope: string) => {
    setScopes(prev => prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]);
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await adminFederation.createApiKey({
        name,
        scopes,
        expires_at: expiresAt || undefined,
      });
      if (res.success && res.data) {
        const payload = res.data as unknown;
        let d: { api_key?: string };
        if (payload && typeof payload === 'object' && 'data' in payload) {
          d = (payload as { data: typeof d }).data;
        } else {
          d = payload as typeof d;
        }
        if (d.api_key) {
          setCreatedKey(d.api_key);
        } else {
          finish();
        }
      }
    } catch (err) {
      logError('CreateApiKey: failed to create API key', err);
      toast.error(t('federation.key_create_failed'));
    }
    setSaving(false);
  };

  const handleCopy = () => {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (createdKey) {
    return (
      <div>
        {!embedded && (
          <PageHeader title={t('federation.create_api_key_title')} description={t('federation.create_api_key_desc')} />
        )}
        <Card >
          <CardBody className="gap-4">
            <div className="rounded-lg bg-success/10 border border-success/30 p-4">
              <p className="text-sm font-medium text-success-soft-foreground mb-2">{t('federation.your_new_api_key')}</p>
              <Snippet symbol="" variant="soft" color="success" className="w-full">{createdKey}</Snippet>
            </div>
            <div className="flex gap-2">
              <Button variant="tertiary" startContent={<Copy size={16} />} onPress={handleCopy}>{copied ? t('federation.copied') : t('federation.copy_key')}</Button>
              <Button onPress={finish}>{t('federation.done')}</Button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div>
      {!embedded && (
        <>
          <PageHeader
            title={t('federation.create_api_key_title')}
            description={t('federation.create_api_key_desc')}
            actions={<Button variant="tertiary" startContent={<ArrowLeft size={16} />} onPress={finish}>{t('federation.back')}</Button>}
          />
          <div className="mb-6">
            <PartnerTimebankGuidance page="apiKeys" />
          </div>
        </>
      )}
      <Card >
        <CardHeader><h3 className="text-lg font-semibold flex items-center gap-2"><Key size={20} /> {t('federation.new_api_key')}</h3></CardHeader>
        <CardBody className="gap-4">
          <Input label={t('federation.key_name')} placeholder={t('federation.key_name_placeholder')} value={name} onValueChange={setName} isRequired variant="secondary" />
          <div>
            <p className="text-sm font-medium mb-2">{t('federation.scopes')}</p>
            <div className="space-y-2">
              {AVAILABLE_SCOPES.map(scope => (
                <Checkbox key={scope.key} isSelected={scopes.includes(scope.key)} onValueChange={() => toggleScope(scope.key)}>
                  <span className="flex items-center gap-2">
                    <code className="text-xs bg-surface-secondary px-1.5 py-0.5 rounded">{scope.key}</code>
                    <span className="text-xs text-muted">{scope.description}</span>
                  </span>
                </Checkbox>
              ))}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
              <Calendar size={14} />
              {t('federation.expiry_date')}
              <span className="text-muted font-normal">({t('federation.optional')})</span>
            </p>
            <Input
              type="date"
              variant="secondary"
              value={expiresAt}
              onValueChange={setExpiresAt}
              min={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
              description={t('federation.expiry_description')}
              aria-label={t('federation.expiry_date')}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="tertiary" onPress={finish}>{t('common.cancel')}</Button>
            <Button onPress={handleSubmit} isLoading={saving} isDisabled={!name.trim()}>{t('federation.create_key')}</Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

export default CreateApiKey;
