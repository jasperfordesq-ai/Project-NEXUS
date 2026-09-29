import { getFormattingLocale } from '@/lib/helpers';
import { Button, Card, CardBody, CardHeader, Chip, Input, Spinner, Textarea, Switch, Tabs, Tab, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Separator } from '@/components/ui';
import Coins from 'lucide-react/icons/coins';
import Info from 'lucide-react/icons/info';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Save from 'lucide-react/icons/save';
import Plus from 'lucide-react/icons/plus';
import SlidersHorizontal from 'lucide-react/icons/sliders-horizontal';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { MemberSearchPicker, type MemberSearchMember } from '../../components/MemberSearchPicker';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * RegionalPointsAdminPage — AG28 admin console for the regional points
 * (third currency) programme.
 *
 * - Toggle programme on/off and configure label/symbol/auto-issue
 * - View tenant-wide ledger and stats
 * - Manually issue / adjust points for a member
 *
 */


// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface RegionalPointsConfig {
  enabled: boolean;
  label: string;
  label_code?: 'default' | null;
  symbol: string;
  auto_issue_enabled: boolean;
  points_per_approved_hour: number;
  member_transfers_enabled: boolean;
  marketplace_redemption_enabled: boolean;
  /** F-225: false while no marketplace checkout applies regional-point discounts. */
  marketplace_redemption_available?: boolean;
}

interface LedgerRow {
  id: number;
  user_id: number;
  user_name?: string;
  type: string;
  direction: string;
  points: number;
  balance_after: number;
  description: string | null;
  created_at: string;
}

