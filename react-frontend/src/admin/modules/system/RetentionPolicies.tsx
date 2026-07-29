// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Data Retention Policies (IT-Data-03)
 *
 * Per-tenant, per-data-type retention configuration: enable a policy,
 * set the retention window (30–3650 days), and review the disposal run
 * log. Policies are opt-in — a disabled policy means data is retained
 * indefinitely. Enforcement runs nightly via `retention:enforce`.
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useState, useCallback, useEffect } from 'react';
import DatabaseZap from 'lucide-react/icons/database-zap';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { Button, Card, CardBody, CardHeader, Chip, Input, Spinner, Switch } from '@/components/ui';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { PageHeader } from '../../components/PageHeader';

interface RetentionPolicy {
  data_type: string;
  retention_days: number;
  action: string;
  is_enabled: boolean;
  updated_at: string | null;
}

interface RetentionLimits {
  min_days: number;
  max_days: number;
  actions: string[];
}

interface RetentionRun {
  id: number;
  data_type: string;
  action: string;
  retention_days: number;
  affected_rows: number;
  status: string;
  error: string | null;
  ran_at: string;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString(getFormattingLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusColor(status: string): 'success' | 'warning' | 'danger' {
  if (status === 'completed') return 'success';
  if (status === 'partial') return 'warning';
  return 'danger';
}

export function RetentionPolicies() {
  const { t } = useTranslation('admin_system');
  useAdminPageMeta({ title: t('retention.page_title') });
  const toast = useToast();

  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [limits, setLimits] = useState<RetentionLimits>({ min_days: 30, max_days: 3650, actions: ['delete'] });
  const [runs, setRuns] = useState<RetentionRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingType, setSavingType] = useState<string | null>(null);
  // Per-row day inputs kept as strings so partial typing doesn't snap to 0
  const [dayInputs, setDayInputs] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [policiesRes, runsRes] = await Promise.all([
        api.get<{ policies: RetentionPolicy[]; limits: RetentionLimits }>('/v2/admin/retention/policies'),
        api.get<{ runs: RetentionRun[] }>('/v2/admin/retention/runs?limit=25'),
      ]);

      if (policiesRes.success && policiesRes.data) {
        setPolicies(policiesRes.data.policies);
        setLimits(policiesRes.data.limits);
        const inputs: Record<string, string> = {};
        for (const p of policiesRes.data.policies) {
          inputs[p.data_type] = String(p.retention_days);
        }
        setDayInputs(inputs);
      }
      if (runsRes.success && runsRes.data) {
        setRuns(runsRes.data.runs);
      }
    } catch {
      toast.error(t('retention.load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const savePolicy = useCallback(
    async (policy: RetentionPolicy, isEnabled: boolean) => {
      const days = parseInt(dayInputs[policy.data_type] ?? String(policy.retention_days), 10) || 0;
      setSavingType(policy.data_type);
      try {
        const res = await api.put<{ policy: RetentionPolicy }>(
          `/v2/admin/retention/policies/${encodeURIComponent(policy.data_type)}`,
          { retention_days: days, is_enabled: isEnabled, action: policy.action }
        );
        if (res.success && res.data?.policy) {
          const updated = res.data.policy;
          setPolicies((prev) => prev.map((p) => (p.data_type === updated.data_type ? updated : p)));
          setDayInputs((prev) => ({ ...prev, [updated.data_type]: String(updated.retention_days) }));
          toast.success(t('retention.policy_saved'));
        } else {
          // admin-i18n-ignore: localized server message — the retention
          // controller's refusals are __() keys.
          toast.error(res.error || t('retention.save_failed'));
        }
      } catch {
        toast.error(t('retention.save_failed'));
      } finally {
        setSavingType(null);
      }
    },
    [dayInputs, t, toast]
  );

  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('retention.loading')} className="flex h-32 items-center justify-center">
        <Spinner size="sm" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('retention.page_title')}
        subtitle={t('retention.page_subtitle')}
        icon={<DatabaseZap size={22} />}
        actions={
          <Button size="sm" variant="secondary" startContent={<RefreshCw size={14} />} onPress={load}>
            {t('retention.refresh')}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">{t('retention.policies_title')}</h3>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-muted">
            {t('retention.policies_intro', { min: limits.min_days, max: limits.max_days })}
          </p>
          {policies.map((policy) => (
            <div
              key={policy.data_type}
              className="flex flex-col gap-3 rounded-lg bg-surface-secondary px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex-1">
                <p className="font-medium">{t(`retention.type_${policy.data_type}`)}</p>
                <p className="text-sm text-muted">{t(`retention.type_${policy.data_type}_desc`)}</p>
              </div>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={limits.min_days}
                  max={limits.max_days}
                  className="w-28"
                  value={dayInputs[policy.data_type] ?? String(policy.retention_days)}
                  onValueChange={(val) => setDayInputs((prev) => ({ ...prev, [policy.data_type]: val }))}
                  aria-label={t('retention.days_aria', { type: t(`retention.type_${policy.data_type}`) })}
                  isDisabled={savingType === policy.data_type}
                />
                <span className="text-sm text-muted">{t('retention.days_suffix')}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  isDisabled={savingType === policy.data_type}
                  onPress={() => savePolicy(policy, policy.is_enabled)}
                >
                  {t('retention.save')}
                </Button>
                <Switch
                  isSelected={policy.is_enabled}
                  onValueChange={(val) => savePolicy(policy, val)}
                  isDisabled={savingType === policy.data_type}
                  aria-label={t('retention.enable_aria', { type: t(`retention.type_${policy.data_type}`) })}
                />
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">{t('retention.runs_title')}</h3>
        </CardHeader>
        <CardBody>
          {runs.length === 0 ? (
            <p className="text-sm text-muted">{t('retention.no_runs')}</p>
          ) : (
            <ul className="space-y-2">
              {runs.map((run) => (
                <li
                  key={run.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg bg-surface-secondary px-3 py-2 text-sm"
                >
                  <Chip size="sm" color={statusColor(run.status)} variant="soft">
                    {t(`retention.status_${run.status}`, { defaultValue: t('retention.status_unknown') })}
                  </Chip>
                  <span className="font-medium">{t(`retention.type_${run.data_type}`, { defaultValue: t('retention.type_unknown') })}</span>
                  <span className="text-muted">
                    {t('retention.run_summary', { rows: run.affected_rows, days: run.retention_days })}
                  </span>
                  <span className="ml-auto text-xs text-muted">{formatDate(run.ran_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export default RetentionPolicies;
