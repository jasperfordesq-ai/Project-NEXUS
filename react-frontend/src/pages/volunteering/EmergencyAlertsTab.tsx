// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * EmergencyAlertsTab - View and respond to urgent shift-fill requests (V9)
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from '@/lib/motion';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Bell from 'lucide-react/icons/bell';
import Calendar from 'lucide-react/icons/calendar';
import Clock from 'lucide-react/icons/clock';
import MapPin from 'lucide-react/icons/map-pin';
import Building2 from 'lucide-react/icons/building-2';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { EmptyState } from '@/components/feedback';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { useToast } from '@/contexts';

interface EmergencyAlert {
  id: number;
  priority: 'normal' | 'urgent' | 'critical';
  message: string;
  my_response: 'pending' | 'accepted' | 'declined';
  required_skills: string[];
  shift: {
    id: number;
    start_time: string;
    end_time: string;
  };
  opportunity: {
    title: string;
    location: string;
  };
  organization: {
    name: string;
  };
  coordinator: {
    name: string;
  };
  expires_at: string;
  created_at: string;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export function EmergencyAlertsTab() {
  const { t } = useTranslation('volunteering');
  const toast = useToast();
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [respondingTo, setRespondingTo] = useState<{ id: number; action: 'accepted' | 'declined' } | null>(null);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);

      const response = await api.get<{ alerts?: EmergencyAlert[] }>(
        '/v2/volunteering/emergency-alerts'
      );

      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        const payload = response.data as { alerts?: EmergencyAlert[] } | EmergencyAlert[];
        setAlerts(Array.isArray(payload) ? payload : Array.isArray(payload.alerts) ? payload.alerts : []);
      } else {
        setError(tRef.current('emergency.error_load'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load emergency alerts', err);
      setError(tRef.current('emergency.error_load_generic'));
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  const handleRespond = async (alertId: number, response: 'accepted' | 'declined') => {
    try {
      setRespondingTo({ id: alertId, action: response });
      const result = await api.put(`/v2/volunteering/emergency-alerts/${alertId}`, { response });
      if (result.success) {
        toastRef.current.success(response === 'accepted' ? tRef.current('emergency.alert_accepted') : tRef.current('emergency.alert_declined'));
        load();
      } else {
        toastRef.current.error(result.error || tRef.current('emergency.respond_error'));
      }
    } catch (err) {
      logError('Failed to respond to alert', err);
      toastRef.current.error(tRef.current('emergency.respond_error_generic'));
    } finally {
      setRespondingTo(null);
    }
  };

  const priorityConfig = {
    critical: { color: 'danger' as const, label: t('emergency.priority_critical'), bgClass: 'border-red-500/30 bg-red-500/5' },
    urgent: { color: 'warning' as const, label: t('emergency.priority_urgent'), bgClass: 'border-amber-500/30 bg-amber-500/5' },
    normal: { color: 'primary' as const, label: t('emergency.priority_normal'), bgClass: '' },
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {alerts.filter(a => a.my_response === 'pending').length > 0 && (
            <Chip size="sm" color="danger" variant="soft">
              {t('emergency.pending_count', { count: alerts.filter(a => a.my_response === 'pending').length })}
            </Chip>
          )}
        </div>
        <Button
          size="sm"
          variant="tertiary"
          startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
          onPress={load}
          isLoading={isLoading}
        >
          {t('common.refresh')}
        </Button>
      </div>

      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <p className="text-theme-muted mb-4">{error}</p>
          <Button className="bg-gradient-to-r from-rose-500 to-pink-600 text-white" onPress={load}>
            {t('common.try_again')}
          </Button>
        </GlassCard>
      )}

      {!error && isLoading && (
        <div className="space-y-4" role="status" aria-busy="true" aria-label={t('common:loading')}>
          {[1, 2].map((i) => (
            <CardRowsSkeleton key={i} />
          ))}
        </div>
      )}

      {!error && !isLoading && alerts.length === 0 && (
        <EmptyState
          icon={<Bell className="w-12 h-12" aria-hidden="true" />}
          title={t('emergency.empty_title')}
          description={t('emergency.empty_description')}
        />
      )}

      {!error && !isLoading && alerts.length > 0 && (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-4"
        >
          {alerts.map((alert) => {
            // Fall back to 'normal' if the backend ever sends an unknown priority,
            // otherwise the undefined lookup would throw and blank the tab.
            const config = priorityConfig[alert.priority] ?? priorityConfig.normal;
            return (
              <motion.div key={alert.id} variants={itemVariants}>
                <GlassCard className={`p-5 border ${config.bgClass}`}>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <Chip size="sm" color={config.color} variant="soft">
                          {config.label}
                        </Chip>
                        <h3 className="font-semibold text-theme-primary">{alert.opportunity.title}</h3>
                      </div>

                      <p className="text-sm text-theme-muted mb-3">{alert.message}</p>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-theme-subtle mb-2">
                        <span className="flex items-center gap-1">
                          <Building2 className="w-3 h-3" aria-hidden="true" />
                          {alert.organization.name}
                        </span>
                        {alert.opportunity.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3" aria-hidden="true" />
                            {alert.opportunity.location}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" aria-hidden="true" />
                          {new Date(alert.shift.start_time).toLocaleDateString(getFormattingLocale())}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" aria-hidden="true" />
                          {new Date(alert.shift.start_time).toLocaleTimeString(getFormattingLocale(), { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      {alert.required_skills.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {alert.required_skills.map((skill) => (
                            <Chip key={skill} size="sm" variant="soft" className="text-xs">
                              {skill}
                            </Chip>
                          ))}
                        </div>
                      )}

                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-theme-subtle">
                        <span>{t('emergency.from')} {alert.coordinator.name}</span>
                        <span>{t('emergency.expires')} {new Date(alert.expires_at).toLocaleString(getFormattingLocale())}</span>
                      </div>
                    </div>

                    {alert.my_response === 'pending' && (
                      <div className="flex flex-col gap-2 sm:flex-shrink-0">
                        <Button
                          size="sm"
                          className="bg-gradient-to-r from-emerald-500 to-green-600 text-white"
                          startContent={<CheckCircle className="w-4 h-4" aria-hidden="true" />}
                          onPress={() => handleRespond(alert.id, 'accepted')}
                          isLoading={respondingTo?.id === alert.id && respondingTo?.action === 'accepted'}
                          isDisabled={respondingTo?.id === alert.id}
                        >
                          {t('emergency.accept')}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger-soft"
                          startContent={<XCircle className="w-4 h-4" aria-hidden="true" />}
                          onPress={() => handleRespond(alert.id, 'declined')}
                          isLoading={respondingTo?.id === alert.id && respondingTo?.action === 'declined'}
                          isDisabled={respondingTo?.id === alert.id}
                        >
                          {t('emergency.decline')}
                        </Button>
                      </div>
                    )}

                    {alert.my_response !== 'pending' && (
                      <Chip
                        size="sm"
                        color={alert.my_response === 'accepted' ? 'success' : 'danger'}
                        variant="soft"
                      >
                        {alert.my_response === 'accepted' ? t('emergency.accepted') : t('emergency.declined')}
                      </Chip>
                    )}
                  </div>
                </GlassCard>
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </div>
  );
}

export default EmergencyAlertsTab;