interface LedgerResponse {
  stats: {
    total_accounts?: number;
    total_balance?: number;
    total_issued?: number;
    total_spent?: number;
    transactions_30d?: number;
  };
  items: LedgerRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function RegionalPointsAdminPage() {
  const toast = useToast();
  const { t } = useTranslation('caring_community');
  const { t: tAdmin } = useTranslation('admin_caring_community');
  usePageTitle(t('admin.regional_points.title'));

  const [config, setConfig] = useState<RegionalPointsConfig | null>(null);
  const [ledger, setLedger] = useState<LedgerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Issue/adjust form
  const [member, setMember] = useState<MemberSearchMember | null>(null);
  const [memberQuery, setMemberQuery] = useState('');
  const [issuePoints, setIssuePoints] = useState('');
  const [issueDescription, setIssueDescription] = useState('');
  const [adjustDelta, setAdjustDelta] = useState('');
  const [adjustDescription, setAdjustDescription] = useState('');
  const [submittingIssue, setSubmittingIssue] = useState(false);
  const [submittingAdjust, setSubmittingAdjust] = useState(false);

  const loadAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [cfgRes, ledRes] = await Promise.all([
        api.get<RegionalPointsConfig>('/v2/admin/caring-community/regional-points/config'),
        api.get<LedgerResponse>('/v2/admin/caring-community/regional-points/ledger?limit=100'),
      ]);
      if (cfgRes.success && cfgRes.data) setConfig(cfgRes.data);
      else if (!cfgRes.success) toast.error(t('admin.regional_points.errors.load'));
      if (ledRes.success && ledRes.data) setLedger(ledRes.data);
      // ledger may 403 if disabled — that's fine, show empty
    } catch (err) {
      logError('RegionalPointsAdminPage: load failed', err);
      toast.error(t('admin.regional_points.errors.load'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t, toast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleSaveConfig = useCallback(async () => {
    if (!config) return;
    setSavingConfig(true);
    try {
      const res = await api.put<RegionalPointsConfig>(
        '/v2/admin/caring-community/regional-points/config',
        config,
      );
      if (res.success && res.data) {
        setConfig(res.data);
        toast.success(t('admin.regional_points.messages.config_saved'));
        void loadAll();
      } else {
        toast.error(t('admin.regional_points.errors.save_config'));
      }
    } catch (err) {
      logError('RegionalPointsAdminPage: save config failed', err);
      toast.error(t('admin.regional_points.errors.save_config'));
    } finally {
      setSavingConfig(false);
    }
  }, [config, t, toast, loadAll]);

  const handleIssue = useCallback(async () => {
    if (!member) {
      toast.error(t('admin.regional_points.errors.pick_member'));
      return;
    }
    const amount = parseFloat(issuePoints);
    if (!amount || amount <= 0) {
      toast.error(t('admin.regional_points.errors.positive_amount'));
      return;
    }
    setSubmittingIssue(true);
    try {
      const res = await api.post('/v2/admin/caring-community/regional-points/issue', {
        user_id: member.id,
        points: amount,
        description: issueDescription.trim(),
      });
      if (res.success) {
        toast.success(t('admin.regional_points.messages.issued', { amount, member: member.name }));
        setIssuePoints('');
        setIssueDescription('');
        void loadAll();
      } else {
        toast.error(t('admin.regional_points.errors.issue'));
      }
    } catch (err) {
      logError('RegionalPointsAdminPage: issue failed', err);
      toast.error(t('admin.regional_points.errors.issue'));
    } finally {
      setSubmittingIssue(false);
    }
  }, [member, issuePoints, issueDescription, t, toast, loadAll]);

  const handleAdjust = useCallback(async () => {
    if (!member) {
      toast.error(t('admin.regional_points.errors.pick_member'));
      return;
    }
    const delta = parseFloat(adjustDelta);
    if (!delta || delta === 0) {
      toast.error(t('admin.regional_points.errors.non_zero_delta'));
      return;
    }
    setSubmittingAdjust(true);
    try {
      const res = await api.post('/v2/admin/caring-community/regional-points/adjust', {
        user_id: member.id,
        points_delta: delta,
        description: adjustDescription.trim(),
      });
      if (res.success) {
        toast.success(t('admin.regional_points.messages.adjusted', { member: member.name, delta }));
        setAdjustDelta('');
        setAdjustDescription('');
        void loadAll();
      } else {
        toast.error(t('admin.regional_points.errors.adjust'));
      }
    } catch (err) {
      logError('RegionalPointsAdminPage: adjust failed', err);
      toast.error(t('admin.regional_points.errors.adjust'));
    } finally {
      setSubmittingAdjust(false);
    }
  }, [member, adjustDelta, adjustDescription, t, toast, loadAll]);

  if (loading || !config) {
    return (
      <div role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="flex items-center justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  const stats = ledger?.stats ?? {};
  const items = ledger?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('admin.regional_points.title')}
        description={t('admin.regional_points.description')}
        actions={
          <Button
            size="sm"
            variant="secondary"
            startContent={<RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />}
            onPress={() => void loadAll()}
            isDisabled={refreshing}
          >
            {t('admin.common.refresh')}
          </Button>
        }
      />

      {/* Intro card */}
      <Card className="border-l-4 border-l-accent bg-accent-soft dark:bg-accent-soft" >
        <CardBody className="px-4 py-3">
          <div className="flex gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-accent dark:text-accent">{t('admin.regional_points.about.title')}</p>
              <p className="text-muted">
                {t('admin.regional_points.about.body')}
              </p>
              <p className="text-muted">
                {t('admin.regional_points.about.secondary')}
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          icon={Coins}
          label={t('admin.regional_points.stats.total_balance')}
          value={Number(stats.total_balance ?? 0).toFixed(2)}
          color="warning"
        />
        <StatCard
          icon={Plus}
          label={t('admin.regional_points.stats.lifetime_issued')}
          value={Number(stats.total_issued ?? 0).toFixed(2)}
          color="success"
        />
        <StatCard
          icon={SlidersHorizontal}
          label={t('admin.regional_points.stats.lifetime_spent')}
          value={Number(stats.total_spent ?? 0).toFixed(2)}
        />
        <StatCard
          icon={Coins}
          label={t('admin.regional_points.stats.member_accounts')}
          value={String(stats.total_accounts ?? 0)}
        />
      </div>

      {/* Config */}
      <Card>
        <CardHeader className="flex items-center gap-2">
          <SlidersHorizontal className="w-5 h-5 text-accent" />
          <h2 className="text-base font-semibold">{t('admin.regional_points.config.title')}</h2>
        </CardHeader>
        <Separator />
        <CardBody className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{t('admin.regional_points.config.enabled')}</p>
              <p className="text-xs text-muted">
                {t('admin.regional_points.config.enabled_hint')}
              </p>
            </div>
            <Switch
              isSelected={config.enabled}
              onValueChange={(v) => setConfig({ ...config, enabled: v })}
              color="success"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label={t('admin.regional_points.config.display_label')}
              value={config.label || t('admin.regional_points.title')}
              onValueChange={(v) => setConfig({ ...config, label: v })}
              description={t('admin.regional_points.config.display_label_description')}
            />
            <Input
              label={t('admin.regional_points.config.symbol')}
              value={config.symbol}
              onValueChange={(v) => setConfig({ ...config, symbol: v })}
              description={t('admin.regional_points.config.symbol_description')}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{t('admin.regional_points.config.auto_issue')}</p>
              <p className="text-xs text-muted">
                {t('admin.regional_points.config.auto_issue_hint')}
              </p>
            </div>
            <Switch
              isSelected={config.auto_issue_enabled}
              onValueChange={(v) => setConfig({ ...config, auto_issue_enabled: v })}
              color="success"
            />
          </div>

          <Input
            label={t('admin.regional_points.config.points_per_hour')}
            type="number"
            value={String(config.points_per_approved_hour)}
            onValueChange={(v) =>
              setConfig({ ...config, points_per_approved_hour: parseFloat(v) || 0 })
            }
            min="0"
            step="0.5"
            isDisabled={!config.auto_issue_enabled}
          />

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{t('admin.regional_points.config.member_transfers')}</p>
              <p className="text-xs text-muted">{t('admin.regional_points.config.member_transfers_hint')}</p>
            </div>
            <Switch
              isSelected={config.member_transfers_enabled}
              onValueChange={(v) => setConfig({ ...config, member_transfers_enabled: v })}
              color="success"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{t('admin.regional_points.config.marketplace_redemption')}</p>
              <p className="text-xs text-muted">
                {config.marketplace_redemption_available === false
                  ? tAdmin('regional_points.marketplace_redemption_unavailable')
                  : t('admin.regional_points.config.marketplace_redemption_hint')}
              </p>
            </div>
            <Switch
              isSelected={config.marketplace_redemption_available !== false && config.marketplace_redemption_enabled}
              isDisabled={config.marketplace_redemption_available === false}
              aria-label={t('admin.regional_points.config.marketplace_redemption')}
              onValueChange={(v) =>
                setConfig({ ...config, marketplace_redemption_enabled: v })
              }
              color="success"
            />
          </div>

          <div className="flex justify-end">
            <Button
              startContent={<Save className="w-4 h-4" />}
              onPress={() => void handleSaveConfig()}
              isLoading={savingConfig}
            >
              {t('admin.regional_points.config.save')}
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Issue / Adjust */}
      <Card>
        <CardHeader className="flex items-center gap-2">
          <Plus className="w-5 h-5 text-success" />
          <h2 className="text-base font-semibold">{t('admin.regional_points.member_balance.title')}</h2>
        </CardHeader>
        <Separator />
        <CardBody className="space-y-4">
          <MemberSearchPicker
            label={t('admin.regional_points.member_balance.member')}
            placeholder={t('admin.regional_points.member_balance.member_placeholder')}
            value={memberQuery}
            onValueChange={setMemberQuery}
            selectedMember={member}
            onSelectedMemberChange={setMember}
            noResultsText={t('admin.regional_points.member_balance.no_matching_members')}
            clearText={t('admin.regional_points.member_balance.clear')}
          />

          {member && (
            <Tabs aria-label={t('admin.regional_points.member_balance.tabs_aria')}>
              <Tab key="issue" title={t('admin.regional_points.member_balance.issue_tab')}>
                <div className="space-y-3 pt-3">
                  <Input
                    label={t('admin.regional_points.member_balance.points_to_issue')}
                    type="number"
                    min="0"
                    step="0.5"
                    value={issuePoints}
                    onValueChange={setIssuePoints}
                  />
                  <Textarea
                    label={t('admin.regional_points.member_balance.description')}
                    minRows={2}
                    value={issueDescription}
                    onValueChange={setIssueDescription}
                  />
                  <div className="flex justify-end">
                    <Button
                      onPress={() => void handleIssue()}
                      isLoading={submittingIssue}
                    >
                      {t('admin.regional_points.member_balance.issue')}
                    </Button>
                  </div>
                </div>
              </Tab>
              <Tab key="adjust" title={t('admin.regional_points.member_balance.adjust_tab')}>
                <div className="space-y-3 pt-3">
                  <Input
                    label={t('admin.regional_points.member_balance.points_delta')}
                    type="number"
                    step="0.5"
                    value={adjustDelta}
                    onValueChange={setAdjustDelta}
                  />
                  <Textarea
                    label={t('admin.regional_points.member_balance.description')}
                    minRows={2}
                    value={adjustDescription}
                    onValueChange={setAdjustDescription}
                  />
                  <div className="flex justify-end">
                    <Button
                      color="warning"
                      onPress={() => void handleAdjust()}
                      isLoading={submittingAdjust}
                    >
                      {t('admin.regional_points.member_balance.apply_adjustment')}
                    </Button>
                  </div>
                </div>
              </Tab>
            </Tabs>
          )}
        </CardBody>
      </Card>

      {/* Ledger */}
      <Card>
        <CardHeader className="flex items-center gap-2">
          <Coins className="w-5 h-5 text-warning" />
          <h2 className="text-base font-semibold">{t('admin.regional_points.ledger.title')}</h2>
          <Chip size="sm" variant="soft" className="ml-auto">
            {items.length}
          </Chip>
        </CardHeader>
        <Separator />
        <CardBody className="p-0">
          <Table removeWrapper aria-label={t('admin.regional_points.ledger.aria')}>
            <TableHeader>
              <TableColumn>{t('admin.regional_points.ledger.date')}</TableColumn>
              <TableColumn>{t('admin.regional_points.ledger.member')}</TableColumn>
              <TableColumn>{t('admin.regional_points.ledger.type')}</TableColumn>
              <TableColumn className="hidden md:table-cell">{t('admin.regional_points.ledger.description')}</TableColumn>
              <TableColumn className="text-right">{t('admin.regional_points.ledger.points')}</TableColumn>
              <TableColumn className="hidden text-right md:table-cell">{t('admin.regional_points.ledger.balance')}</TableColumn>
            </TableHeader>
            <TableBody emptyContent={t('admin.regional_points.ledger.empty')}>
              {items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-sm">
                    {new Date(row.created_at).toLocaleDateString(getFormattingLocale())}
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.user_name || t('admin.regional_points.ledger.user_fallback', { id: row.user_id })}
                  </TableCell>
                  <TableCell className="text-sm">
                    <Chip size="sm" variant="soft">
                      {tAdmin(`regional_points.ledger_types.${row.type}`, { defaultValue: tAdmin('regional_points.ledger_types.unknown') })}
                    </Chip>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted md:table-cell">
                    {row.description || t('admin.common.empty_dash')}
                  </TableCell>
                  <TableCell
                    className={`text-right text-sm tabular-nums ${
                      row.direction === 'in' ? 'text-success' : 'text-danger'
                    }`}
                  >
                    {row.direction === 'in' ? '+' : '-'}
                    {row.points.toFixed(2)}
                  </TableCell>
                  <TableCell className="hidden text-right text-sm tabular-nums text-muted md:table-cell">
                    {row.balance_after.toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
