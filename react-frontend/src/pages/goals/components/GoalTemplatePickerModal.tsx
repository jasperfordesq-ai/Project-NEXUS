// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
/**
 * G1 - Goal Template Picker Modal
 *
 * Displays available goal templates organized by category.
 * Users can select a template to pre-fill the goal creation form.
 *
 * API: GET /api/v2/goals/templates
 *      GET /api/v2/goals/templates/categories
 *      POST /api/v2/goals/from-template/{templateId}
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from '@/lib/motion';

import FileText from 'lucide-react/icons/file-text';
import Target from 'lucide-react/icons/target';
import Sparkles from 'lucide-react/icons/sparkles';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import ChevronRight from 'lucide-react/icons/chevron-right';
import Layers from 'lucide-react/icons/layers';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

import { useTranslation } from 'react-i18next';
/* ───────────────────────── Types ───────────────────────── */

interface GoalTemplate {
  id: number;
  title: string;
  description: string;
  target_value: number;
  category: string;
  is_public: boolean;
  duration_days: number | null;
}

interface GoalTemplatePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTemplateSelected: () => void;
}

/* ───────────────────────── Category Colors ───────────────────────── */

const categoryColors: Record<string, string> = {
  health: 'from-emerald-500 to-green-600',
  fitness: 'from-orange-500 to-red-500',
  learning: 'from-blue-500 to-accent-gradient-end',
  social: 'from-accent to-pink-500',
  community: 'from-amber-500 to-orange-600',
  financial: 'from-yellow-500 to-amber-600',
  personal: 'from-accent to-accent-gradient-end',
  default: 'from-gray-500 to-gray-600',
};

function getCategoryGradient(category: string): string {
  return categoryColors[category.toLowerCase()] ?? categoryColors.default ?? 'from-gray-500 to-gray-600';
}

/* ───────────────────────── Component ───────────────────────── */

