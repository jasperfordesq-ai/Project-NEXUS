// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Campaign Detail Page (I7)
 *
 * Shows a campaign with its linked challenges.
 * Admin can edit campaign, link/unlink challenges.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import Layers from 'lucide-react/icons/layers';
import Edit3 from 'lucide-react/icons/pen-line';
import Trash2 from 'lucide-react/icons/trash-2';
import Lightbulb from 'lucide-react/icons/lightbulb';
import MessageSquarePlus from 'lucide-react/icons/message-square-plus';
import Eye from 'lucide-react/icons/eye';
import Calendar from 'lucide-react/icons/calendar';
import Trophy from 'lucide-react/icons/trophy';
import Heart from 'lucide-react/icons/heart';
import Star from 'lucide-react/icons/star';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Unlink from 'lucide-react/icons/unlink';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { DetailCover } from '@/components/ui/DetailCover';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { EmptyState } from '@/components/feedback';
import { useAuth, useToast, useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import { api } from '@/lib/api';
import { coverSeed } from '@/lib/coverSeeds';
import { logError } from '@/lib/logger';
import { resolveThumbnailUrl, getFormattingLocale } from '@/lib/helpers';

/* ───────────────────────── Types ───────────────────────── */

interface Campaign {
  id: number;
  title: string;
  description: string | null;
  cover_image: string | null;
  challenges_count: number;
  status: string;
  created_at: string;
  challenges: CampaignChallenge[];
}

interface CampaignChallenge {
  id: number;
  title: string;
  description: string;
  status: string;
  ideas_count: number;
  views_count: number;
  favorites_count: number;
  cover_image: string | null;
  tags: string[];
  submission_deadline: string | null;
  prize_description: string | null;
  is_featured: boolean;
}

const STATUS_COLOR_MAP: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'secondary' | 'primary'> = {
  draft: 'default',
  open: 'success',
  voting: 'warning',
  evaluating: 'primary',
  closed: 'danger',
  archived: 'secondary',
};

/* ───────────────────────── Main Component ───────────────────────── */

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString(getFormattingLocale(), {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
};

export function CampaignDetailPage() {
  const { t } = useTranslation('ideation');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tenantPath } = useTenant();
  const toast = useToast();

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit modal
  const { isOpen: isEditOpen, onOpen: onEditOpen, onClose: onEditClose } = useDisclosure();
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  const [isSaving, setIsSaving] = useState(false);

  // Delete modal
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();
  const [isDeleting, setIsDeleting] = useState(false);

  const isAdmin = user?.role && ['admin', 'tenant_admin', 'tenant_super_admin', 'super_admin'].includes(user.role);

  usePageTitle(campaign?.title ?? t('campaigns.page_title'));

  const fetchCampaign = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setIsLoading(true);
      setError(null);
      const response = await api.get<Campaign>(`/v2/ideation-campaigns/${id}`);
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setCampaign(response.data);
        setEditForm({
          name: response.data.title,
          description: response.data.description ?? '',
        });
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to fetch campaign', err);
      setError(tRef.current('challenges.load_error'));
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchCampaign();
  }, [fetchCampaign]);

  const handleSave = async () => {
    if (!editForm.name.trim()) return;

    setIsSaving(true);
    try {
      const response = await api.put(`/v2/ideation-campaigns/${id}`, {
        title: editForm.name.trim(),
        description: editForm.description.trim() || null,
      });
      if (response.success) {
        toastRef.current.success(tRef.current('toast.campaign_updated'));
        onEditClose();
        fetchCampaign();
      } else {
        // A failed request resolves to { success: false } without throwing — the
        // unconditional success toast + dialog close used to fake a saved campaign.
        toastRef.current.error(response.error || tRef.current('toast.error_generic'));
      }
    } catch (err) {
      logError('Failed to update campaign', err);
      toastRef.current.error(tRef.current('toast.error_generic'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const response = await api.delete(`/v2/ideation-campaigns/${id}`);
      if (response.success) {
        toastRef.current.success(tRef.current('toast.campaign_deleted'));
        navigate(tenantPath('/ideation/campaigns'));
      } else {
        // Don't navigate away as if deleted on a failed request.
        toastRef.current.error(response.error || tRef.current('toast.error_generic'));
      }
    } catch (err) {
      logError('Failed to delete campaign', err);
      toastRef.current.error(tRef.current('toast.error_generic'));
    } finally {
      setIsDeleting(false);
      onDeleteClose();
    }
  };

  const [unlinkTargetId, setUnlinkTargetId] = useState<number | null>(null);

  const handleUnlinkChallenge = async (challengeId: number) => {
    try {
      const response = await api.delete(`/v2/ideation-campaigns/${id}/challenges/${challengeId}`);
      if (response.success) {
        toastRef.current.success(tRef.current('campaigns.unlink_challenge'));
        setUnlinkTargetId(null);
        fetchCampaign();
      } else {
        toastRef.current.error(response.error || tRef.current('toast.error_generic'));
        setUnlinkTargetId(null);
      }
    } catch (err) {
      logError('Failed to unlink challenge', err);
      toastRef.current.error(tRef.current('toast.error_generic'));
      setUnlinkTargetId(null);
    }
  };

  if (isLoading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('loading')} className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        <EmptyState
          icon={<AlertTriangle className="w-10 h-10 text-theme-subtle" />}
          title={t('challenges.load_error')}
          action={
            <Button
              color="primary"
              variant="flat"
              startContent={<RefreshCw className="w-4 h-4" />}
              onPress={() => fetchCampaign()}
            >
              {t('actions.retry')}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <PageMeta title={campaign?.title || t('campaigns.fallback_title')} description={campaign?.description?.substring(0, 160)} noIndex />
      {/* Back link */}
      <Button
        variant="light"
        startContent={<ArrowLeft className="w-4 h-4" />}
        className="mb-4 -ml-2"
        onPress={() => navigate(tenantPath('/ideation/campaigns'))}
      >
        {t('campaigns.title')}
      </Button>

      {/* The campaign's picture (as on its card), or a cover in its own colour. */}
      <DetailCover
        data-testid="campaign-detail-cover"
        seed={coverSeed.campaign(campaign.id)}
        icon={Layers}
        imageUrl={campaign.cover_image ? resolveThumbnailUrl(campaign.cover_image, { width: 1200, height: 400 }) : null}
        className="mb-6 h-28 rounded-2xl sm:h-40"
      />

      {/* Campaign Header */}
      <GlassCard className="p-6 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[var(--color-text)] flex items-center gap-3 mb-2">
              <Layers className="w-7 h-7" />
              {campaign.title}
            </h1>
            {campaign.description && (
              <p className="text-[var(--color-text-secondary)] whitespace-pre-wrap mb-3">
                {campaign.description}
              </p>
            )}
            <div className="flex items-center gap-3 text-sm text-[var(--color-text-tertiary)]">
              <span className="flex items-center gap-1.5">
                <Lightbulb className="w-4 h-4" />
                {t('campaigns.challenges_count', { count: campaign.challenges_count })}
              </span>
              <span className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4" />
                {formatDate(campaign.created_at)}
              </span>
            </div>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2 shrink-0">
              <Button
                isIconOnly
                variant="flat"
                size="sm"
                onPress={onEditOpen}
                aria-label={t('admin.edit_campaign')}
              >
                <Edit3 className="w-4 h-4" />
              </Button>
              <Button
                isIconOnly
                variant="flat"
                size="sm"
                color="danger"
                onPress={onDeleteOpen}
                aria-label={t('admin.delete_campaign')}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </GlassCard>

      {/* Linked Challenges */}
      <h2 className="text-xl font-semibold text-[var(--color-text)] mb-4">
        {t('challenges.title')} ({campaign.challenges.length})
      </h2>

      {campaign.challenges.length === 0 ? (
        <EmptyState
          icon={<Lightbulb className="w-10 h-10 text-theme-subtle" />}
          title={t('challenges.empty_title')}
          description={t('challenges.empty_filtered')}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {campaign.challenges.map((ch) => (
            <div key={ch.id} className="relative">
              <Link
                to={tenantPath(`/ideation/${ch.id}`)}
                className="block"
              >
                <GlassCard className="h-full hover:shadow-lg transition-shadow cursor-pointer overflow-hidden">
                  {ch.cover_image && (
                    <div className="w-full h-32 overflow-hidden">
                      <img
                        src={resolveThumbnailUrl(ch.cover_image, { width: 640, height: 320 })}
                        alt={ch.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                  )}
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="text-base font-semibold text-[var(--color-text)] line-clamp-2 flex-1">
                        {ch.title}
                      </h3>
                      <div className="flex items-center gap-1 shrink-0">
                        <Chip
                          size="sm"
                          color={STATUS_COLOR_MAP[ch.status] ?? 'default'}
                          variant="flat"
                        >
                          {t(`status.${ch.status}`)}
                        </Chip>
                        {ch.is_featured && (
                          <Star className="w-3.5 h-3.5 text-[var(--color-warning)] fill-current" />
                        )}
                      </div>
                    </div>
                    <p className="text-sm text-[var(--color-text-secondary)] line-clamp-2 mb-3">
                      {ch.description}
                    </p>
                    {ch.tags && ch.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {ch.tags.slice(0, 3).map((tag) => (
                          <Chip key={tag} size="sm" variant="bordered" className="text-xs">
                            {tag}
                          </Chip>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-3 text-xs text-[var(--color-text-tertiary)]">
                      <span className="flex items-center gap-1">
                        <MessageSquarePlus className="w-3.5 h-3.5" />
                        {ch.ideas_count}
                      </span>
                      <span className="flex items-center gap-1">
                        <Eye className="w-3.5 h-3.5" />
                        {ch.views_count}
                      </span>
                      <span className="flex items-center gap-1">
                        <Heart className="w-3.5 h-3.5" />
                        {ch.favorites_count}
                      </span>
                      {ch.prize_description && (
                        <Trophy className="w-3.5 h-3.5 text-[var(--color-warning)]" />
                      )}
                    </div>
                  </div>
                </GlassCard>
              </Link>
              {/* Unlink button with confirmation */}
              {isAdmin && unlinkTargetId === ch.id ? (
                <div className="absolute top-2 right-2 z-10 flex gap-1">
                  <Button
                    size="sm"
                    color="danger"
                    variant="flat"
                    onPress={() => handleUnlinkChallenge(ch.id)}
                    aria-label={t('campaigns.confirm_unlink_label')}
                  >
                    {t('campaigns.confirm_unlink')}
                  </Button>
                  <Button
                    size="sm"
                    variant="flat"
                    onPress={() => setUnlinkTargetId(null)}
                    aria-label={t('form.cancel')}
                  >
                    {t('form.cancel')}
                  </Button>
                </div>
              ) : isAdmin ? (
                <Button
                  isIconOnly
                  variant="flat"
                  size="sm"
                  className="absolute top-2 right-2 z-10"
                  onPress={() => setUnlinkTargetId(ch.id)}
                  aria-label={t('campaigns.unlink_challenge')}
                >
                  <Unlink className="w-3.5 h-3.5" />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* Edit Campaign Modal */}
      <Modal isOpen={isEditOpen} onClose={onEditClose} size="lg">
        <ModalContent>
          <ModalHeader>{t('admin.edit_campaign')}</ModalHeader>
          <ModalBody>
            <Input
              label={t('form.title_label')}
              value={editForm.name}
              onValueChange={(val) => setEditForm(prev => ({ ...prev, name: val }))}
              variant="bordered"
              isRequired
            />
            <Textarea
              label={t('form.description_label')}
              value={editForm.description}
              onValueChange={(val) => setEditForm(prev => ({ ...prev, description: val }))}
              variant="bordered"
              minRows={3}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onEditClose}>
              {t('form.cancel')}
            </Button>
            <Button
              color="primary"
              isLoading={isSaving}
              isDisabled={!editForm.name.trim()}
              onPress={handleSave}
            >
              {isSaving ? t('form.saving') : t('form.save')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Delete Campaign Modal */}
      <Modal isOpen={isDeleteOpen} onClose={onDeleteClose}>
        <ModalContent>
          <ModalHeader>{t('admin.delete_campaign')}</ModalHeader>
          <ModalBody>
            <p className="text-[var(--color-text-secondary)]">
              {t('admin.delete_campaign_confirm')}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onDeleteClose}>
              {t('form.cancel')}
            </Button>
            <Button
              color="danger"
              isLoading={isDeleting}
              onPress={handleDelete}
            >
              {t('admin.delete_campaign')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default CampaignDetailPage;
