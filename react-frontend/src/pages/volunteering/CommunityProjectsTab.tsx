// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CommunityProjectsTab - Browse and propose community volunteer projects
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from '@/lib/motion';

import Heart from 'lucide-react/icons/heart';
import Plus from 'lucide-react/icons/plus';
import MapPin from 'lucide-react/icons/map-pin';
import Calendar from 'lucide-react/icons/calendar';
import User from 'lucide-react/icons/user';
import Users from 'lucide-react/icons/users';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Lightbulb from 'lucide-react/icons/lightbulb';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { Textarea } from '@/components/ui/Textarea';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { EmptyState } from '@/components/feedback';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

/* ─────────────────────────── Types ─────────────────────────── */
interface Project {
  id: number;
  title: string;
  description: string;
  category: string | null;
  location: string | null;
  target_volunteers: number | null;
  proposed_date: string | null;
  status: 'proposed' | 'under_review' | 'approved' | 'rejected' | 'active' | 'completed' | 'cancelled';
  supporter_count: number;
  has_supported: boolean;
  proposer_name: string;
  created_at: string;
}

type StatusColor = 'default' | 'warning' | 'success' | 'danger' | 'primary';
const STATUS_COLORS: Record<Project['status'], StatusColor> = {
  proposed: 'default',
  under_review: 'warning',
  approved: 'success',
  rejected: 'danger',
  active: 'primary',
  completed: 'success',
  cancelled: 'default',
};

