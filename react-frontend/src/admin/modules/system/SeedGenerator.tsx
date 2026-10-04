import { Card, CardBody, CardHeader, Button, Input, Checkbox } from '@/components/ui';
import { useState, useRef } from 'react';

import Database from 'lucide-react/icons/database';
import Play from 'lucide-react/icons/play';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { PageHeader } from '../../components/PageHeader';
import { adminTools } from '../../api/adminApi';
import { useTranslation } from 'react-i18next';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Seed Generator
 * Generate sample/test data for development and testing environments.
 */

const SEED_OPTIONS = [
  { key: 'users', labelKey: 'seed_generator.option_users_label', descKey: 'seed_generator.option_users_desc', count: 50 },
  { key: 'listings', labelKey: 'seed_generator.option_listings_label', descKey: 'seed_generator.option_listings_desc', count: 100 },
  { key: 'transactions', labelKey: 'seed_generator.option_transactions_label', descKey: 'seed_generator.option_transactions_desc', count: 200 },
  { key: 'feed_posts', labelKey: 'seed_generator.option_feed_posts_label', descKey: 'seed_generator.option_feed_posts_desc', count: 75 },
  { key: 'events', labelKey: 'seed_generator.option_events_label', descKey: 'seed_generator.option_events_desc', count: 20 },
  { key: 'groups', labelKey: 'seed_generator.option_groups_label', descKey: 'seed_generator.option_groups_desc', count: 10 },
  { key: 'messages', labelKey: 'seed_generator.option_messages_label', descKey: 'seed_generator.option_messages_desc', count: 150 },
  { key: 'badges', labelKey: 'seed_generator.option_badges_label', descKey: 'seed_generator.option_badges_desc', count: 100 },
];

export function SeedGenerator() {
  const { t } = useTranslation('admin_system');
  usePageTitle(t('system.page_title'));
  const toast = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  // Store mutable count values by key
  const countsRef = useRef<Record<string, number>>(
    Object.fromEntries(SEED_OPTIONS.map(opt => [opt.key, opt.count]))
  );

  const toggleOption = (key: string) => {
    setSelected(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const handleCountChange = (key: string, value: string) => {
    const num = parseInt(value, 10);
    if (!isNaN(num) && num > 0) {
      countsRef.current[key] = num;
    }
  };

  const handleRun = async () => {
    if (selected.length === 0) return;

    setRunning(true);
    try {
      const counts: Record<string, number> = {};
      for (const key of selected) {
        counts[key] = countsRef.current[key] ?? SEED_OPTIONS.find(o => o.key === key)?.count ?? 10;
      }

      const res = await adminTools.runSeedGenerator({ types: selected, counts });
      if (res.success) {
        toast.success(
          t('system.seed_data_generated'),
          t('system.generated_data_for', { count: selected.length })
        );
      } else {
        toast.error(t('system.seed_generation_failed'), t('system.seed_generation_error'));
      }
    } catch {
      toast.error(t('system.seed_generation_failed'), t('system.seed_generation_error'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <PageHeader title={t('system.seed_generator_title')} description={t('system.seed_generator_desc')} />

      <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 mb-4 flex items-start gap-3">
        <AlertTriangle size={20} className="text-warning shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-warning-soft-foreground">{t('seed_generator.development_only')}</p>
          <p className="text-sm text-warning-soft-foreground">{t('seed_generator.warning_body')}</p>
        </div>
      </div>

      <Card >
        <CardHeader>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Database size={20} /> {t('seed_generator.data_types_heading')}
          </h3>
        </CardHeader>
        <CardBody>
          <div className="space-y-3">
            {SEED_OPTIONS.map(opt => (
              <div key={opt.key} className="flex items-center justify-between rounded-lg border border-border p-3">
                <Checkbox isSelected={selected.includes(opt.key)} onValueChange={() => toggleOption(opt.key)}>
                  <div>
                    <p className="font-medium">{t(opt.labelKey)}</p>
                    <p className="text-xs text-muted">{t(opt.descKey)}</p>
                  </div>
                </Checkbox>
                <Input
                  size="sm"
                  type="number"
                  defaultValue={String(opt.count)}
                  className="w-20"
                  variant="secondary"
                  aria-label={t('seed_generator.count_aria_label', { label: t(opt.labelKey) })}
                  onValueChange={(val) => handleCountChange(opt.key, val)}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-end mt-4">
            <Button
              startContent={!running ? <Play size={16} /> : undefined}
              onPress={handleRun}
              isLoading={running}
              isDisabled={selected.length === 0}
            >
              {t('seed_generator.generate_button')}
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

export default SeedGenerator;
