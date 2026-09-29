// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from '@/lib/motion';
import Accessibility from 'lucide-react/icons/accessibility';
import Info from 'lucide-react/icons/info';
import Plus from 'lucide-react/icons/plus';
import Save from 'lucide-react/icons/save';
import Trash2 from 'lucide-react/icons/trash-2';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Select, SelectItem } from '@/components/ui/Select';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

/* ---------- Types ---------- */

interface AccessibilityNeed {
  id?: number;
  need_type: 'mobility' | 'visual' | 'hearing' | 'cognitive' | 'dietary' | 'language' | 'other';
  description: string;
  accommodations_required: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
}

const NEED_TYPES = [
  'mobility',
  'visual',
  'hearing',
  'cognitive',
  'dietary',
  'language',
  'other',
] as const;

const NEED_TYPE_COLORS: Record<string, 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'default'> = {
  mobility: 'primary',
  visual: 'secondary',
  hearing: 'success',
  cognitive: 'warning',
  dietary: 'danger',
  language: 'default',
  other: 'default',
};

function emptyNeed(): AccessibilityNeed {
  return {
    need_type: 'other',
    description: '',
    accommodations_required: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
  };
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

/* ---------- Main Component ---------- */

export function AccessibilityTab() {
  const { t } = useTranslation('volunteering');
  const toast = useToast();
  const [needs, setNeeds] = useState<AccessibilityNeed[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const response = await api.get<AccessibilityNeed[]>('/v2/volunteering/accessibility-needs');
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setNeeds(response.data as AccessibilityNeed[]);
      } else {
        setError(tRef.current('accessibility.load_error'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load accessibility needs', err);
      setError(tRef.current('accessibility.load_error'));
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); return () => { abortRef.current?.abort(); }; }, [load]);

  const handleSave = async () => {
    // F-227: a member can hold one need per type (the server keeps one row per
    // type). Refuse a duplicate here, before anything is sent, so the member keeps
    // what they typed instead of being told it saved when it could not.
    const types = needs.map((n) => n.need_type);
    if (new Set(types).size !== types.length) {
      toastRef.current.error(tRef.current('accessibility.duplicate_type'));
      return;
    }

    try {
      setIsSaving(true);
      const response = await api.put('/v2/volunteering/accessibility-needs', { needs });
      if (response.success) {
        toastRef.current.success(tRef.current('accessibility.saved'));
        load();
      } else {
        toastRef.current.error(tRef.current('accessibility.save_error'));
      }
    } catch (err) {
      logError('Failed to save accessibility needs', err);
      toastRef.current.error(tRef.current('accessibility.save_error'));
    } finally {
      setIsSaving(false);
    }
  };

  const updateNeed = (index: number, field: keyof AccessibilityNeed, value: string) => {
    setNeeds((prev) => prev.map((n, i) => (i === index ? { ...n, [field]: value } : n)));
  };

  const removeNeed = (index: number) => {
    setNeeds((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Accessibility className="w-5 h-5 text-rose-400" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary">
            {t('accessibility.heading')}
          </h2>
        </div>
        <Button
          size="sm"
          className="bg-gradient-to-r from-rose-500 to-pink-600 text-white sm:shrink-0"
          startContent={<Save className="w-4 h-4" aria-hidden="true" />}
          onPress={handleSave}
          isLoading={isSaving}
          isDisabled={isLoading}
        >
          {t('accessibility.save')}
        </Button>
      </div>

      {/* Privacy notice — F-227: these needs are visible to the member only.
          No organisation or coordinator screen reads them, so the page must not
          suggest they are shared. */}
      <GlassCard className="p-4 border-l-4 border-rose-500">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm text-theme-muted">
            {t('accessibility.privacy_notice')}
          </p>
        </div>
      </GlassCard>

      {/* Error */}
      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={load}
          >
            {t('accessibility.try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Loading */}
      {!error && isLoading && (
        <div className="space-y-4" role="status" aria-busy="true" aria-label={t('common:loading')}>
          {[1, 2].map((i) => (
            <CardRowsSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Content */}
      {!error && !isLoading && (
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-4">
          {needs.length === 0 && (
            <EmptyState
              icon={<Accessibility className="w-12 h-12" aria-hidden="true" />}
              title={t('accessibility.no_needs_title')}
              description={t('accessibility.no_needs_desc_private')}
              action={
                <Button
                  className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
                  startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
                  onPress={() => setNeeds([emptyNeed()])}
                >
                  {t('accessibility.add_first')}
                </Button>
              }
            />
          )}

          {needs.map((need, index) => (
            <motion.div key={need.id ?? index} variants={itemVariants}>
              <GlassCard className="p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <Chip size="sm" color={NEED_TYPE_COLORS[need.need_type] ?? 'default'} variant="soft">
                    {t(`accessibility.types.${need.need_type}`)}
                  </Chip>
                  <Button
                    size="sm"
                    variant="danger-soft"
                    isIconOnly
                    aria-label={t('accessibility.remove')}
                    onPress={() => removeNeed(index)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>

                <Select
                  label={t('accessibility.need_type_label')}
                  selectedKeys={new Set([need.need_type])}
                  onSelectionChange={(keys) => {
                    const val = Array.from(keys)[0] as string;
                    if (val) updateNeed(index, 'need_type', val);
                  }}
                  classNames={{ trigger: 'bg-theme-elevated border-theme-default' }}
                >
                  {NEED_TYPES.map((type) => (
                    <SelectItem key={type} id={type}>{t(`accessibility.types.${type}`)}</SelectItem>
                  ))}
                </Select>

                <Textarea
                  label={t('accessibility.description_label')}
                  placeholder={t('accessibility.description_placeholder')}
                  value={need.description}
                  onChange={(e) => updateNeed(index, 'description', e.target.value)}
                  classNames={{ input: 'bg-transparent text-theme-primary', inputWrapper: 'bg-theme-elevated border-theme-default' }}
                />

                <Textarea
                  label={t('accessibility.accommodations_label')}
                  placeholder={t('accessibility.accommodations_placeholder')}
                  value={need.accommodations_required}
                  onChange={(e) => updateNeed(index, 'accommodations_required', e.target.value)}
                  classNames={{ input: 'bg-transparent text-theme-primary', inputWrapper: 'bg-theme-elevated border-theme-default' }}
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label={t('accessibility.emergency_name')}
                    value={need.emergency_contact_name}
                    onChange={(e) => updateNeed(index, 'emergency_contact_name', e.target.value)}
                    classNames={{ input: 'bg-transparent text-theme-primary', inputWrapper: 'bg-theme-elevated border-theme-default' }}
                  />
                  <Input
                    label={t('accessibility.emergency_phone')}
                    value={need.emergency_contact_phone}
                    onChange={(e) => updateNeed(index, 'emergency_contact_phone', e.target.value)}
                    classNames={{ input: 'bg-transparent text-theme-primary', inputWrapper: 'bg-theme-elevated border-theme-default' }}
                  />
                </div>
              </GlassCard>
            </motion.div>
          ))}

          {needs.length > 0 && (
            <Button
              variant="tertiary"
              className="w-full"
              startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
              onPress={() => setNeeds((prev) => [...prev, emptyNeed()])}
            >
              {t('accessibility.add_need')}
            </Button>
          )}
        </motion.div>
      )}
    </div>
  );
}

export default AccessibilityTab;