/* ─────────────────────────── Component ─────────────────────────── */
export function CommunityProjectsTab() {
  const { t } = useTranslation('volunteering');
  const toast = useToast();
  const { isOpen, onOpen, onOpenChange } = useDisclosure();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: '',
    location: '',
    target_volunteers: '',
    proposed_date: '',
  });
  const tRef = useRef(t);
  tRef.current = t;
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);
      const res = await api.get<{ items: Project[]; cursor?: string; has_more: boolean }>(
        '/v2/volunteering/community-projects',
      );
      if (controller.signal.aborted) return;
      if (res.success && res.data) {
        const raw = res.data as Record<string, unknown>;
        const items = Array.isArray(raw.items)
          ? (raw.items as Project[])
          : Array.isArray(res.data)
            ? (res.data as unknown as Project[])
            : [];
        setProjects(items);
      } else {
        setError(tRef.current('community_projects.load_error'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load community projects', err);
      setError(tRef.current('community_projects.load_error'));
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    loadRef.current();
    return () => { abortRef.current?.abort(); };
  }, []);

  const toggleSupport = async (project: Project) => {
    const previousState = { has_supported: project.has_supported, supporter_count: project.supporter_count };
    try {
      setTogglingId(project.id);
      // Optimistic update
      setProjects((prev) =>
        prev.map((p) =>
          p.id === project.id
            ? project.has_supported
              ? { ...p, has_supported: false, supporter_count: p.supporter_count - 1 }
              : { ...p, has_supported: true, supporter_count: p.supporter_count + 1 }
            : p,
        ),
      );

      const response = project.has_supported
        ? await api.delete(`/v2/volunteering/community-projects/${project.id}/support`)
        : await api.post(`/v2/volunteering/community-projects/${project.id}/support`, {});

      if (!response.success) {
        // Revert optimistic update
        setProjects((prev) =>
          prev.map((p) =>
            p.id === project.id
              ? { ...p, has_supported: previousState.has_supported, supporter_count: previousState.supporter_count }
              : p,
          ),
        );
        toast.error(t('community_projects.support_failed'));
      }
    } catch (err) {
      logError('Failed to toggle project support', err);
      // Revert optimistic update
      setProjects((prev) =>
        prev.map((p) =>
          p.id === project.id
            ? { ...p, has_supported: previousState.has_supported, supporter_count: previousState.supporter_count }
            : p,
        ),
      );
      toast.error(t('community_projects.support_failed'));
    } finally {
      setTogglingId(null);
    }
  };

  const handleSubmit = async (onClose: () => void) => {
    if (!form.title.trim() || !form.description.trim()) {
      toast.error(t('community_projects.title_required'));
      return;
    }
    try {
      setIsSubmitting(true);
      const payload: Record<string, unknown> = {
        title: form.title.trim(),
        description: form.description.trim(),
      };
      if (form.category.trim()) payload.category = form.category.trim();
      if (form.location.trim()) payload.location = form.location.trim();
      if (form.target_volunteers) payload.target_volunteers = Number(form.target_volunteers);
      if (form.proposed_date) payload.proposed_date = form.proposed_date;
      const res = await api.post('/v2/volunteering/community-projects', payload);
      if (res.success) {
        toast.success(t('community_projects.propose_success'));
        setForm({ title: '', description: '', category: '', location: '', target_volunteers: '', proposed_date: '' });
        onClose();
        load();
      } else {
        toast.error(t('community_projects.propose_error'));
      }
    } catch (err) {
      logError('Failed to propose community project', err);
      toast.error(t('community_projects.propose_error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-amber-400" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary">{t('community_projects.heading')}</h2>
        </div>
        <Button
          className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
          size="sm"
          startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
          onPress={onOpen}
        >
          {t('community_projects.propose')}
        </Button>
      </div>

      {/* Error */}
      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <p className="text-theme-muted mb-4">{error}</p>
          <Button className="bg-gradient-to-r from-rose-500 to-pink-600 text-white" onPress={load}>
            {t('community_projects.try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Loading */}
      {!error && isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" role="status" aria-busy="true" aria-label={t('common:loading')}>
          {[1, 2, 3, 4].map((i) => (
            <CardRowsSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Empty */}
      {!error && !isLoading && projects.length === 0 && (
        <EmptyState
          icon={<Lightbulb className="w-12 h-12" aria-hidden="true" />}
          title={t('community_projects.empty_title')}
          description={t('community_projects.empty_description')}
          action={
            // "Be the first to propose…": the same form as the header button (gap C6).
            <Button className="bg-gradient-to-r from-rose-500 to-pink-600 text-white" onPress={onOpen}>
              {t('community_projects.propose')}
            </Button>
          }
        />
      )}

      {/* Project Grid */}
      {!error && !isLoading && projects.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map((project) => (
            <motion.div key={project.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
              <GlassCard className="p-5 flex flex-col h-full">
                {/* Title + Status */}
                <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                  <h3 className="min-w-0 flex-1 text-base font-semibold text-theme-primary line-clamp-2">
                    {project.title}
                  </h3>
                  <Chip size="sm" variant="soft" color={STATUS_COLORS[project.status]} className="shrink-0">
                    {t(`community_projects.status.${project.status}`)}
                  </Chip>
                </div>

                {/* Description */}
                <p className="text-sm text-theme-muted line-clamp-3 mb-3">{project.description}</p>

                {/* Meta */}
                <div className="flex flex-wrap items-center gap-2 text-xs text-theme-subtle mb-3">
                  <span className="flex items-center gap-1">
                    <User className="w-3 h-3" aria-hidden="true" />
                    {project.proposer_name}
                  </span>
                  {project.category && (
                    <Chip size="sm" variant="soft">
                      {project.category}
                    </Chip>
                  )}
                  {project.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" aria-hidden="true" />
                      {project.location}
                    </span>
                  )}
                  {project.proposed_date && (
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" aria-hidden="true" />
                      {new Date(project.proposed_date).toLocaleDateString(getFormattingLocale())}
                    </span>
                  )}
                  {project.target_volunteers != null && (
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" aria-hidden="true" />
                      {t('community_projects.volunteers_needed', { count: project.target_volunteers })}
                    </span>
                  )}
                </div>

                {/* Support row */}
                <div className="mt-auto flex items-center justify-between pt-2 border-t border-theme-default">
                  <span className="text-xs text-theme-subtle">
                    {new Date(project.created_at).toLocaleDateString(getFormattingLocale())}
                  </span>
                  <Button
                    size="sm"
                    variant={project.has_supported ? 'primary' : 'tertiary'}
                    className={
                      project.has_supported
                        ? 'bg-gradient-to-r from-rose-500 to-pink-600 text-white'
                        : 'bg-theme-elevated text-theme-muted'
                    }
                    startContent={<Heart className={`w-4 h-4 ${project.has_supported ? 'fill-current' : ''}`} aria-hidden="true" />}
                    isLoading={togglingId === project.id}
                    onPress={() => toggleSupport(project)}
                    aria-pressed={project.has_supported}
                    aria-label={t(
                      project.has_supported
                        ? 'community_projects.unsupport_aria'
                        : 'community_projects.support_aria',
                      { count: project.supporter_count }
                    )}
                  >
                    {project.supporter_count}
                  </Button>
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      )}

      {/* Propose Modal */}
      <Modal
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        size="lg"
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="text-theme-primary">{t('community_projects.modal_title')}</ModalHeader>
              <ModalBody className="gap-4">
                <Input
                  label={t('community_projects.form.title')}
                  placeholder={t('community_projects.form.title_placeholder')}
                  variant="secondary"
                  isRequired
                  value={form.title}
                  onValueChange={(v) => setForm((f) => ({ ...f, title: v }))}
                />
                <Textarea
                  label={t('community_projects.form.description')}
                  placeholder={t('community_projects.form.description_placeholder')}
                  variant="secondary"
                  isRequired
                  minRows={3}
                  value={form.description}
                  onValueChange={(v) => setForm((f) => ({ ...f, description: v }))}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label={t('community_projects.form.category')}
                    placeholder={t('community_projects.form.category_placeholder')}
                    variant="secondary"
                    value={form.category}
                    onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
                  />
                  <Input
                    label={t('community_projects.form.location')}
                    placeholder={t('community_projects.form.location_placeholder')}
                    variant="secondary"
                    value={form.location}
                    onValueChange={(v) => setForm((f) => ({ ...f, location: v }))}
                  />
                  <Input
                    label={t('community_projects.form.target_volunteers')}
                    placeholder={t('community_projects.form.target_volunteers_placeholder')}
                    type="number"
                    variant="secondary"
                    value={form.target_volunteers}
                    onValueChange={(v) => setForm((f) => ({ ...f, target_volunteers: v }))}
                  />
                  <Input
                    label={t('community_projects.form.proposed_date')}
                    type="date"
                    variant="secondary"
                    value={form.proposed_date}
                    onValueChange={(v) => setForm((f) => ({ ...f, proposed_date: v }))}
                  />
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>{t('community_projects.cancel')}</Button>
                <Button
                  className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
                  isLoading={isSubmitting}
                  onPress={() => handleSubmit(onClose)}
                >
                  {t('community_projects.propose_button')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

export default CommunityProjectsTab;
