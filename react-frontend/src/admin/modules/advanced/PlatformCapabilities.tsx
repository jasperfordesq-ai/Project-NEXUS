// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Rocket from 'lucide-react/icons/rocket';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import { PageHeader } from '../../components/PageHeader';
import { adminConfig, type PlatformCapabilityRow } from '../../api/adminApi';
import { useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Alert, Button, Card, Chip, Select, SelectItem, Spinner, Switch } from '@/components/ui';

/**
 * Platform rollout switches.
 *
 * These used to live only in server environment variables, so raising a gate
 * meant somebody with SSH access. Each community still controls its own event
 * settings; this page sets the ceiling they all sit under.
 */
export default function PlatformCapabilities() {
  const { t } = useTranslation('admin_platform_capabilities');
  usePageTitle(t('title'));
  const toast = useToast();
  const confirm = useConfirm();

  const [rows, setRows] = useState<PlatformCapabilityRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await adminConfig.getPlatformCapabilities();
      if (!response.success || !response.data) throw new Error(t('load_failed'));
      setRows(response.data.capabilities);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const apply = async (capability: string, value: string | boolean, enabling: boolean) => {
    // Turning a platform gate ON exposes a capability to every community that
    // has it switched on locally, so it is worth one deliberate pause.
    if (enabling) {
      const approved = await confirm({
        title: t('confirm_enable_title'),
        body: t('confirm_enable_body', { capability: t(`capability_${capability}`) }),
        confirmLabel: t('confirm_enable_action'),
        status: 'warning',
      });
      if (!approved) return;
    }

    setBusy(capability);
    try {
      const response = await adminConfig.setPlatformCapability(capability, value);
      if (!response.success || !response.data) throw new Error(t('save_failed'));
      setRows(response.data.capabilities);
      toast.success(t('saved'));
    } catch {
      toast.error(t('save_failed'));
    } finally {
      setBusy(null);
    }
  };

  const revert = async (capability: string) => {
    setBusy(capability);
    try {
      const response = await adminConfig.clearPlatformCapability(capability);
      if (!response.success || !response.data) throw new Error(t('save_failed'));
      setRows(response.data.capabilities);
      toast.success(t('reverted'));
    } catch {
      toast.error(t('save_failed'));
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center" role="status" aria-label={t('loading')}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (loadError || !rows) {
    return (
      <div className="mx-auto max-w-5xl px-4">
        <Alert color="danger" title={t('load_failed')}>
          <Button size="sm" variant="secondary" onPress={() => void load()}>{t('retry')}</Button>
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 pb-10">
      <PageHeader title={t('title')} description={t('description')} icon={<Rocket size={22} />} />

      <Alert color="primary" title={t('how_it_works_title')} className="mb-6">
        {t('how_it_works_body')}
      </Alert>

      <Card>
        <Card.Header>
          <div>
            <h2 className="text-base font-semibold">{t('switches_title')}</h2>
            <p className="text-sm text-muted">{t('switches_desc')}</p>
          </div>
        </Card.Header>
        <Card.Content className="divide-y divide-border">
          {rows.map(row => {
            const overridden = row.source === 'platform_override';
            const isOn = row.type === 'bool' ? row.value === '1' : row.value !== 'off';

            return (
              <div key={row.capability} className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
                <div className="min-w-[16rem] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{t(`capability_${row.capability}`)}</p>
                    <Chip size="sm" variant="soft" color={isOn ? 'success' : 'default'}>
                      {t(isOn ? 'state_on' : 'state_off')}
                    </Chip>
                    {overridden && (
                      <Chip size="sm" variant="soft" color="warning">{t('source_override')}</Chip>
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted">{t(`capability_${row.capability}_desc`)}</p>
                </div>

                <div className="flex items-center gap-3">
                  {overridden && (
                    <Button
                      size="sm"
                      variant="tertiary"
                      startContent={<RotateCcw size={14} />}
                      isDisabled={busy === row.capability}
                      onPress={() => void revert(row.capability)}
                    >
                      {t('use_environment')}
                    </Button>
                  )}

                  {row.type === 'bool' ? (
                    <Switch
                      isSelected={isOn}
                      isDisabled={busy === row.capability}
                      onValueChange={value => void apply(row.capability, value ? '1' : '0', value)}
                      aria-label={t(`capability_${row.capability}`)}
                    />
                  ) : (
                    <Select
                      aria-label={t(`capability_${row.capability}`)}
                      className="min-w-[10rem]"
                      isDisabled={busy === row.capability}
                      selectedKeys={[row.value]}
                      onSelectionChange={keys => {
                        const value = Array.from(keys)[0];
                        if (typeof value === 'string' && value !== row.value) {
                          void apply(row.capability, value, value !== 'off');
                        }
                      }}
                    >
                      {row.values.map(value => (
                        <SelectItem key={value} id={value}>{t(`mode_${value}`)}</SelectItem>
                      ))}
                    </Select>
                  )}
                </div>
              </div>
            );
          })}
        </Card.Content>
      </Card>

      <Card className="mt-6">
        <Card.Header>
          <div>
            <h2 className="text-base font-semibold">{t('installed_title')}</h2>
            <p className="text-sm text-muted">{t('installed_desc')}</p>
          </div>
        </Card.Header>
      </Card>
    </div>
  );
}
