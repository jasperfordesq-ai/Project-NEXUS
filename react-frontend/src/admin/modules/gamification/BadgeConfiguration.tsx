import { CardBody, Card, Button, Chip, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Spinner, Switch, Tabs, Tab, Textarea } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Badge Configuration — Admin page for per-tenant badge enable/disable and customization.
 */

import { useState, useCallback, useEffect } from 'react';

import Award from 'lucide-react/icons/award';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import Pencil from 'lucide-react/icons/pencil';
import Shield from 'lucide-react/icons/shield';
import Star from 'lucide-react/icons/star';
import Gem from 'lucide-react/icons/gem';
import Zap from 'lucide-react/icons/zap';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { useTranslation } from 'react-i18next';
import { adminGamification } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import type { BadgeConfigEntry } from '../../api/types';
import { badgeDisplayDescription, badgeDisplayName } from './badgeDisplay';

// TIER_LABELS removed — tier display names now come from i18n (gamification.badge_tiers.*)

const TIER_COLORS: Record<string, 'primary' | 'success' | 'warning' | 'secondary' | 'danger'> = {
  core: 'primary',
  template: 'success',
  custom: 'warning',
};

const RARITY_COLORS: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'secondary'> = {
  common: 'default',
  uncommon: 'success',
  rare: 'primary',
  epic: 'warning',
  legendary: 'danger',
};

const CLASS_ICONS: Record<string, typeof Award> = {
  quantity: Star,
  quality: Gem,
  special: Zap,
  verification: Shield,
};

const tierOrder = ['core', 'template', 'custom'];

type FilterTab = 'all' | 'core' | 'template' | 'custom' | 'quality';

