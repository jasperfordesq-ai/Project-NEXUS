import { Card, CardBody, CardHeader, Button, Chip, Spinner } from '@/components/ui';
import { useState, useEffect, useCallback } from 'react';
import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import Play from 'lucide-react/icons/play';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/contexts';
import { getFormattingLocale } from '@/lib/helpers';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { PageHeader } from '../../components/PageHeader';
import { adminTools } from '../../api/adminApi';
import type { SeoAuditCheck } from '../../api/types';
import {
  getSeoAuditCheckDescriptionKey,
  getSeoAuditCheckNameKey,
  getSeoAuditIssueKey,
} from './seoAuditTranslations';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * SEO Audit
 * Run and display SEO audit results for the platform.
 * Fetches real audit data from the API and supports triggering new audits.
 */


const statusColorMap: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
  pass: 'success',
  warning: 'warning',
  fail: 'danger',
};

export function SeoAudit() {
  const { t } = useTranslation('admin_advanced', { keyPrefix: 'advanced' });
  const { t: tNav } = useTranslation('admin_nav');
  const { t: tAdmin } = useTranslation('admin_advanced');
  useAdminPageMeta({ title: tNav('advanced') });
  const toast = useToast();

  const [checks, setChecks] = useState<SeoAuditCheck[]>([]);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  /** Load the most recent audit results from the API */
  const loadAudit = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminTools.getSeoAudit();
      if (res.success && res.data) {
        setChecks(res.data.checks);
        setLastRunAt(res.data.run_at);
      }
    } catch {
      // No previous audit results available - that is fine
      setChecks([]);
      setLastRunAt(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAudit();
  }, [loadAudit]);

  /** Trigger a new SEO audit via the API */
  const handleRunAudit = useCallback(async () => {
    setRunning(true);
    try {
      const res = await adminTools.runSeoAudit();
      if (res.success && res.data) {
        const newChecks = res.data.checks;
        setChecks(newChecks);
        setLastRunAt(res.data.run_at);

        const passCount = newChecks.filter(c => c.status === 'pass').length;
        const warnCount = newChecks.filter(c => c.status === 'warning').length;
        const failCount = newChecks.filter(c => c.status === 'fail').length;

        toast.success(
          t('seo_audit_complete'),
          t('seo_audit_summary_counts', { passCount, warnCount, failCount })
        );
      } else {
        toast.error(t('seo_audit_failed'), t('seo_audit_no_results'));
      }
    } catch {
      toast.error(t('seo_audit_failed'), t('seo_audit_error'));
    } finally {
      setRunning(false);
    }
  }, [t, toast])


  const passCount = checks.filter(c => c.status === 'pass').length;
  const warnCount = checks.filter(c => c.status === 'warning').length;
  const failCount = checks.filter(c => c.status === 'fail').length;
  const hasResults = checks.length > 0;

  if (loading) {
    return (
      <div>
        <PageHeader
          title={t('seo_audit_title')}
          description={t('seo_audit_desc')}
        />
        <div className="flex h-64 items-center justify-center">
          <div role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="flex justify-center py-4"><Spinner size="lg" /></div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('seo_audit_title')}
        description={t('seo_audit_desc')}
        actions={
          <div className="flex items-center gap-2">
            {hasResults && (
              <Button
                variant="tertiary"
                startContent={<RefreshCw size={16} />}
                onPress={loadAudit}
                size="sm"
              >
                {t('reload_results')}
              </Button>
            )}
            <Button
              startContent={!running ? <Play size={16} /> : undefined}
              onPress={handleRunAudit}
              isLoading={running}
            >
              {t('run_audit')}
            </Button>
          </div>
        }
      />

      {hasResults && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {passCount > 0 && <Chip color="success" variant="soft">{t('passed_count_with_value', { count: passCount })}</Chip>}
          {warnCount > 0 && <Chip color="warning" variant="soft">{t('warnings_count_with_value', { count: warnCount })}</Chip>}
          {failCount > 0 && <Chip color="danger" variant="soft">{t('failed_count_with_value', { count: failCount })}</Chip>}
          {lastRunAt && (
            <span className="text-xs text-muted ml-2">
              {t('last_run')}: {new Date(lastRunAt).toLocaleString(getFormattingLocale())}
            </span>
          )}
        </div>
      )}

      <Card >
        <CardHeader>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <ClipboardCheck size={20} /> {t('audit_results')}
          </h3>
        </CardHeader>
        <CardBody>
          {!hasResults ? (
            <div className="flex flex-col items-center py-8 text-muted">
              <ClipboardCheck size={40} className="mb-2" />
              <p className="font-medium">{t('no_audit_results')}</p>
              <p className="text-sm mt-1">{t('no_audit_results_desc')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {checks.map((check) => (
                <div key={check.code} className="flex items-start justify-between rounded-lg border border-border p-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{t(getSeoAuditCheckNameKey(check.code), check.params)}</p>
                    <p className="text-xs text-muted">
                      {t(getSeoAuditCheckDescriptionKey(check.code), check.params)}
                    </p>
                    {check.issues.length > 0 && (
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted">
                        {check.issues.map((issue, index) => (
                          <li key={`${issue.code}-${index}`}>
                            {t(getSeoAuditIssueKey(issue.code, issue.params), issue.params)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <Chip
                    size="sm"
                    variant="soft"
                    color={statusColorMap[check.status] ?? 'default'}
                    className="capitalize shrink-0 ml-3"
                  >
                    {t(`status_${check.status}`)}
                  </Chip>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export default SeoAudit;
