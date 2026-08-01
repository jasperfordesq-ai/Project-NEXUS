import { Card, CardBody, CardHeader, Button, Spinner, Textarea, Select, SelectItem, useDisclosure, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui';
import { useState, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';

import Award from 'lucide-react/icons/award';
import Users from 'lucide-react/icons/users';
import Zap from 'lucide-react/icons/zap';
import Target from 'lucide-react/icons/target';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Megaphone from 'lucide-react/icons/megaphone';
import BarChart3 from 'lucide-react/icons/chart-column';
import Settings2 from 'lucide-react/icons/settings-2';
import Gift from 'lucide-react/icons/gift';
import Trophy from 'lucide-react/icons/trophy';
import { usePageTitle } from '@/hooks';
import { useToast, useTenant } from '@/contexts';
import { adminGamification } from '../../api/adminApi';
import { StatCard } from '../../components/StatCard';
import { PageHeader } from '../../components/PageHeader';
import type { GamificationStats, BadgeConfigEntry } from '../../api/types';
import { useTranslation } from 'react-i18next';
import { badgeDisplayName } from './badgeDisplay';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Gamification Hub
 * Dashboard overview of badges, XP, campaigns, and quick links.
 * Parity: PHP Admin\GamificationController@index
 */


// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function GamificationHub() {
  const { t } = useTranslation('admin_gamification');
  usePageTitle(t('gamification.page_title'));
  const toast = useToast();
  const { tenantPath } = useTenant();

  const [stats, setStats] = useState<GamificationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [rechecking, setRechecking] = useState(false);

  // Bulk award modal state
  const { isOpen: isBulkOpen, onOpen: onBulkOpen, onClose: onBulkClose } = useDisclosure();
  const [badges, setBadges] = useState<BadgeConfigEntry[]>([]);
  const [badgesLoading, setBadgesLoading] = useState(false);
  const [selectedBadge, setSelectedBadge] = useState('');
  const [userIdsText, setUserIdsText] = useState('');
  const [awarding, setAwarding] = useState(false);

  const loadStats = useCallback(async () => {
    setLoading(true);
    const res = await adminGamification.getStats();
    if (res.success && res.data) {
      setStats(res.data as GamificationStats);
    } else {
      toast.error(t('gamification.failed_to_load_gamification_stats'));
    }
    setLoading(false);
  }, [t, toast])


  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleOpenBulkAward = async () => {
    onBulkOpen();
    if (badges.length === 0) {
      setBadgesLoading(true);
      const res = await adminGamification.getBadgeConfig();
      if (res.success && res.data) {
        setBadges((res.data as BadgeConfigEntry[]).filter((b) => b.is_enabled));
      }
      setBadgesLoading(false);
    }
  };

  const handleBulkAward = async () => {
    if (!selectedBadge) {
      toast.error(t('gamification.bulk_award_select_badge'));
      return;
    }
    const ids = userIdsText
      .split(/[\n,]+/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0);
    if (ids.length === 0) {
      toast.error(t('gamification.bulk_award_no_users'));
      return;
    }
    setAwarding(true);
    const res = await adminGamification.bulkAward(selectedBadge, ids);
    setAwarding(false);
    if (res.success) {
      const awarded = (res.data as { awarded?: number })?.awarded ?? ids.length;
      toast.success(t('gamification.bulk_award_succeeded_count', { count: awarded }));
      onBulkClose();
      setSelectedBadge('');
      setUserIdsText('');
    } else {
      toast.error(t('gamification.bulk_award_failed'));
    }
  };

  const handleRecheckAll = async () => {
    setRechecking(true);
    const res = await adminGamification.recheckAll();
    if (res.success) {
      toast.success(t('gamification.badge_recheck_completed'));
      loadStats();
    } else {
      toast.error(t('gamification.badge_recheck_failed'));
    }
    setRechecking(false);
  };

  // Find the max value for distribution chart scaling
  const maxDistCount = stats?.badge_distribution?.reduce((max, b) => Math.max(max, b.count), 0) || 1;

  return (
    <div>
      <PageHeader
        title={t('gamification.gamification_hub_title')}
        description={t('gamification.gamification_hub_desc')}
        actions={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              startContent={<Gift aria-hidden="true" size={16} />}
              onPress={handleOpenBulkAward}
            >
              {t('gamification.bulk_award_button')}
            </Button>
            <Button
              startContent={<RefreshCw aria-hidden="true" size={16} />}
              onPress={handleRecheckAll}
              isLoading={rechecking}
            >
              {t('gamification.recheck_all_badges')}
            </Button>
          </div>
        }
      />

      {/* Stats Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <StatCard
          label={t('gamification.label_total_badges_awarded')}
          value={stats?.total_badges_awarded ?? 0}
          icon={Award}
          color="default"
          loading={loading}
        />
        <StatCard
          label={t('gamification.label_active_users')}
          value={stats?.active_users ?? 0}
          icon={Users}
          color="success"
          loading={loading}
        />
        <StatCard
          label={t('gamification.label_total_x_p_awarded')}
          value={stats?.total_xp_awarded ?? 0}
          icon={Zap}
          color="warning"
          loading={loading}
        />
        <StatCard
          label={t('gamification.label_active_campaigns')}
          value={stats?.active_campaigns ?? 0}
          icon={Target}
          color="default"
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Badge Distribution Chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between pb-0">
            <div>
              <h3 className="text-lg font-semibold text-foreground">{t('gamification.badge_distribution')}</h3>
              <p className="text-sm text-muted">{t('gamification.top_10_badges')}</p>
            </div>
          </CardHeader>
          <CardBody>
            {loading ? (
              <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex items-center justify-center py-12">
                <Spinner size="lg" />
              </div>
            ) : stats?.badge_distribution && stats.badge_distribution.length > 0 ? (
              <div className="space-y-3">
                {stats.badge_distribution.map((badge) => (
                  <div key={badge.badge_name} className="flex items-center gap-3">
                    <span className="w-36 truncate text-sm text-foreground font-medium" title={badgeDisplayName(t, { name: badge.badge_name, name_code: badge.name_code })}>
                      {badgeDisplayName(t, { name: badge.badge_name, name_code: badge.name_code })}
                    </span>
                    <div className="flex-1 h-6 rounded-lg bg-surface-secondary overflow-hidden">
                      <div
                        className="h-full rounded-lg bg-accent transition-all duration-500"
                        style={{ width: `${Math.max(2, (badge.count / maxDistCount) * 100)}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-sm font-semibold text-foreground">
                      {badge.count}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Award aria-hidden="true" size={40} className="text-muted mb-2" />
                <p className="text-muted">{t('gamification.no_badges_awarded')}</p>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Quick Links */}
        <Card>
          <CardHeader className="pb-0">
            <h3 className="text-lg font-semibold text-foreground">{t('gamification.quick_links')}</h3>
          </CardHeader>
          <CardBody className="gap-3">
            <Link to={tenantPath("/admin/gamification/campaigns")} className="block">
              <Card className="bg-surface-secondary hover:bg-surface-tertiary transition-colors cursor-pointer">
                <CardBody className="flex flex-row items-center gap-3 p-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <Megaphone aria-hidden="true" size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground">{t('gamification.campaigns')}</p>
                    <p className="text-xs text-muted">{t('gamification.manage_badge_campaigns')}</p>
                  </div>
                  <ArrowRight aria-hidden="true" size={16} className="text-muted" />
                </CardBody>
              </Card>
            </Link>

            <Link to={tenantPath("/admin/custom-badges")} className="block">
              <Card className="bg-surface-secondary hover:bg-surface-tertiary transition-colors cursor-pointer">
                <CardBody className="flex flex-row items-center gap-3 p-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
                    <Award aria-hidden="true" size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground">{t('gamification.custom_badges')}</p>
                    <p className="text-xs text-muted">{t('gamification.create_and_manage_badges')}</p>
                  </div>
                  <ArrowRight aria-hidden="true" size={16} className="text-muted" />
                </CardBody>
              </Card>
            </Link>

            <Link to={tenantPath("/admin/gamification/badge-config")} className="block">
              <Card className="bg-surface-secondary hover:bg-surface-tertiary transition-colors cursor-pointer">
                <CardBody className="flex flex-row items-center gap-3 p-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <Settings2 aria-hidden="true" size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground">{t('gamification.badge_configuration')}</p>
                    <p className="text-xs text-muted">{t('gamification.configure_badge_availability')}</p>
                  </div>
                  <ArrowRight aria-hidden="true" size={16} className="text-muted" />
                </CardBody>
              </Card>
            </Link>

            <Link to={tenantPath("/admin/gamification/analytics")} className="block">
              <Card className="bg-surface-secondary hover:bg-surface-tertiary transition-colors cursor-pointer">
                <CardBody className="flex flex-row items-center gap-3 p-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
                    <BarChart3 aria-hidden="true" size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground">{t('gamification.analytics')}</p>
                    <p className="text-xs text-muted">{t('gamification.gamification_insights')}</p>
                  </div>
                  <ArrowRight aria-hidden="true" size={16} className="text-muted" />
                </CardBody>
              </Card>
            </Link>

            <Link to={tenantPath("/admin/gamification/challenges")} className="block">
              <Card className="bg-surface-secondary hover:bg-surface-tertiary transition-colors cursor-pointer">
                <CardBody className="flex flex-row items-center gap-3 p-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger">
                    <Trophy aria-hidden="true" size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground">{t('challenges.title')}</p>
                    <p className="text-xs text-muted">{t('challenges.hub_desc')}</p>
                  </div>
                  <ArrowRight aria-hidden="true" size={16} className="text-muted" />
                </CardBody>
              </Card>
            </Link>
          </CardBody>
        </Card>
      </div>

      {/* Bulk Badge Award Modal */}
      <Modal isOpen={isBulkOpen} onClose={onBulkClose} size="md">
        <ModalContent>
          <ModalHeader>{t('gamification.bulk_award_modal_title')}</ModalHeader>
          <ModalBody className="gap-4">
            <p className="text-sm text-muted">
              {t('gamification.bulk_award_modal_desc')}
            </p>
            {badgesLoading ? (
              <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner /></div>
            ) : (
              <Select
                label={t('gamification.bulk_award_badge_label')}
                placeholder={t('gamification.bulk_award_badge_placeholder')}
                selectedKeys={selectedBadge ? [selectedBadge] : []}
                onSelectionChange={(keys) => setSelectedBadge(Array.from(keys)[0] as string ?? '')}
              >
                {badges.map((b) => (
                  <SelectItem key={b.key} id={b.key}>{badgeDisplayName(t, b)}</SelectItem>
                ))}
              </Select>
            )}
            <Textarea
              label={t('gamification.bulk_award_users_label')}
              placeholder={t('gamification.bulk_award_users_placeholder')}
              value={userIdsText}
              onChange={(e) => setUserIdsText(e.target.value)}
              minRows={4}
              description={t('gamification.bulk_award_users_hint')}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={onBulkClose}>
              {t('gamification.cancel')}
            </Button>
            <Button variant="secondary" onPress={handleBulkAward} isLoading={awarding}>
              {t('gamification.bulk_award_submit')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default GamificationHub;