export function GoalTemplatePickerModal({
  isOpen,
  onClose,
  onTemplateSelected,
}: GoalTemplatePickerModalProps) {
  const toast = useToast();
  const { t } = useTranslation('goals');
  const [templates, setTemplates] = useState<GoalTemplate[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creatingFromId, setCreatingFromId] = useState<number | null>(null);

  const loadTemplates = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [templatesRes, categoriesRes] = await Promise.all([
        api.get<GoalTemplate[]>('/v2/goals/templates'),
        api.get<string[]>('/v2/goals/templates/categories'),
      ]);

      if (templatesRes.success && templatesRes.data) {
        setTemplates(Array.isArray(templatesRes.data) ? templatesRes.data : []);
      }
      if (categoriesRes.success && categoriesRes.data) {
        setCategories(Array.isArray(categoriesRes.data) ? categoriesRes.data : []);
      }
    } catch (err) {
      logError('Failed to load goal templates', err);
      setError(t('template_picker.load_error'));
    } finally {
      setIsLoading(false);
    }
  }, [t])

  useEffect(() => {
    if (isOpen) {
      loadTemplates();
    }
  }, [isOpen, loadTemplates]);

  const filteredTemplates = selectedCategory
    ? templates.filter((t) => t.category === selectedCategory)
    : templates;

  const handleUseTemplate = async (template: GoalTemplate) => {
    try {
      setCreatingFromId(template.id);
      const response = await api.post(`/v2/goals/from-template/${template.id}`, {});

      if (response.success) {
        toast.success(t('template_created'));
        onTemplateSelected();
        onClose();
      } else {
        toast.error(t('template_create_failed'));
      }
    } catch (err) {
      logError('Failed to create goal from template', err);
      toast.error(t('template_create_failed'));
    } finally {
      setCreatingFromId(null);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="3xl"
      scrollBehavior="inside"
      placement="top-center"
      classNames={{
        backdrop: 'z-[9998]',
        wrapper: 'z-[9999] items-start px-3 py-4 pt-[calc(env(safe-area-inset-top)_+_7rem)] sm:px-4 sm:pt-[calc(env(safe-area-inset-top)_+_8rem)]',
        base: 'z-[10000] bg-overlay border border-theme-default my-0 max-h-[calc(100dvh_-_env(safe-area-inset-top)_-_8rem)] sm:max-h-[calc(100dvh_-_env(safe-area-inset-top)_-_9rem)]',
        body: 'overflow-y-auto',
      }}
    >
      <ModalContent>
        <ModalHeader className="flex items-center gap-2 text-theme-primary">
          <FileText className="w-5 h-5 text-emerald-400" aria-hidden="true" />
          {t('template.title')}
        </ModalHeader>
        <ModalBody>
          {isLoading ? (
            <div role="status" aria-busy="true" aria-label={t('insights.loading')} className="flex items-center justify-center py-12">
              <Spinner size="lg" color="primary" />
            </div>
          ) : error ? (
            <div role="alert" className="text-center py-8">
              <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
              <p className="text-theme-muted mb-4">{error}</p>
              <Button
                variant="flat"
                className="bg-theme-elevated text-theme-primary"
                startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
                onPress={loadTemplates}
              >
                {t('template_picker.try_again')}
              </Button>
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-8">
              <Layers className="w-12 h-12 text-theme-subtle mx-auto mb-3" aria-hidden="true" />
              <p className="text-theme-muted">{t('template_picker.none_available')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Category filter */}
              {categories.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant={!selectedCategory ? 'solid' : 'flat'}
                    className={!selectedCategory
                      ? 'bg-gradient-to-r from-accent to-accent-gradient-end text-white'
                      : 'bg-theme-elevated text-theme-muted'}
                    onPress={() => setSelectedCategory(null)}
                  >
                    {t('template.all_categories')}
                  </Button>
                  {categories.map((cat) => (
                    <Button
                      key={cat}
                      size="sm"
                      variant={selectedCategory === cat ? 'solid' : 'flat'}
                      className={selectedCategory === cat
                        ? `bg-gradient-to-r ${getCategoryGradient(cat)} text-white`
                        : 'bg-theme-elevated text-theme-muted'}
                      onPress={() => setSelectedCategory(cat)}
                    >
                      {cat}
                    </Button>
                  ))}
                </div>
              )}

              {/* Templates grid */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={selectedCategory || 'all'}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="grid grid-cols-1 sm:grid-cols-2 gap-3"
                >
                  {filteredTemplates.map((template) => (
                    <GlassCard
                      key={template.id}
                      hoverable
                      className="p-4 cursor-pointer group"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <div className={`w-2 h-2 rounded-full bg-gradient-to-r ${getCategoryGradient(template.category)} flex-shrink-0`} />
                            <h4 className="text-sm font-semibold text-theme-primary truncate">
                              {template.title}
                            </h4>
                          </div>
                          <p className="text-xs text-theme-muted line-clamp-2 mb-2">
                            {template.description}
                          </p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Chip
                              size="sm"
                              variant="flat"
                              className="text-[10px] bg-theme-elevated text-theme-subtle"
                            >
                              <Target className="w-3 h-3" aria-hidden="true" />
                              {t('template.target_label', { value: template.target_value })}
                            </Chip>
                            {template.category && (
                              <Chip
                                size="sm"
                                variant="flat"
                                className="text-[10px] bg-theme-elevated text-theme-subtle"
                              >
                                {template.category}
                              </Chip>
                            )}
                            {template.duration_days && (
                              <Chip
                                size="sm"
                                variant="flat"
                                className="text-[10px] bg-theme-elevated text-theme-subtle"
                              >
                                {t('template.duration_days', { days: template.duration_days })}
                              </Chip>
                            )}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          isIconOnly
                          className="size-11 min-h-11 min-w-11 p-0 bg-gradient-to-r from-accent to-accent-gradient-end text-white opacity-80 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                          onPress={() => handleUseTemplate(template)}
                          isLoading={creatingFromId === template.id}
                          isDisabled={creatingFromId !== null}
                          aria-label={t('template.use_template_aria', { title: template.title })}
                        >
                          <ChevronRight className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </GlassCard>
                  ))}
                </motion.div>
              </AnimatePresence>

              {filteredTemplates.length === 0 && (
                <div className="text-center py-6">
                  <Sparkles className="w-8 h-8 text-theme-subtle mx-auto mb-2" aria-hidden="true" />
                  <p className="text-sm text-theme-muted">{t('template_picker.none_in_category')}</p>
                </div>
              )}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose} className="text-theme-muted">
            {t('template.cancel')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default GoalTemplatePickerModal;