export function BadgeConfiguration() {
  const { t } = useTranslation('admin_gamification');
  usePageTitle(t('gamification.badge_configuration_title'));
  const toast = useToast();

  const [badges, setBadges] = useState<BadgeConfigEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>('all');

  const loadBadges = useCallback(async () => {
    setLoading(true);
    const res = await adminGamification.getBadgeConfig();
    if (res.success && res.data) {
      setBadges(res.data as BadgeConfigEntry[]);
    } else {
      toast.error(t('gamification.failed_to_load_badge_configuration'));
    }
    setLoading(false);
  }, [t, toast])


  useEffect(() => {
    loadBadges();
  }, [loadBadges]);

  const handleToggle = async (badge: BadgeConfigEntry, enabled: boolean) => {
    if (badge.badge_tier === 'core') return;
    setUpdating(badge.key);
    const res = await adminGamification.updateBadgeConfig(badge.key, { is_enabled: enabled });
    if (res.success) {
      setBadges((prev) =>
        prev.map((b) => (b.key === badge.key ? { ...b, is_enabled: enabled } : b)),
      );
      toast.success(t('gamification.badge_toggled'));
    } else {
      toast.error(t('gamification.failed_to_update_badge'));
    }
    setUpdating(null);
  };

  // A community's own medal wording (AWID focus group, Oct 2026: "Can we
  // customise the text … in medals?"). Empty means the standard, translated text.
  const [wordingFor, setWordingFor] = useState<BadgeConfigEntry | null>(null);
  const [wordingName, setWordingName] = useState('');
  const [wordingDescription, setWordingDescription] = useState('');
  const [savingWording, setSavingWording] = useState(false);

  const openWording = (badge: BadgeConfigEntry) => {
    setWordingFor(badge);
    // Only what the community wrote; the standard wording shows as the placeholder.
    setWordingName(badge.has_override && !badge.name_code ? badge.name : '');
    setWordingDescription(badge.has_override && !badge.description_code ? badge.description : '');
  };

  const saveWording = async () => {
    if (!wordingFor) return;
    setSavingWording(true);
    const res = await adminGamification.updateBadgeConfig(wordingFor.key, {
      custom_name: wordingName.trim(),
      custom_description: wordingDescription.trim(),
    });
    setSavingWording(false);
    if (res.success) {
      toast.success(t('gamification.wording_saved'));
      setWordingFor(null);
      loadBadges();
    } else {
      toast.error(t('gamification.wording_save_failed'));
    }
  };

  const handleReset = async (badge: BadgeConfigEntry) => {
    setUpdating(badge.key);
    const res = await adminGamification.resetBadgeConfig(badge.key);
    if (res.success) {
      toast.success(t('gamification.badge_reset_to_defaults'));
      loadBadges();
    } else {
      toast.error(t('gamification.failed_to_reset_badge'));
    }
    setUpdating(null);
  };

  const filtered = badges.filter((b) => {
    if (filter === 'all') return true;
    if (filter === 'quality') return b.badge_class === 'quality';
    return b.badge_tier === filter;
  });

  const grouped = filtered.reduce<Record<string, BadgeConfigEntry[]>>((acc, b) => {
    const tier = b.badge_tier;
    if (!acc[tier]) acc[tier] = [];
    acc[tier].push(b);
    return acc;
  }, {});

  if (loading) {
    return (
      <div>
        <PageHeader title={t('gamification.badge_configuration_title')} description={t('gamification.badge_configuration_desc')} />
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex items-center justify-center py-24">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('gamification.badge_configuration_title')}
        description={t('gamification.badge_configuration_desc')}
      />

      <Tabs
        aria-label={t('gamification.badge_filter')}
        selectedKey={filter}
        onSelectionChange={(key) => setFilter(key as FilterTab)}
        className="mb-6"
      >
        <Tab key="all" title={t('gamification.filter_all')} />
        <Tab key="core" title={t('gamification.badge_tiers.core')} />
        <Tab key="template" title={t('gamification.badge_tiers.template')} />
        <Tab key="custom" title={t('gamification.badge_tiers.custom')} />
        <Tab key="quality" title={t('gamification.badge_classes.quality')} />
      </Tabs>

      {filtered.length === 0 ? (
        <Card >
          <CardBody className="flex flex-col items-center justify-center py-12">
            <Award size={40} className="text-muted mb-2" />
            <p className="text-muted">{t('gamification.no_badges_for_filter')}</p>
          </CardBody>
        </Card>
      ) : (
        tierOrder
          .filter((tier) => grouped[tier]?.length)
          .map((tier) => (
            <div key={tier} className="mb-8">
              <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
                <Chip color={TIER_COLORS[tier] ?? 'primary'} size="sm" variant="soft">
                  {t(`gamification.badge_tiers.${tier}`)}
                </Chip>
                <span className="text-muted text-sm font-normal">
                  {t('gamification.badge_count', { count: (grouped[tier] ?? []).length })}
                </span>
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(grouped[tier] ?? []).map((badge) => {
                  const IconComp = CLASS_ICONS[badge.badge_class] ?? Award;
                  const isUpdating = updating === badge.key;
                  const displayName = badgeDisplayName(t, badge);
                  const displayDescription = badgeDisplayDescription(t, badge);
                  return (
                    <Card
                      key={badge.key}

                      className={`transition-opacity ${!badge.is_enabled ? 'opacity-50' : ''}`}
                    >
                      <CardBody className="gap-3 p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent-soft-foreground">
                              <IconComp size={20} />
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-foreground truncate">{displayName}</p>
                              <p className="text-xs text-muted line-clamp-2">{displayDescription}</p>
                            </div>
                          </div>
                          <Switch
                            size="sm"
                            isSelected={badge.is_enabled}
                            isDisabled={badge.badge_tier === 'core' || isUpdating}
                            onValueChange={(val) => handleToggle(badge, val)}
                            aria-label={t('gamification.toggle_badge_aria', { name: displayName })}
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Chip size="sm" variant="soft" color={RARITY_COLORS[badge.rarity] ?? 'default'}>
                            {t(`gamification.badge_rarities.${badge.rarity}`)}
                          </Chip>
                          {badge.threshold > 0 && (
                            <Chip size="sm" variant="soft">
                              {t('gamification.threshold_count', { count: badge.threshold })}
                            </Chip>
                          )}
                          {badge.xp_value > 0 && (
                            <Chip size="sm" variant="soft" color="warning">
                              {t('gamification.xp_count', { count: badge.xp_value })}
                            </Chip>
                          )}
                          {badge.has_override && (
                            <Chip size="sm" variant="dot">
                              {t('gamification.customized')}
                            </Chip>
                          )}
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            startContent={<Pencil size={14} aria-hidden="true" />}
                            onPress={() => openWording(badge)}
                            aria-label={`${t('gamification.edit_wording')}: ${displayName}`}
                          >
                            {t('gamification.edit_wording')}
                          </Button>
                          {badge.has_override && (
                            <Button
                              size="sm"
                              variant="danger"
                              startContent={<RotateCcw size={14} />}
                              isLoading={isUpdating}
                              onPress={() => handleReset(badge)}
                            >
                              {t('gamification.reset_to_default')}
                            </Button>
                          )}
                        </div>
                      </CardBody>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))
      )}

      <Modal isOpen={wordingFor !== null} onClose={() => setWordingFor(null)} size="lg">
        <ModalContent>
          <ModalHeader>{t('gamification.edit_wording_title')}</ModalHeader>
          <ModalBody className="gap-4">
            <p className="text-sm text-muted">{t('gamification.wording_hint')}</p>
            <Input
              label={t('gamification.wording_name_label')}
              placeholder={wordingFor ? badgeDisplayName(t, { ...wordingFor, name: wordingFor.name }) : ''}
              value={wordingName}
              onValueChange={setWordingName}
              maxLength={200}
            />
            <Textarea
              label={t('gamification.wording_description_label')}
              placeholder={wordingFor ? badgeDisplayDescription(t, wordingFor) : ''}
              value={wordingDescription}
              onValueChange={setWordingDescription}
              maxLength={255}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setWordingFor(null)} isDisabled={savingWording}>
              {t('gamification.cancel')}
            </Button>
            <Button onPress={() => void saveWording()} isLoading={savingWording}>
              {t('gamification.save_changes')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default BadgeConfiguration;
