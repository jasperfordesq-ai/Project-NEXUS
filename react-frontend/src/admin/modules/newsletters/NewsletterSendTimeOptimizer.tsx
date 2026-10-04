import { Button, Card, CardBody, CardHeader, Chip, Select, SelectItem } from '@/components/ui';
import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Clock from 'lucide-react/icons/clock';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import TrendingUp from 'lucide-react/icons/trending-up';
import { usePageTitle } from '@/hooks';
import { adminNewsletters } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import type { SendTimeData } from '../../api/types';
import { getFormattingLocale } from '@/lib/helpers';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Newsletter Send-Time Optimizer
 * Heatmap visualization of optimal send times based on engagement data
 */



const formatHour = (hour: number) => {
  return new Intl.DateTimeFormat(getFormattingLocale(), {
    hour: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2000, 0, 1, hour)));
};

export function NewsletterSendTimeOptimizer() {
  const { t } = useTranslation('admin_newsletters');
  usePageTitle(t('newsletters.page_title'));
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SendTimeData | null>(null);
  const [days, setDays] = useState(30);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminNewsletters.getSendTimeData({ days });
      if (res.success && res.data) {
        setData(res.data as SendTimeData);
      }
    } catch {
      setData(null);
    }
    setLoading(false);
  }, [days]);

  useEffect(() => { loadData(); }, [loadData]);

  const dayNames = [
    t('newsletter_send_time.day_sunday'),
    t('newsletter_send_time.day_monday'),
    t('newsletter_send_time.day_tuesday'),
    t('newsletter_send_time.day_wednesday'),
    t('newsletter_send_time.day_thursday'),
    t('newsletter_send_time.day_friday'),
    t('newsletter_send_time.day_saturday'),
  ];
  const hours = Array.from({ length: 24 }, (_, i) => i);

  // Build heatmap matrix
  const heatmapMatrix: Record<number, Record<number, number>> = {};
  for (let d = 1; d <= 7; d++) {
    heatmapMatrix[d] = {};
    for (let h = 0; h < 24; h++) {
      const row = heatmapMatrix[d];
      if (row) row[h] = 0;
    }
  }

  if (data?.heatmap) {
    data.heatmap.forEach(cell => {
      heatmapMatrix[cell.day_of_week] = heatmapMatrix[cell.day_of_week] || {};
      const row = heatmapMatrix[cell.day_of_week];
      if (row) row[cell.hour] = cell.engagement_score;
    });
  }

  const maxScore = data?.heatmap
    ? Math.max(...data.heatmap.map(c => c.engagement_score), 1)
    : 1;

  const getHeatCellClass = (score: number) => {
    if (score === 0) {
      return 'border-border bg-surface-secondary text-foreground dark:border-border dark:bg-surface-secondary dark:text-foreground';
    }

    const intensity = Math.min(score / maxScore, 1);
    if (intensity > 0.7) return 'border-success bg-success text-success-foreground';
    if (intensity > 0.4) return 'border-success/60 bg-success/40 text-foreground';
    if (intensity > 0.2) return 'border-success/40 bg-success/25 text-foreground';
    return 'border-success/30 bg-success/10 text-foreground';
  };

  return (
    <div>
      <PageHeader
        title={t('newsletter_send_time.title')}
        description={t('newsletter_send_time.description')}
        actions={
          <div className="flex gap-2">
            <Select
              label={t('newsletter_send_time.time_period')}
              selectedKeys={[String(days)]}
              onSelectionChange={(keys) => setDays(Number(Array.from(keys)[0]))}
              className="w-32"
              size="sm"
            >
              <SelectItem key="7" id="7">{t('newsletter_send_time.days', { count: 7 })}</SelectItem>
              <SelectItem key="30" id="30">{t('newsletter_send_time.days', { count: 30 })}</SelectItem>
              <SelectItem key="60" id="60">{t('newsletter_send_time.days', { count: 60 })}</SelectItem>
              <SelectItem key="90" id="90">{t('newsletter_send_time.days', { count: 90 })}</SelectItem>
            </Select>
            <Button
              variant="tertiary"
              startContent={<RefreshCw size={16} />}
              onPress={loadData}
              isLoading={loading}
            >
              {t('newsletters.refresh')}
            </Button>
          </div>
        }
      />

      <div className="grid gap-6">
        {/* Recommendations */}
        {data?.recommendations && data.recommendations.length > 0 && (
          <Card>
            <CardHeader className="flex gap-2 items-center">
              <TrendingUp size={20} className="text-success" />
              <span>{t('newsletter_send_time.top_recommended')}</span>
            </CardHeader>
            <CardBody>
              <div className="grid gap-3 md:grid-cols-3">
                {data.recommendations.map((rec, idx) => (
                  <div
                    key={`${rec.day_of_week}-${rec.hour}`}
                    className="rounded-xl border border-success/30 bg-success/10 p-4 shadow-sm"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Chip size="sm" color="success" variant="soft">
                          #{idx + 1}
                        </Chip>
                        <span className="text-sm font-medium">{rec.description}</span>
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-success">{rec.score}</span>
                        <span className="text-sm text-muted">{t('newsletter_send_time.engagements')}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>
        )}

        {/* Heatmap */}
        <Card>
          <CardHeader className="flex gap-2 items-center">
            <Clock size={20} />
            <span>{t('newsletter_send_time.engagement_heatmap')}</span>
          </CardHeader>
          <CardBody>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-muted">{t('newsletter_send_time.loading_heatmap')}</div>
              </div>
            ) : data && data.heatmap.length > 0 ? (
              <div className="overflow-x-auto">
                <div className="inline-block min-w-full">
                  <div
                    className="grid grid-cols-[auto_repeat(24,minmax(0,1fr))] gap-1"
                    role="grid"
                    aria-label={t('newsletter_send_time.engagement_heatmap')}
                  >
                    {/* Header row - hours */}
                    <div></div>
                    {hours.map(h => (
                      <div key={h} role="columnheader" className="text-center text-xs text-muted font-medium py-1">
                        {formatHour(h)}
                      </div>
                    ))}

                    {/* Data rows - days */}
                    {[1, 2, 3, 4, 5, 6, 7].map(day => (
                      <div key={day} role="row" className="contents">
                        <div role="rowheader" className="flex items-center justify-end pr-2 text-sm font-medium text-muted">
                          {dayNames[day - 1]}
                        </div>
                        {hours.map(hour => {
                          const score = heatmapMatrix[day]?.[hour] || 0;
                          const cellLabel = t('newsletter_send_time.heatmap_cell_title', {
                            day: dayNames[day - 1],
                            hour: formatHour(hour),
                            count: score,
                          });
                          return (
                            <div
                              key={`${day}-${hour}`}
                              role="gridcell"
                              tabIndex={0}
                              aria-label={cellLabel}
                              className={`flex aspect-square cursor-pointer items-center justify-center rounded border text-xs font-bold transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${getHeatCellClass(score)}`}
                              title={cellLabel}
                            >
                              {score > 0 && <span>{score}</span>}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>

                  {/* Legend */}
                  <div className="flex items-center gap-2 mt-6 justify-center">
                    <span className="text-sm text-muted">{t('newsletter_send_time.low')}</span>
                    <div className="flex gap-1">
                      <div className="w-4 h-4 rounded border border-border bg-surface-secondary dark:border-border dark:bg-surface-secondary"></div>
                      <div className="w-4 h-4 rounded border border-success/30 bg-success/10"></div>
                      <div className="w-4 h-4 rounded border border-success/40 bg-success/25"></div>
                      <div className="w-4 h-4 rounded border border-success/60 bg-success/40"></div>
                      <div className="w-4 h-4 rounded border border-success bg-success"></div>
                    </div>
                    <span className="text-sm text-muted">{t('newsletter_send_time.high')}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-12 text-muted">
                <Clock size={40} />
                <p>{data?.insights || t('newsletter_send_time.not_enough_data')}</p>
                <p className="text-xs">{t('newsletter_send_time.empty_hint')}</p>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Insights */}
        {data?.insights && (
          <Card className="bg-accent-soft dark:bg-accent-soft">
            <CardBody className="flex-row items-center gap-3">
              <TrendingUp size={20} className="text-accent" />
              <p className="text-sm text-accent dark:text-accent">
                {data.insights}
              </p>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

export default NewsletterSendTimeOptimizer;
