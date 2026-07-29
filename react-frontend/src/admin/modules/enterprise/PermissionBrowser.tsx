// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Permission Browser
 * Read-only list of all available permissions grouped by category.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Key from 'lucide-react/icons/key';
import Lock from 'lucide-react/icons/lock';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { usePageTitle } from '@/hooks';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody, Chip, Spinner } from '@/components/ui';
import { logError } from '@/lib/logger';
import { adminEnterprise } from '../../api/adminApi';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';

function isPermissionMap(value: unknown): value is Record<string, string[]> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (permissions) =>
        Array.isArray(permissions) && permissions.every((permission) => typeof permission === 'string'),
    )
  );
}

export function PermissionBrowser() {
  const { t } = useTranslation('admin_enterprise');
  usePageTitle(t('enterprise.page_title'));

  const [permissions, setPermissions] = useState<Record<string, string[]> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const requestIdRef = useRef(0);

  const loadData = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);

    try {
      const res = await adminEnterprise.getPermissions();
      if (requestId !== requestIdRef.current) return;

      if (res.success && isPermissionMap(res.data)) {
        setPermissions(res.data);
        setLoadFailed(false);
      } else {
        setLoadFailed(true);
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      logError('Failed to load permissions data', err);
      setLoadFailed(true);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadData();
    return () => {
      requestIdRef.current += 1;
    };
  }, [loadData]);

  const refreshAction = (
    <Button
      variant="secondary"
      onPress={loadData}
      isLoading={loading}
      startContent={<RefreshCw size={16} aria-hidden="true" />}
    >
      {t('common.refresh')}
    </Button>
  );

  const staleDataWarning = loadFailed && permissions !== null ? (
    <div
      className="mb-4 flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4 text-danger sm:flex-row sm:items-center sm:justify-between"
      role="alert"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />
        <p className="text-sm">{t('enterprise.failed_to_load_data')}</p>
      </div>
      <Button variant="outline" onPress={loadData} isLoading={loading}>
        {t('common.retry')}
      </Button>
    </div>
  ) : null;

  return (
    <div>
      <PageHeader
        title={t('enterprise.permission_browser_title')}
        description={t('enterprise.permission_browser_desc')}
        actions={refreshAction}
      />

      {loading && permissions === null ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : loadFailed && permissions === null ? (
        <div role="alert">
          <EmptyState
            icon={AlertTriangle}
            title={t('enterprise.failed_to_load_data')}
            actionLabel={t('common.retry')}
            onAction={loadData}
          />
        </div>
      ) : permissions !== null && Object.keys(permissions).length === 0 ? (
        <EmptyState
          icon={Key}
          title={t('shared.no_data_available')}
          actionLabel={t('common.refresh')}
          onAction={loadData}
        />
      ) : (
        <div className="space-y-4">
          {staleDataWarning}
          {Object.entries(permissions ?? {}).map(([category, perms]) => (
            <Card key={category} >
              <CardBody className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10">
                    <Key size={16} className="text-accent" aria-hidden="true" />
                  </div>
                  <h3
                    className="text-base font-semibold"
                    data-testid="permission-category-heading"
                    data-category={category}
                  >
                    {t(`enterprise.permission_categories.${category}`, {
                      defaultValue: t('enterprise.permission_categories.unknown'),
                    })}
                  </h3>
                  <Chip
                    size="sm"
                    variant="soft"
                    aria-label={t('enterprise.permissions_count', { count: perms.length })}
                  >
                    {perms.length}
                  </Chip>
                </div>
                <div className="flex flex-wrap gap-2">
                  {perms.map((perm) => (
                    <Chip
                      key={perm}
                      size="sm"
                      variant="soft"
                      startContent={<Lock size={12} aria-hidden="true" />}
                    >
                      {perm}
                    </Chip>
                  ))}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default PermissionBrowser;
