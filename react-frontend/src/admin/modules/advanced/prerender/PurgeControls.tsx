// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button, Card, CardBody, CardHeader, Code, Input, Switch } from '@/components/ui';
import Trash from 'lucide-react/icons/trash-2';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { adminPrerender } from '../../../api/adminApi';
import type { ToastShape } from './prerenderAdminTypes';

export function PurgeControls({
  isSuperAdmin,
  toast,
  onActed,
}: {
  isSuperAdmin: boolean;
  toast: ToastShape;
  onActed: () => void;
}) {
  const { t } = useTranslation('admin_advanced', { keyPrefix: 'advanced.prerender.purge' });
  const [pattern, setPattern] = useState('');
  const [tenant, setTenant] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [recache, setRecache] = useState(true);
  const [confirmAllTenants, setConfirmAllTenants] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ deleted_count: number; deleted: string[]; dry_run: boolean; recache_job_id?: number | null; preview_token?: string | null } | null>(null);
  const [lastPreview, setLastPreview] = useState<{ pattern: string; tenant: string; count: number; token: string } | null>(null);
  const isAllTenantDelete = !dryRun && tenant.trim() === '';
  const liveTenant = tenant.trim();
  const confirmationPhrase = liveTenant || t('all_tenants_warning.title');
  const hasMatchingPreview = Boolean(
    lastPreview
    && lastPreview.pattern === pattern.trim()
    && lastPreview.tenant === liveTenant
  );
  const liveDeleteLocked = !dryRun && (!hasMatchingPreview || confirmText.trim() !== confirmationPhrase);

  useEffect(() => {
    if (!isAllTenantDelete) setConfirmAllTenants(false);
  }, [isAllTenantDelete]);

  useEffect(() => {
    setConfirmText('');
  }, [dryRun, tenant, pattern]);

  const submit = async () => {
    if (!pattern.trim()) {
      toast.error(t('errors.pattern_required'));
      return;
    }
    if (!dryRun && !hasMatchingPreview) {
      toast.error(t('errors.preview_required'));
      return;
    }
    if (!dryRun && confirmText.trim() !== confirmationPhrase) {
      toast.error(t('errors.confirm_text', { phrase: confirmationPhrase }));
      return;
    }
    if (isAllTenantDelete && !confirmAllTenants) {
      toast.error(t('errors.confirm_all_tenants'));
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const res = await adminPrerender.purge({
        pattern: pattern.trim(),
        tenant_slug: tenant.trim() || undefined,
        dry_run: dryRun,
        recache,
        confirm_all_tenants: isAllTenantDelete && confirmAllTenants,
        preview_token: !dryRun ? lastPreview?.token : undefined,
      });
      if (res.data) {
        setResult(res.data);
        if (res.data.dry_run && res.data.preview_token) {
          setLastPreview({
            pattern: pattern.trim(),
            tenant: tenant.trim(),
            count: res.data.deleted_count,
            token: res.data.preview_token,
          });
        }
        toast.success(dryRun
          ? t('messages.dry_run', { count: res.data.deleted_count })
          : t('messages.purged', { count: res.data.deleted_count, job: res.data.recache_job_id ? ` #${res.data.recache_job_id}` : '' }));
        if (!dryRun) {
          setLastPreview(null);
          setConfirmText('');
          onActed();
        }
      }
    } catch {
      if (!dryRun) setLastPreview(null);
      toast.error(t('errors.purge_failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Trash size={18} />{t('title')}
        </h3>
      </CardHeader>
      <CardBody className="gap-3">
        <p className="text-sm text-muted">
          {t('description_prefix')} <code>*</code> {t('description_middle')}
          <code className="ml-1">**</code> {t('description_suffix')}{' '}
          {/* eslint-disable-next-line i18next/no-literal-string -- Route glob example must remain verbatim. */}
          <code>/blog/*</code>,
          {/* eslint-disable-next-line i18next/no-literal-string -- Route glob example must remain verbatim. */}
          <code className="ml-1">/listings/**</code>, <code className="ml-1">/</code>.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            label={t('fields.pattern')}
            placeholder={t('placeholders.pattern')}
            variant="secondary"
            value={pattern}
            onValueChange={setPattern}
            isDisabled={!isSuperAdmin}
          />
          <Input
            label={t('fields.tenant_slug')}
            placeholder={t('placeholders.tenant_slug')}
            variant="secondary"
            value={tenant}
            onValueChange={setTenant}
            isDisabled={!isSuperAdmin}
          />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6">
          <Switch isSelected={dryRun} onValueChange={setDryRun} isDisabled={!isSuperAdmin}>
            <span className="text-sm">{t('actions.dry_run')}</span>
          </Switch>
          <Switch isSelected={recache} onValueChange={setRecache} isDisabled={!isSuperAdmin}>
            <span className="text-sm">{t('actions.auto_recache')}</span>
          </Switch>
        </div>
        {!dryRun && (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-soft-foreground">
            <p className="font-medium">{t('preview_gate.title')}</p>
            <p className="mt-1">
              {hasMatchingPreview
                ? t('preview_gate.ready', { count: lastPreview?.count ?? 0 })
                : t('preview_gate.required')}
            </p>
            <Input
              className="mt-3"
              label={t('fields.confirm_text', { phrase: confirmationPhrase })}
              placeholder={confirmationPhrase}
              variant="secondary"
              value={confirmText}
              onValueChange={setConfirmText}
              isDisabled={!isSuperAdmin}
            />
          </div>
        )}
        {isAllTenantDelete && (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger-soft-foreground">
            <p className="font-medium">{t('all_tenants_warning.title')}</p>
            <p className="mt-1">{t('all_tenants_warning.body')}</p>
            <Switch
              className="mt-3"
              isSelected={confirmAllTenants}
              onValueChange={setConfirmAllTenants}
              isDisabled={!isSuperAdmin}
            >
              <span className="text-sm">{t('all_tenants_warning.confirm')}</span>
            </Switch>
          </div>
        )}
        <div className="flex justify-end">
          <Button
            color={dryRun ? 'primary' : 'danger'}
            startContent={<Trash size={16} />}
            onPress={submit}
            isLoading={loading}
            isDisabled={!isSuperAdmin || liveDeleteLocked || (isAllTenantDelete && !confirmAllTenants)}
          >
            {dryRun ? t('actions.preview_purge') : t('actions.purge_now')}
          </Button>
        </div>
        {result && (
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {result.dry_run ? t('result.would_delete', { count: result.deleted_count }) : t('result.deleted', { count: result.deleted_count })}
            </p>
            {result.deleted.length > 0 && (
              <Code className="text-xs whitespace-pre-wrap block max-h-48 overflow-auto">
                {result.deleted.join('\n')}
              </Code>
            )}
            {result.dry_run && result.deleted_count > 0 && (
              <Button
                size="sm"
                color="danger"
                variant="secondary"
                startContent={<Trash size={14} />}
                onPress={() => setDryRun(false)}
                isDisabled={!isSuperAdmin}
              >
                {t('actions.continue_to_delete')}
              </Button>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
