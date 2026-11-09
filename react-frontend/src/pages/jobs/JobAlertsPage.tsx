// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Select, SelectItem } from '@/components/ui/Select';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { Switch } from '@/components/ui/Switch';
import { useDisclosure } from '@/components/ui/useDisclosure';
/**
 * Job Alerts Page (J6) - Manage job alert subscriptions
 *
 * Features:
 * - List active/paused alerts
 * - Create new alert with keyword, category, type, commitment, location filters
 * - Pause/resume and delete alerts
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';

import Bell from 'lucide-react/icons/bell';
import Plus from 'lucide-react/icons/plus';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Trash2 from 'lucide-react/icons/trash-2';
import Pause from 'lucide-react/icons/pause';
import Play from 'lucide-react/icons/play';
import MapPin from 'lucide-react/icons/map-pin';
import Tag from 'lucide-react/icons/tag';
import Briefcase from 'lucide-react/icons/briefcase';
import Wifi from 'lucide-react/icons/wifi';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';

interface JobAlert {
  id: number;
  user_id: number;
  tenant_id: number;
  keywords: string | null;
  categories: string | null;
  type: string | null;
  commitment: string | null;
  location: string | null;
  is_remote_only: boolean;
  is_active: boolean;
  last_notified_at: string | null;
  created_at: string;
}

const JOB_TYPES = ['paid', 'volunteer', 'timebank'] as const;
const COMMITMENT_TYPES = ['full_time', 'part_time', 'flexible', 'one_off'] as const;

export function JobAlertsPage() {
  const { t } = useTranslation('jobs');
  usePageTitle(t('alerts.title'));
  const { tenantPath } = useTenant();
  const toast = useToast();
  const createModal = useDisclosure();

  const [alerts, setAlerts] = useState<JobAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // Create form state
  const [keywords, setKeywords] = useState('');
  const [categories, setCategories] = useState('');
  const [alertType, setAlertType] = useState('');
  const [alertCommitment, setAlertCommitment] = useState('');
  const [alertLocation, setAlertLocation] = useState('');
  const [isRemoteOnly, setIsRemoteOnly] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  const loadAlerts = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<JobAlert[]>('/v2/jobs/alerts');
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setAlerts(response.data);
      } else {
        setError(tRef.current('alerts.load_error'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load job alerts', err);
      setError(tRef.current('alerts.load_error'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  const handleCreate = async () => {
    setIsCreating(true);
    try {
      const payload: Record<string, unknown> = {};
      if (keywords.trim()) payload.keywords = keywords.trim();
      if (categories.trim()) payload.categories = categories.trim();
      if (alertType) payload.type = alertType;
      if (alertCommitment) payload.commitment = alertCommitment;
      if (alertLocation.trim()) payload.location = alertLocation.trim();
      if (isRemoteOnly) payload.is_remote_only = true;

      const response = await api.post('/v2/jobs/alerts', payload);
      if (response.success) {
        toastRef.current.success(tRef.current('alerts.create_success'));
        createModal.onClose();
        resetForm();
        loadAlerts();
      } else {
        toastRef.current.error(tRef.current('alerts.create_error'));
      }
    } catch (err) {
      logError('Failed to create alert', err);
      toastRef.current.error(tRef.current('alerts.create_error'));
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    try {
      const response = await api.delete(`/v2/jobs/alerts/${deleteTarget}`);
      if (response.success) {
        toastRef.current.success(tRef.current('alerts.delete_success'));
        setAlerts((prev) => prev.filter((a) => a.id !== deleteTarget));
      } else {
        toastRef.current.error(tRef.current('alerts.delete_error'));
      }
    } catch (err) {
      logError('Failed to delete alert', err);
      toastRef.current.error(tRef.current('alerts.delete_error'));
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleTogglePause = async (alertId: number, isActive: boolean) => {
    try {
      const response = isActive
        ? await api.put(`/v2/jobs/alerts/${alertId}/unsubscribe`, {})
        : await api.put(`/v2/jobs/alerts/${alertId}/resubscribe`, {});
      if (!response.success) {
        toastRef.current.error(tRef.current('alerts.toggle_error'));
        return;
      }
      toastRef.current.success(
        tRef.current(isActive ? 'alerts.unsubscribe_success' : 'alerts.resubscribe_success')
      );
      loadAlerts();
    } catch (err) {
      logError('Failed to toggle alert', err);
      toastRef.current.error(tRef.current('alerts.toggle_error'));
    }
  };

  const resetForm = () => {
    setKeywords('');
    setCategories('');
    setAlertType('');
    setAlertCommitment('');
    setAlertLocation('');
    setIsRemoteOnly(false);
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <PageMeta title={t('page_meta.alerts.title')} noIndex />
      {/* Back nav */}
      <Link
        to={tenantPath('/jobs')}
        className="inline-flex items-center gap-2 text-theme-muted hover:text-theme-primary transition-colors"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        {t('title')}
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-theme-primary flex items-center gap-3">
            <Bell className="w-7 h-7 text-blue-400" aria-hidden="true" />
            {t('alerts.title')}
          </h1>
          <p className="text-theme-muted mt-1">{t('alerts.subtitle')}</p>
        </div>
        <Button
          className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
          startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
          onPress={createModal.onOpen}
        >
          {t('alerts.create')}
        </Button>
      </div>

      {/* Error State */}
      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('alerts.load_error')}</h2>
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={loadAlerts}
          >
            {t('alerts.retry')}
          </Button>
        </GlassCard>
      )}

      {/* Alerts List */}
      {isLoading ? (
        <div className="space-y-4" role="status" aria-busy="true" aria-label={t('common:loading')}>
          {[1, 2].map((i) => (
            <CardRowsSkeleton key={i} />
          ))}
        </div>
      ) : !error && alerts.length === 0 ? (
        <EmptyState
          icon={<Bell className="w-12 h-12" aria-hidden="true" />}
          title={t('alerts.empty_title')}
          description={t('alerts.empty_description')}
          action={
            <Button
              className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
              startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
              onPress={createModal.onOpen}
            >
              {t('alerts.create')}
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {alerts.map((alert) => (
            <motion.div
              key={alert.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <GlassCard className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <Chip
                        size="sm"
                        variant="tertiary"
                        color={alert.is_active ? 'success' : 'default'}
                      >
                        {alert.is_active ? t('alerts.active') : t('alerts.paused')}
                      </Chip>
                      {alert.type && (
                        <Chip size="sm" variant="tertiary" color="accent">
                          {t(`type.${alert.type}`)}
                        </Chip>
                      )}
                      {alert.commitment && (
                        <Chip size="sm" variant="tertiary" color="default">
                          {t(`commitment.${alert.commitment}`)}
                        </Chip>
                      )}
                      {alert.is_remote_only && (
                        <Chip size="sm" variant="tertiary" color="default">
                          <Wifi className="w-3 h-3" aria-hidden="true" />
                          {t('remote')}
                        </Chip>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-3 text-sm text-theme-muted">
                      {alert.keywords && (
                        <span className="flex items-center gap-1">
                          <Tag className="w-3.5 h-3.5" aria-hidden="true" />
                          {alert.keywords}
                        </span>
                      )}
                      {alert.categories && (
                        <span className="flex items-center gap-1">
                          <Briefcase className="w-3.5 h-3.5" aria-hidden="true" />
                          {alert.categories}
                        </span>
                      )}
                      {alert.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                          {alert.location}
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-theme-subtle mt-2">
                      {t('alerts.created_date', { date: new Date(alert.created_at).toLocaleDateString(getFormattingLocale()) })}
                      {' '}&middot;{' '}
                      {t('alerts.last_notified', { date: alert.last_notified_at ? new Date(alert.last_notified_at).toLocaleDateString(getFormattingLocale()) : t('alerts.never') })}
                    </p>
                  </div>

                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="flat"
                      isIconOnly
                      className="text-theme-muted"
                      onPress={() => handleTogglePause(alert.id, alert.is_active)}
                      aria-label={alert.is_active ? t('alerts.pause') : t('alerts.resume')}
                    >
                      {alert.is_active ? (
                        <Pause className="w-4 h-4" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="flat"
                      isIconOnly
                      color="danger"
                      onPress={() => setDeleteTarget(alert.id)}
                      aria-label={t('alerts.delete')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      )}

      {/* Create Alert Modal */}
      <Modal isOpen={createModal.isOpen} onOpenChange={createModal.onOpenChange} size="lg">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>
                <ModalHeading className="flex items-center gap-2">
                  <Bell className="w-5 h-5 text-accent" aria-hidden="true" />
                  {t('alerts.create')}
                </ModalHeading>
              </ModalHeader>
              <ModalBody>
                <div className="space-y-4">
                  <Input
                    label={t('alerts.keywords_label')}
                    placeholder={t('alerts.keywords_placeholder')}
                    value={keywords}
                    onChange={(e) => setKeywords(e.target.value)}
                    description={t('alerts.keywords_description')}
                    classNames={{
                      input: 'bg-transparent text-theme-primary',
                      inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                    }}
                  />

                  <Input
                    label={t('alerts.categories_label')}
                    placeholder={t('alerts.categories_placeholder')}
                    value={categories}
                    onChange={(e) => setCategories(e.target.value)}
                    classNames={{
                      input: 'bg-transparent text-theme-primary',
                      inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                    }}
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Select
                      label={t('alerts.type_label')}
                      selectedKeys={alertType ? [alertType] : []}
                      onChange={(e) => setAlertType(e.target.value)}
                      placeholder={t('alerts.any')}
                      classNames={{
                        trigger: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                        value: 'text-theme-primary',
                      }}
                    >
                      {JOB_TYPES.map((type) => (
                        <SelectItem key={type} id={type}>{t(`type.${type}`)}</SelectItem>
                      ))}
                    </Select>

                    <Select
                      label={t('alerts.commitment_label')}
                      selectedKeys={alertCommitment ? [alertCommitment] : []}
                      onChange={(e) => setAlertCommitment(e.target.value)}
                      placeholder={t('alerts.any')}
                      classNames={{
                        trigger: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                        value: 'text-theme-primary',
                      }}
                    >
                      {COMMITMENT_TYPES.map((type) => (
                        <SelectItem key={type} id={type}>{t(`commitment.${type}`)}</SelectItem>
                      ))}
                    </Select>
                  </div>

                  <Input
                    label={t('alerts.location_label')}
                    placeholder={t('alerts.location_placeholder')}
                    value={alertLocation}
                    onChange={(e) => setAlertLocation(e.target.value)}
                    classNames={{
                      input: 'bg-transparent text-theme-primary',
                      inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                    }}
                  />

                  <Switch
                    isSelected={isRemoteOnly}
                    onValueChange={setIsRemoteOnly}
                    classNames={{ label: 'text-theme-primary text-sm' }}
                  >
                    <div>
                      <p className="text-sm text-theme-primary">{t('alerts.remote_only')}</p>
                    </div>
                  </Switch>
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={onClose}>
                  {t('apply.cancel')}
                </Button>
                <Button
                  className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
                  onPress={handleCreate}
                  isLoading={isCreating}
                >
                  {t('alerts.create')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="text-theme-primary">{t('alerts.delete')}</ModalHeader>
              <ModalBody>
                <p className="text-theme-secondary">
                  {t('alerts.delete_confirm')}
                </p>
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={onClose}>{t('apply.cancel')}</Button>
                <Button color="danger" onPress={handleDelete}>{t('alerts.delete')}</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

export default JobAlertsPage;
