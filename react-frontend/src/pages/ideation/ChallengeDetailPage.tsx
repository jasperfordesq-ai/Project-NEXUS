import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@/components/ui/Dropdown';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { Tooltip } from '@/components/ui/Tooltip';
import { useDisclosure } from '@/components/ui/useDisclosure';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Challenge Detail Page - View challenge details and browse/submit ideas
 *
 * Features:
 * - Challenge header with status, description, deadlines, prize
 * - Admin controls: full status lifecycle transitions (I11)
 * - Ideas list with sort toggle (Top Voted / Newest)
 * - Rich media on ideas (I2)
 * - Vote toggle on each idea
 * - Submit Idea modal with media attachment (I2)
 * - Outcomes section on closed challenges (I10)
 * - Campaign link (I7)
 * - Favorite toggle (I8)
 * - Cursor-based pagination for ideas
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import ArrowBigUp from 'lucide-react/icons/arrow-big-up';
import Lightbulb from 'lucide-react/icons/lightbulb';
import Plus from 'lucide-react/icons/plus';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Calendar from 'lucide-react/icons/calendar';
import MessageCircle from 'lucide-react/icons/message-circle';
import Trophy from 'lucide-react/icons/trophy';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import Edit3 from 'lucide-react/icons/pen-line';
import Trash2 from 'lucide-react/icons/trash-2';
import Heart from 'lucide-react/icons/heart';
import Eye from 'lucide-react/icons/eye';
import Star from 'lucide-react/icons/star';
import Copy from 'lucide-react/icons/copy';
import Users from 'lucide-react/icons/users';
import LinkIcon from 'lucide-react/icons/link';
import Image from 'lucide-react/icons/image';
import FileText from 'lucide-react/icons/file-text';
import Video from 'lucide-react/icons/video';
import ExternalLink from 'lucide-react/icons/external-link';
import Award from 'lucide-react/icons/award';
import Target from 'lucide-react/icons/target';
import Layers from 'lucide-react/icons/layers';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import { EmptyState } from '@/components/feedback';
import { SocialInteractionPanel } from '@/components/social/SocialInteractionPanel';
import { useAuth, useToast, useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo/PageMeta';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, resolveAssetUrl, resolveThumbnailUrl, formatRelativeTime, getFormattingLocale } from '@/lib/helpers';

/* ───────────────────────── Types ───────────────────────── */

interface Challenge {
  id: number;
  tenant_id: number;
  user_id: number;
  title: string;
  description: string;
  category: string | null;
  status: 'draft' | 'open' | 'voting' | 'evaluating' | 'closed' | 'archived';
  ideas_count: number;
  submission_deadline: string | null;
  voting_deadline: string | null;
  prize_description: string | null;
  max_ideas_per_user: number | null;
  created_at: string;
  user_idea_count?: number;
  tags: string[];
  cover_image: string | null;
  is_favorited: boolean;
  favorites_count: number;
  is_liked?: boolean;
  likes_count?: number;
  comments_count?: number;
  views_count: number;
  is_featured: boolean;
  campaign_id?: number | null;
  campaign_name?: string | null;
  creator: {
    id: number;
    name: string;
    avatar_url: string | null;
  };
}

interface IdeaMedia {
  id: number;
  idea_id: number;
  type: 'image' | 'video' | 'document' | 'link';
  url: string;
  caption: string | null;
  created_at: string;
}

interface Idea {
  id: number;
  challenge_id: number;
  user_id: number;
  title: string;
  description: string;
  votes_count: number;
  comments_count: number;
  status: 'draft' | 'submitted' | 'shortlisted' | 'winner' | 'withdrawn';
  has_voted: boolean;
  created_at: string;
  image_url: string | null;
  media?: IdeaMedia[];
  creator: {
    id: number;
    name: string;
    avatar_url: string | null;
  };
}

interface VoteResult {
  voted: boolean;
  votes_count: number;
}

interface ChallengeOutcome {
  winning_idea_id: number | null;
  winning_idea_title: string | null;
  implementation_status: 'not_started' | 'in_progress' | 'implemented' | 'abandoned';
  impact_description: string | null;
  updated_at: string | null;
}

interface Campaign {
  id: number;
  title: string;
}

type SortMode = 'votes' | 'newest';

const STATUS_COLOR_MAP: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'secondary' | 'primary'> = {
  draft: 'default',
  open: 'success',
  voting: 'warning',
  evaluating: 'primary',
  closed: 'danger',
  archived: 'secondary',
};

const IDEA_STATUS_COLOR_MAP: Record<string, 'default' | 'success' | 'warning' | 'secondary'> = {
  draft: 'warning',
  submitted: 'default',
  shortlisted: 'warning',
  winner: 'success',
  withdrawn: 'secondary',
};

const MEDIA_ICON_MAP: Record<string, typeof Image> = {
  image: Image,
  video: Video,
  document: FileText,
  link: ExternalLink,
};

const IMPLEMENTATION_STATUS_COLORS: Record<string, 'default' | 'warning' | 'success' | 'danger'> = {
  not_started: 'default',
  in_progress: 'warning',
  implemented: 'success',
  abandoned: 'danger',
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

export function ChallengeDetailPage() {
  const { t } = useTranslation('ideation');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, user } = useAuth();
  const { tenantPath, hasFeature } = useTenant();
  const toast = useToast();

  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingIdeas, setIsLoadingIdeas] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('votes');
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>();
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [votingIds, setVotingIds] = useState<Set<number>>(new Set());

  // Submit idea modal
  const { isOpen: isSubmitOpen, onOpen: onSubmitOpen, onClose: onSubmitClose } = useDisclosure();
  const [newIdea, setNewIdea] = useState({ title: '', description: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Media attachment for new idea (I2)
  const [newIdeaMediaUrl, setNewIdeaMediaUrl] = useState('');
  const [newIdeaMediaType, setNewIdeaMediaType] = useState<string>('link');
  const [newIdeaMediaCaption, setNewIdeaMediaCaption] = useState('');

  // Draft ideas
  const [drafts, setDrafts] = useState<Array<{id: number; title: string; description: string; created_at: string; updated_at: string | null}>>([]);
  const [isLoadingDrafts, setIsLoadingDrafts] = useState(false);
  const [editingDraftId, setEditingDraftId] = useState<number | null>(null);

  // Delete challenge modal
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();
  const [isDeleting, setIsDeleting] = useState(false);

  // Favorite toggle
  const [isFavoriting, setIsFavoriting] = useState(false);

  // Duplicate
  const [isDuplicating, setIsDuplicating] = useState(false);

  // Outcomes (I10)
  const [outcome, setOutcome] = useState<ChallengeOutcome | null>(null);
  const [, setIsLoadingOutcome] = useState(false);
  const { isOpen: isOutcomeOpen, onOpen: onOutcomeOpen, onClose: onOutcomeClose } = useDisclosure();
  const [outcomeForm, setOutcomeForm] = useState({
    winning_idea_id: '',
    implementation_status: 'not_started',
    impact_description: '',
  });
  const [isSavingOutcome, setIsSavingOutcome] = useState(false);

  // Campaign linking (I7)
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const { isOpen: isCampaignOpen, onOpen: onCampaignOpen, onClose: onCampaignClose } = useDisclosure();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('');
  const [isLinkingCampaign, setIsLinkingCampaign] = useState(false);

  const isAdmin = user?.role && ['admin', 'tenant_admin', 'tenant_super_admin', 'super_admin'].includes(user.role);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  usePageTitle(challenge?.title ?? t('page_title'));

  /* ───── Fetch challenge ───── */
  const fetchChallenge = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setIsLoading(true);
      const response = await api.get<Challenge>(`/v2/ideation-challenges/${id}`);
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setChallenge(response.data);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to fetch challenge', err);
      setError(tRef.current('challenges.load_error'));
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  /* ───── Fetch ideas ───── */
  const ideasAbortRef = useRef<AbortController | null>(null);
  const fetchIdeas = useCallback(async (sort: SortMode, loadMore = false) => {
    ideasAbortRef.current?.abort();
    const controller = new AbortController();
    ideasAbortRef.current = controller;
    try {
      if (loadMore) {
        setIsLoadingMore(true);
      } else {
        setIsLoadingIdeas(true);
      }

      const params = new URLSearchParams();
      params.set('per_page', '20');
      params.set('sort', sort);
      if (loadMore && cursor) {
        params.set('cursor', cursor);
      }

      const response = await api.get<Idea[]>(`/v2/ideation-challenges/${id}/ideas?${params}`);
      if (controller.signal.aborted) return;

      if (response.success && response.data) {
        const items = Array.isArray(response.data) ? response.data : [];
        if (loadMore) {
          setIdeas(prev => [...prev, ...items]);
        } else {
          setIdeas(items);
        }
        setCursor(response.meta?.cursor ?? undefined);
        setHasMore(response.meta?.has_more ?? false);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to fetch ideas', err);
    } finally {
      setIsLoadingIdeas(false);
      setIsLoadingMore(false);
    }
  }, [id, cursor]);

  /* ───── Fetch outcome (I10) ───── */
  const fetchOutcome = useCallback(async () => {
    if (!challenge || !['closed', 'archived'].includes(challenge.status)) return;
    setIsLoadingOutcome(true);
    try {
      const response = await api.get<ChallengeOutcome>(`/v2/ideation-challenges/${id}/outcome`);
      if (response.success && response.data) {
        setOutcome(response.data);
        setOutcomeForm({
          winning_idea_id: response.data.winning_idea_id ? String(response.data.winning_idea_id) : '',
          implementation_status: response.data.implementation_status ?? 'not_started',
          impact_description: response.data.impact_description ?? '',
        });
      }
    } catch (err) {
      logError('Failed to fetch outcome', err);
    } finally {
      setIsLoadingOutcome(false);
    }
  }, [id, challenge?.status]); // eslint-disable-line react-hooks/exhaustive-deps -- load outcome when challenge closes; loadOutcome excluded to avoid loop

  /* ───── Fetch user's draft ideas ───── */
  const fetchDrafts = useCallback(async () => {
    if (!isAuthenticated || !challenge) return;
    setIsLoadingDrafts(true);
    try {
      const response = await api.get<typeof drafts>(`/v2/ideation-challenges/${challenge.id}/ideas/drafts`);
      if (response.success && response.data) {
        setDrafts(Array.isArray(response.data) ? response.data : []);
      }
    } catch (err) {
      logError('Failed to fetch drafts', err);
    } finally {
      setIsLoadingDrafts(false);
    }
  }, [isAuthenticated, challenge]);  

  useEffect(() => {
    fetchChallenge();
  }, [fetchChallenge]);

  useEffect(() => {
    if (id) {
      setCursor(undefined);
      fetchIdeas(sortMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on sort change; fetchIdeas excluded to avoid loop
  }, [id, sortMode]);

  useEffect(() => {
    if (challenge && ['closed', 'archived'].includes(challenge.status)) {
      fetchOutcome();
    }
  }, [challenge?.status, fetchOutcome]); // eslint-disable-line react-hooks/exhaustive-deps -- only trigger on status change

  // Fetch drafts when submit modal opens
  useEffect(() => {
    if (isSubmitOpen) {
      fetchDrafts();
    } else {
      // Reset draft editing state when modal closes
      setEditingDraftId(null);
    }
  }, [isSubmitOpen, fetchDrafts]);

  /* ───── Actions ───── */

  const handleVote = async (ideaId: number) => {
    if (!isAuthenticated) return;
    if (votingIds.has(ideaId)) return;

    setVotingIds(prev => new Set(prev).add(ideaId));

    try {
      const response = await api.post<VoteResult>(`/v2/ideation-ideas/${ideaId}/vote`);

      if (response.success && response.data) {
        const result = response.data;
        setIdeas(prev => prev.map(idea => {
          if (idea.id === ideaId) {
            return {
              ...idea,
              has_voted: result.voted,
              votes_count: result.votes_count,
            };
          }
          return idea;
        }));

        toastRef.current.success(result.voted ? tRef.current('toast.vote_added') : tRef.current('toast.vote_removed'));
      } else {
        // A failed vote (4xx/5xx resolves to { success: false } without throwing)
        // previously fell through silently — no update, no feedback. Surface it.
        toastRef.current.error(tRef.current('toast.error_generic'));
      }
    } catch (err) {
      logError('Failed to vote', err);
      toastRef.current.error(tRef.current('toast.error_generic'));
    } finally {
      setVotingIds(prev => {
        const next = new Set(prev);
        next.delete(ideaId);
        return next;
      });
    }
  };

  const handleSubmitIdea = async () => {
    if (!newIdea.title.trim() || !newIdea.description.trim()) return;

    // If editing a draft, publish it instead of creating new
    if (editingDraftId) {
      setIsSubmitting(true);
      try {
        await api.put(`/v2/ideation-ideas/${editingDraftId}/draft`, {
          title: newIdea.title.trim(),
          description: newIdea.description.trim(),
          publish: true,
        });

        // If media URL provided, attach it (I2)
        if (newIdeaMediaUrl.trim()) {
          try {
            await api.post(`/v2/ideation-ideas/${editingDraftId}/media`, {
              media_type: newIdeaMediaType,
              url: newIdeaMediaUrl.trim(),
              caption: newIdeaMediaCaption.trim() || null,
            });
          } catch (mediaErr) {
            logError('Failed to attach media to published draft', mediaErr);
          }
        }

        toastRef.current.success(tRef.current('toast.idea_submitted'));
        onSubmitClose();
        setNewIdea({ title: '', description: '' });
        setNewIdeaMediaUrl('');
        setNewIdeaMediaType('link');
        setNewIdeaMediaCaption('');
        setEditingDraftId(null);
        setCursor(undefined);
        fetchIdeas(sortMode, false);
        fetchChallenge();
      } catch (err) {
        logError('Failed to publish draft', err);
        toastRef.current.error(tRef.current('toast.error_generic'));
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    setIsSubmitting(true);
    try {
      const ideaResponse = await api.post<{ id: number }>(`/v2/ideation-challenges/${id}/ideas`, {
        title: newIdea.title.trim(),
        description: newIdea.description.trim(),
      });

      // If media URL provided, attach it (I2)
      if (ideaResponse.data?.id && newIdeaMediaUrl.trim()) {
        try {
          await api.post(`/v2/ideation-ideas/${ideaResponse.data.id}/media`, {
            media_type: newIdeaMediaType,
            url: newIdeaMediaUrl.trim(),
            caption: newIdeaMediaCaption.trim() || null,
          });
        } catch (mediaErr) {
          logError('Failed to attach media to idea', mediaErr);
          // Don't fail the whole submission for media
        }
      }

      toastRef.current.success(tRef.current('toast.idea_submitted'));
      setNewIdea({ title: '', description: '' });
      setNewIdeaMediaUrl('');
      setNewIdeaMediaType('link');
      setNewIdeaMediaCaption('');
      onSubmitClose();

      // Refresh
      setCursor(undefined);
      fetchIdeas(sortMode);
      fetchChallenge();
    } catch (err) {
      logError('Failed to submit idea', err);
      toastRef.current.error(tRef.current('toast.error_generic'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!newIdea.title.trim()) {
      toastRef.current.error(tRef.current('validation.title_required'));
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingDraftId) {
        // Update existing draft
        await api.put(`/v2/ideation-ideas/${editingDraftId}/draft`, {
          title: newIdea.title.trim(),
          description: newIdea.description.trim(),
        });
      } else {
        // Create new draft
        await api.post(`/v2/ideation-challenges/${challenge!.id}/ideas`, {
          title: newIdea.title.trim(),
          description: newIdea.description.trim(),
          is_draft: true,
        });
      }

      toastRef.current.success(tRef.current('ideas.draft_saved'));
      setNewIdea({ title: '', description: '' });
      setEditingDraftId(null);
      fetchDrafts();
    } catch (err) {
      logError('Failed to save draft', err);
      toastRef.current.error(tRef.current('toast.error_generic'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    try {
      await api.put(`/v2/ideation-challenges/${id}/status`, { status: newStatus });
      toastRef.current.success(tRef.current('admin.status_updated'));
      fetchChallenge();
    } catch (err) {
      logError('Failed to update status', err);
      toastRef.current.error(tRef.current('toast.error_generic'));
    }
  };

  const handleDeleteChallenge = async () => {
    setIsDeleting(true);
    try {
      await api.delete(`/v2/ideation-challenges/${id}`);
      toastRef.current.success(tRef.current('toast.challenge_deleted'));
      navigate(tenantPath('/ideation'));
    } catch (err) {
      logError('Failed to delete challenge', err);
      toastRef.current.error(tRef.current('toast.error_generic'));
    } finally {
      setIsDeleting(false);
      onDeleteClose();
    }
  };

  const handleToggleFavorite = async () => {
    if (isFavoriting || !challenge) return;

    setIsFavoriting(true);
    try {
      const response = await api.post<{ favorited: boolean; favorites_count: number }>(
        `/v2/ideation-challenges/${id}/favorite`
      );

      if (response.success && response.data) {
        setChallenge(prev => prev ? {
          ...prev,
          is_favorited: response.data!.favorited,
          favorites_count: response.data!.favorites_count,
        } : prev);
      }
    } catch (err) {
      logError('Failed to toggle favorite', err);
      toastRef.current.error(tRef.current('toast.error_generic'));
    } finally {
      setIsFavoriting(false);
    }
  };

  const handleDuplicate = async () => {
    if (isDuplicating) return;

    setIsDuplicating(true);
    try {
      const response = await api.post<{ id: number }>(`/v2/ideation-challenges/${id}/duplicate`);

      if (response.success && response.data) {
        toastRef.current.success(tRef.current('duplicate.success'));
        navigate(tenantPath(`/ideation/${response.data.id}/edit`));
      }
    } catch (err) {
      logError('Failed to duplicate challenge', err);
      toastRef.current.error(tRef.current('duplicate.error'));
    } finally {
      setIsDuplicating(false);
    }
  };

  // Save outcome (I10)
  const handleSaveOutcome = async () => {
    setIsSavingOutcome(true);
    try {
      await api.put(`/v2/ideation-challenges/${id}/outcome`, {
        winning_idea_id: outcomeForm.winning_idea_id ? parseInt(outcomeForm.winning_idea_id, 10) : null,
        implementation_status: outcomeForm.implementation_status,
        impact_description: outcomeForm.impact_description.trim() || null,
      });
      toastRef.current.success(tRef.current('toast.outcome_saved'));
      onOutcomeClose();
      fetchOutcome();
    } catch (err) {
      logError('Failed to save outcome', err);
      toastRef.current.error(tRef.current('toast.error_generic'));
    } finally {
      setIsSavingOutcome(false);
    }
  };

  // Link to campaign (I7)
  const handleLinkCampaign = async () => {
    if (!selectedCampaignId) return;
    setIsLinkingCampaign(true);
    try {
      await api.post(`/v2/ideation-campaigns/${selectedCampaignId}/challenges`, {
        challenge_id: parseInt(id!, 10),
      });
      toastRef.current.success(tRef.current('campaigns.link_challenge'));
      onCampaignClose();
      fetchChallenge();
    } catch (err) {
      logError('Failed to link campaign', err);
      toastRef.current.error(tRef.current('toast.error_generic'));
    } finally {
      setIsLinkingCampaign(false);
    }
  };

  const openCampaignModal = async () => {
    onCampaignOpen();
    if (campaigns.length === 0) {
      try {
        const response = await api.get<Campaign[]>('/v2/ideation-campaigns');
        if (response.success && response.data) {
          setCampaigns(Array.isArray(response.data) ? response.data : []);
        }
      } catch (err) {
        logError('Failed to fetch campaigns', err);
      }
    }
  };

  const canSubmitIdea = challenge?.status === 'open' && isAuthenticated &&
    (challenge.max_ideas_per_user === null ||
     (challenge.user_idea_count ?? 0) < challenge.max_ideas_per_user);

  /* ───── Render ───── */

  if (isLoading) {
    return (
      <div className="flex justify-center py-12" role="status" aria-label={t('challenges.loading')} aria-busy="true">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !challenge) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        <EmptyState
          icon={<AlertTriangle className="w-10 h-10 text-theme-subtle" />}
          title={t('challenges.load_error')}
          action={
            <Button
              color="primary"
              variant="flat"
              startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
              onPress={() => fetchChallenge()}
            >
              {t('actions.retry')}
            </Button>
          }
        />
      </div>
    );
  }

  // Status transition options for the admin dropdown (I11 - full lifecycle)
  const statusTransitions: Record<string, { key: string; label: string }[]> = {
    draft: [{ key: 'open', label: t('admin.set_open') }],
    open: [
      { key: 'voting', label: t('admin.set_voting') },
      { key: 'evaluating', label: t('admin.set_evaluating') },
      { key: 'closed', label: t('admin.set_closed') },
    ],
    voting: [
      { key: 'evaluating', label: t('admin.set_evaluating') },
      { key: 'closed', label: t('admin.set_closed') },
    ],
    evaluating: [
      { key: 'closed', label: t('admin.set_closed') },
    ],
    closed: [
      { key: 'archived', label: t('admin.set_archived') },
      { key: 'open', label: t('admin.reopen') },
    ],
    archived: [
      { key: 'closed', label: t('admin.unarchive') },
    ],
  };

  // Build admin dropdown items with uniform shape
  interface AdminMenuItem {
    key: string;
    label: string;
    onPress: () => void;
    className?: string;
    color?: 'danger';
    startContent?: React.ReactNode;
  }

  const adminMenuItems: AdminMenuItem[] = [
    ...(statusTransitions[challenge.status] ?? []).map((transition) => ({
      key: transition.key,
      label: transition.label,
      onPress: () => handleStatusChange(transition.key),
    })),
    {
      key: 'link-campaign',
      label: t('campaigns.link_challenge'),
      startContent: <Layers className="w-4 h-4" />,
      onPress: openCampaignModal,
    },
    {
      key: 'duplicate',
      label: t('duplicate.button'),
      startContent: <Copy className="w-4 h-4" />,
      onPress: handleDuplicate,
    },
    {
      key: 'edit',
      label: t('admin.edit_challenge'),
      startContent: <Edit3 className="w-4 h-4" />,
      onPress: () => navigate(tenantPath(`/ideation/${id}/edit`)),
    },
    ...(['closed', 'archived'].includes(challenge.status) ? [{
      key: 'outcome',
      label: t('outcomes.title'),
      startContent: <Target className="w-4 h-4" />,
      onPress: onOutcomeOpen,
    }] : []),
    {
      key: 'delete',
      label: t('admin.delete_challenge'),
      className: 'text-danger',
      color: 'danger' as const,
      startContent: <Trash2 className="w-4 h-4" />,
      onPress: onDeleteOpen,
    },
  ];

  // Feature gate — checked before loading/error to avoid useless rendering
  if (!hasFeature('ideation_challenges')) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 py-16 text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-100 to-yellow-100 dark:from-amber-900/30 dark:to-yellow-900/30 flex items-center justify-center mb-4">
          <Lightbulb className="w-8 h-8 text-[var(--color-warning)]" aria-hidden="true" />
        </div>
        <h2 className="text-xl font-semibold text-[var(--color-text)] mb-2">{t('campaigns.feature_not_available')}</h2>
        <p className="text-[var(--color-text-muted)] max-w-sm">
          {t('campaigns.feature_not_available_desc')}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <PageMeta title={challenge?.title} description={challenge?.description?.substring(0, 160)} image={challenge?.cover_image ? resolveAssetUrl(challenge.cover_image) : undefined} />
      <Helmet>
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'CreativeWork',
            name: challenge?.title,
            ...(challenge?.description ? { description: challenge.description.substring(0, 300) } : {}),
            ...(challenge?.cover_image ? { image: resolveAssetUrl(challenge.cover_image) } : {}),
          }).replace(/</g, '\\u003c')}
        </script>
      </Helmet>
      {/* Back link */}
      <Button
        variant="light"
        startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
        className="mb-4 -ml-2"
        onPress={() => navigate(tenantPath('/ideation'))}
      >
        {t('title')}
      </Button>

      {/* Cover Image Banner */}
      {challenge.cover_image && (
        <div className="w-full h-48 sm:h-64 rounded-xl overflow-hidden mb-6">
          <img
            src={resolveThumbnailUrl(challenge.cover_image, { width: 1200, height: 675 })}
            alt={challenge.title}
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
          />
        </div>
      )}

      {/* Challenge Header */}
      <GlassCard className="p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h1 className="text-2xl font-bold text-[var(--color-text)]">
                {challenge.title}
              </h1>
              <Chip
                size="sm"
                color={STATUS_COLOR_MAP[challenge.status] ?? 'default'}
                variant="flat"
              >
                {t(`status.${challenge.status}`)}
              </Chip>
              {challenge.is_featured && (
                <Chip
                  size="sm"
                  color="warning"
                  variant="flat"
                  startContent={<Star className="w-3 h-3 fill-current" aria-hidden="true" />}
                >
                  {t('featured')}
                </Chip>
              )}
            </div>

            {/* Category + Campaign link */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              {challenge.category && (
                <Chip size="sm" variant="flat">
                  {challenge.category}
                </Chip>
              )}
              {challenge.campaign_name && (
                <Chip
                  size="sm"
                  variant="flat"
                  color="secondary"
                  startContent={<Layers className="w-3 h-3" aria-hidden="true" />}
                >
                  {challenge.campaign_name}
                </Chip>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Favorite Button */}
            <Button
              isIconOnly
              variant="flat"
              size="sm"
              onPress={handleToggleFavorite}
              isDisabled={isFavoriting}
              aria-label={challenge.is_favorited ? t('favorites.remove') : t('favorites.add')}
            >
              <Heart
                className={`w-5 h-5 ${
                  challenge.is_favorited
                    ? 'text-[var(--color-error)] fill-current'
                    : 'text-[var(--color-text-tertiary)]'
                }`}
              />
            </Button>

            {/* Admin Controls */}
            {isAdmin && (
              <Dropdown>
                <DropdownTrigger>
                  <Button isIconOnly variant="flat" size="sm" aria-label={t('challenge_detail.actions')}>
                    <MoreVertical className="w-4 h-4" aria-hidden="true" />
                  </Button>
                </DropdownTrigger>
                <DropdownMenu aria-label={t('admin.change_status')} items={adminMenuItems}>
                  {(item) => (
                    <DropdownItem
                      key={item.key} id={item.key}
                      className={item.className}
                      color={item.color}
                      startContent={item.startContent}
                      onPress={item.onPress}
                    >
                      {item.label}
                    </DropdownItem>
                  )}
                </DropdownMenu>
              </Dropdown>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="text-[var(--color-text-secondary)] whitespace-pre-wrap mb-4">
          {challenge.description}
        </p>

        {/* Tags */}
        {Array.isArray(challenge.tags) && challenge.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {challenge.tags.map((tag) => (
              <Chip key={tag} size="sm" variant="bordered" className="text-xs">
                {tag}
              </Chip>
            ))}
          </div>
        )}

        {/* Meta info */}
        <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--color-text-tertiary)]">
          <span className="flex items-center gap-1.5">
            <Eye className="w-4 h-4" aria-hidden="true" />
            {challenge.views_count} {t('views')}
          </span>
          <span className="flex items-center gap-1.5">
            <Heart className="w-4 h-4" aria-hidden="true" />
            {challenge.favorites_count}
          </span>
          {challenge.submission_deadline && (
            <span className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4" aria-hidden="true" />
              {t('challenge.submission_deadline', { date: formatDate(challenge.submission_deadline) })}
            </span>
          )}
          {challenge.voting_deadline && (
            <span className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4" aria-hidden="true" />
              {t('challenge.voting_deadline', { date: formatDate(challenge.voting_deadline) })}
            </span>
          )}
          {challenge.max_ideas_per_user && (
            <span className="flex items-center gap-1.5">
              <Lightbulb className="w-4 h-4" aria-hidden="true" />
              {t('challenge.max_ideas', { count: challenge.max_ideas_per_user })}
            </span>
          )}
        </div>

        <SocialInteractionPanel
          targetType="challenge"
          targetId={challenge.id}
          initialLiked={challenge.is_liked ?? false}
          initialLikesCount={challenge.likes_count ?? 0}
          initialCommentsCount={challenge.comments_count ?? 0}
          title={challenge.title}
          description={challenge.description}
          targetOwnerId={challenge.user_id}
          className="mt-4"
        />

        {/* Prize */}
        {challenge.prize_description && (
          <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
            <div className="flex items-center gap-2 mb-1">
              <Trophy className="w-4 h-4 text-[var(--color-warning)]" />
              <span className="font-semibold text-theme-warning">
                {t('challenge.prize')}
              </span>
            </div>
            <p className="text-sm text-theme-warning">
              {challenge.prize_description}
            </p>
          </div>
        )}
      </GlassCard>

      {/* Outcome Section (I10) — shown on closed/archived challenges */}
      {['closed', 'archived'].includes(challenge.status) && outcome && (
        <GlassCard className="p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-[var(--color-text)] flex items-center gap-2">
              <Target className="w-5 h-5" aria-hidden="true" />
              {t('outcomes.title')}
            </h2>
            {isAdmin && (
              <Button variant="flat" size="sm" onPress={onOutcomeOpen} aria-label={t('outcomes.edit')}>
                <Edit3 className="w-4 h-4" aria-hidden="true" />
              </Button>
            )}
          </div>

          <div className="space-y-3">
            {outcome.winning_idea_title && (
              <div>
                <span className="text-sm font-medium text-[var(--color-text-tertiary)]">
                  {t('outcomes.winning_idea')}
                </span>
                <p className="text-[var(--color-text)] flex items-center gap-2 mt-0.5">
                  <Award className="w-4 h-4 text-[var(--color-warning)]" aria-hidden="true" />
                  {outcome.winning_idea_title}
                </p>
              </div>
            )}

            <div>
              <span className="text-sm font-medium text-[var(--color-text-tertiary)]">
                {t('outcomes.status_label')}
              </span>
              <div className="mt-0.5">
                <Chip
                  size="sm"
                  color={IMPLEMENTATION_STATUS_COLORS[outcome.implementation_status] ?? 'default'}
                  variant="flat"
                >
                  {t(`outcomes.status_${outcome.implementation_status}`)}
                </Chip>
              </div>
            </div>

            {outcome.impact_description && (
              <div>
                <span className="text-sm font-medium text-[var(--color-text-tertiary)]">
                  {t('outcomes.impact_description')}
                </span>
                <p className="text-[var(--color-text-secondary)] mt-0.5 whitespace-pre-wrap">
                  {outcome.impact_description}
                </p>
              </div>
            )}
          </div>
        </GlassCard>
      )}

      {/* Ideas Section */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-[var(--color-text)]">
          {t('ideas.title')} ({challenge.ideas_count})
        </h2>

        <div className="flex items-center gap-2">
          {/* Sort Toggle */}
          <div className="flex rounded-lg overflow-hidden border border-[var(--color-border)]" role="group" aria-label={t('ideas.sort_label')}>
            <Button
              variant={sortMode === 'votes' ? 'primary' : 'tertiary'}
              size="sm"
              onPress={() => setSortMode('votes')}
              aria-pressed={sortMode === 'votes'}
              className={`min-h-9 rounded-none px-3 py-1.5 text-sm leading-5 transition-colors ${
                sortMode !== 'votes' ? 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]' : ''
              }`}
            >
              {t('ideas.sort_votes')}
            </Button>
            <Button
              variant={sortMode === 'newest' ? 'primary' : 'tertiary'}
              size="sm"
              onPress={() => setSortMode('newest')}
              aria-pressed={sortMode === 'newest'}
              className={`min-h-9 rounded-none px-3 py-1.5 text-sm leading-5 transition-colors ${
                sortMode !== 'newest' ? 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]' : ''
              }`}
            >
              {t('ideas.sort_newest')}
            </Button>
          </div>

          {/* Submit Idea Button */}
          {canSubmitIdea && (
            <Button
              color="primary"
              size="sm"
              startContent={<Plus className="w-4 h-4" />}
              onPress={onSubmitOpen}
            >
              {t('ideas.submit')}
            </Button>
          )}
        </div>
      </div>

      {/* User idea count */}
      {challenge.max_ideas_per_user && isAuthenticated && (
        <p className="text-xs text-[var(--color-text-tertiary)] mb-3">
          {t('ideas.your_ideas', {
            count: challenge.user_idea_count ?? 0,
            max: challenge.max_ideas_per_user,
          })}
        </p>
      )}

      {/* Ideas Loading */}
      {isLoadingIdeas && (
        <div className="flex justify-center py-8" role="status" aria-label={t('ideas.loading')} aria-busy="true">
          <Spinner size="md" />
        </div>
      )}

      {/* Ideas Empty */}
      {!isLoadingIdeas && ideas.length === 0 && (
        <EmptyState
          icon={<Lightbulb className="w-10 h-10 text-theme-subtle" />}
          title={t('ideas.empty_title')}
          description={t('ideas.empty_description')}
          action={
            canSubmitIdea ? (
              <Button
                color="primary"
                startContent={<Plus className="w-4 h-4" />}
                onPress={onSubmitOpen}
              >
                {t('ideas.submit')}
              </Button>
            ) : undefined
          }
        />
      )}

      {/* Ideas List */}
      {!isLoadingIdeas && ideas.length > 0 && (
        <div className="space-y-3">
          {ideas.map((idea) => {
            const MediaIconComponent = idea.media && idea.media.length > 0
              ? MEDIA_ICON_MAP[idea.media[0]?.type ?? ''] ?? LinkIcon
              : null;

            return (
              <GlassCard key={idea.id} className="p-4">
                <div className="flex items-start gap-4">
                  {/* Vote Button */}
                  <div className="flex flex-col items-center gap-0.5 min-w-[48px]">
                    <Button
                      isIconOnly
                      size="sm"
                      variant="flat"
                      onPress={() => handleVote(idea.id)}
                      isDisabled={!isAuthenticated || votingIds.has(idea.id)}
                      className={`p-1.5 rounded-lg transition-colors min-w-0 w-auto min-h-9 ${
                        idea.has_voted
                          ? 'bg-accent/10 text-accent'
                          : 'hover:bg-[var(--color-surface-hover)] text-[var(--color-text-tertiary)]'
                      }`}
                      aria-label={idea.has_voted ? t('ideas.unvote') : t('ideas.vote')}
                    >
                      <ArrowBigUp
                        className={`w-6 h-6 ${idea.has_voted ? 'fill-current' : ''}`}
                      />
                    </Button>
                    <span className={`text-sm font-semibold ${
                      idea.has_voted ? 'text-accent' : 'text-[var(--color-text-secondary)]'
                    }`}>
                      {idea.votes_count}
                    </span>
                  </div>

                  {/* Idea Content */}
                  <div className="flex-1 min-w-0">
                    <Link
                      to={tenantPath(`/ideation/${challenge.id}/ideas/${idea.id}`)}
                      className="block"
                    >
                      <div className="flex items-start gap-2 mb-1">
                        <h3 className="text-base font-semibold text-[var(--color-text)] hover:text-accent transition-colors">
                          {idea.title}
                        </h3>
                        {idea.status !== 'submitted' && (
                          <Chip
                            size="sm"
                            color={IDEA_STATUS_COLOR_MAP[idea.status] ?? 'default'}
                            variant="flat"
                          >
                            {t(`idea_status.${idea.status}`)}
                          </Chip>
                        )}
                      </div>

                      <p className="text-sm text-[var(--color-text-secondary)] line-clamp-2 mb-2">
                        {idea.description}
                      </p>

                      {/* Idea image thumbnail */}
                      {idea.image_url && (
                        <div className="mb-2">
                          <img
                            src={resolveThumbnailUrl(idea.image_url, { width: 160, height: 160 })}
                            alt={t('idea_image')}
                            className="w-24 h-24 object-cover rounded-lg"
                            loading="lazy"
                            decoding="async"
                          />
                        </div>
                      )}

                      {/* Media gallery thumbnails (I2) */}
                      {idea.media && idea.media.length > 0 && (
                        <div className="flex gap-2 mb-2 flex-wrap">
                          {idea.media.slice(0, 4).map((m) => {
                            const MIcon = MEDIA_ICON_MAP[m.type] ?? LinkIcon;
                            return m.type === 'image' ? (
                              <img
                                key={m.id}
                                src={resolveThumbnailUrl(m.url, { width: 160, height: 160 })}
                                alt={m.caption ?? ''}
                                className="w-16 h-16 object-cover rounded-lg border border-[var(--color-border)]"
                                loading="lazy"
                                decoding="async"
                              />
                            ) : (
                              <div
                                key={m.id}
                                className="w-16 h-16 rounded-lg border border-[var(--color-border)] flex items-center justify-center bg-[var(--color-surface-hover)]"
                              >
                                <MIcon className="w-5 h-5 text-[var(--color-text-tertiary)]" aria-hidden="true" />
                              </div>
                            );
                          })}
                          {idea.media.length > 4 && (
                            <div className="w-16 h-16 rounded-lg border border-[var(--color-border)] flex items-center justify-center bg-[var(--color-surface-hover)]">
                              <span className="text-xs text-[var(--color-text-tertiary)]">
                                +{idea.media.length - 4}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </Link>

                    <div className="flex items-center gap-3 text-xs text-[var(--color-text-tertiary)]">
                      <span className="flex items-center gap-1">
                        <Avatar
                          src={resolveAvatarUrl(idea.creator.avatar_url)}
                          size="sm"
                          className="w-4 h-4"
                          name={idea.creator.name}
                        />
                        {idea.creator.name}
                      </span>
                      <span className="flex items-center gap-1">
                        <MessageCircle className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('ideas.comments', { count: idea.comments_count })}
                      </span>
                      {MediaIconComponent && (
                        <span className="flex items-center gap-1">
                          <MediaIconComponent className="w-3.5 h-3.5" aria-hidden="true" />
                          {idea.media?.length}
                        </span>
                      )}
                      <span>{formatRelativeTime(idea.created_at)}</span>

                      {/* Create Group shortcut for shortlisted/winner ideas */}
                      {(idea.status === 'shortlisted' || idea.status === 'winner') &&
                        isAuthenticated &&
                        (isAdmin || user?.id === idea.user_id) && (
                        <Tooltip content={t('convert_to_group.title')}>
                          <Button
                            isIconOnly
                            variant="light"
                            size="sm"
                            className="ml-auto min-w-6 w-6 h-6"
                            onPress={() => navigate(tenantPath(`/ideation/${challenge.id}/ideas/${idea.id}`))}
                            aria-label={t('convert_to_group.title')}
                          >
                            <Users className="w-3.5 h-3.5" />
                          </Button>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                </div>
              </GlassCard>
            );
          })}

          {/* Load More Ideas */}
          {hasMore && (
            <div className="flex justify-center mt-4">
              <Button
                variant="flat"
                isLoading={isLoadingMore}
                onPress={() => fetchIdeas(sortMode, true)}
              >
                {t('ideas.load_more')}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Submit Idea Modal (I2 - with media attachment + draft support) */}
      <Modal isOpen={isSubmitOpen} onClose={onSubmitClose} size="lg">
        <ModalContent>
          <ModalHeader>{editingDraftId ? t('ideas.edit') : t('ideas.submit_title')}</ModalHeader>
          <ModalBody>
            {/* Drafts Section */}
            {isLoadingDrafts && (
              <div role="status" aria-busy="true" aria-label={t('loading')} className="flex justify-center py-2">
                <Spinner size="sm" />
              </div>
            )}
            {!isLoadingDrafts && drafts.length > 0 && (
              <div className="mb-2 p-3 rounded-lg bg-[var(--color-surface-hover)]">
                <p className="text-sm font-medium text-[var(--color-text)] mb-2">
                  {t('ideas.your_drafts')}
                </p>
                <div className="space-y-2">
                  {drafts.map((draft) => (
                    <div
                      key={draft.id}
                      role="button"
                      tabIndex={0}
                      aria-label={draft.title || t('ideas.untitled_draft')}
                      className={`flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${
                        editingDraftId === draft.id
                          ? 'bg-accent/10 border border-accent/30'
                          : 'hover:bg-[var(--color-surface)] border border-transparent'
                      }`}
                      onClick={() => {
                        setEditingDraftId(draft.id);
                        setNewIdea({ title: draft.title, description: draft.description });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setEditingDraftId(draft.id);
                          setNewIdea({ title: draft.title, description: draft.description });
                        }
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[var(--color-text)] truncate">
                          {draft.title || t('ideas.untitled_draft')}
                        </p>
                        <p className="text-xs text-[var(--color-text-tertiary)]">
                          {draft.updated_at
                            ? t('ideas.draft_updated', { date: new Date(draft.updated_at).toLocaleDateString(getFormattingLocale()) })
                            : t('ideas.draft_created', { date: new Date(draft.created_at).toLocaleDateString(getFormattingLocale()) })}
                        </p>
                      </div>
                      <Chip size="sm" variant="flat" color="warning">{t('ideas.draft')}</Chip>
                    </div>
                  ))}
                </div>
                {editingDraftId && (
                  <Button
                    size="sm"
                    variant="light"
                    className="mt-2"
                    onPress={() => {
                      setEditingDraftId(null);
                      setNewIdea({ title: '', description: '' });
                    }}
                  >
                    {t('ideas.new_idea')}
                  </Button>
                )}
              </div>
            )}

            <Input
              label={t('form.title_label')}
              placeholder={t('form.title_placeholder')}
              value={newIdea.title}
              onValueChange={(val) => setNewIdea(prev => ({ ...prev, title: val }))}
              variant="bordered"
              isRequired
            />
            <Textarea
              label={t('form.description_label')}
              placeholder={t('form.description_placeholder')}
              value={newIdea.description}
              onValueChange={(val) => setNewIdea(prev => ({ ...prev, description: val }))}
              variant="bordered"
              minRows={4}
              isRequired
            />

            {/* Media Attachment (I2) */}
            <div className="border border-[var(--color-border)] rounded-lg p-3 space-y-3">
              <p className="text-sm font-medium text-[var(--color-text)]">
                {t('media.add')} <span className="text-[var(--color-text-tertiary)] font-normal">({t('media.caption_placeholder')})</span>
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Select
                  size="sm"
                  label={t('media.type_label')}
                  selectedKeys={[newIdeaMediaType]}
                  onSelectionChange={(keys) => {
                    const selected = Array.from(keys)[0];
                    if (selected) setNewIdeaMediaType(String(selected));
                  }}
                  variant="bordered"
                >
                  <SelectItem key="image" id="image">{t('media.type_image')}</SelectItem>
                  <SelectItem key="video" id="video">{t('media.type_video')}</SelectItem>
                  <SelectItem key="document" id="document">{t('media.type_document')}</SelectItem>
                  <SelectItem key="link" id="link">{t('media.type_link')}</SelectItem>
                </Select>
                <Input
                  size="sm"
                  label={t('media.url_label')}
                  placeholder={t('media.url_placeholder')}
                  value={newIdeaMediaUrl}
                  onValueChange={setNewIdeaMediaUrl}
                  variant="bordered"
                />
              </div>
              <Input
                size="sm"
                label={t('media.caption_label')}
                placeholder={t('media.caption_placeholder')}
                value={newIdeaMediaCaption}
                onValueChange={setNewIdeaMediaCaption}
                variant="bordered"
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onSubmitClose}>
              {t('form.cancel')}
            </Button>
            <Button
              variant="bordered"
              isLoading={isSubmitting}
              isDisabled={!newIdea.title.trim()}
              onPress={handleSaveDraft}
            >
              {t('ideas.save_draft')}
            </Button>
            <Button
              color="primary"
              isLoading={isSubmitting}
              isDisabled={!newIdea.title.trim() || !newIdea.description.trim()}
              onPress={handleSubmitIdea}
            >
              {editingDraftId ? t('ideas.publish_draft') : t('ideas.submit')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Delete Challenge Confirmation Modal */}
      <Modal isOpen={isDeleteOpen} onClose={onDeleteClose}>
        <ModalContent>
          <ModalHeader>{t('admin.delete_challenge')}</ModalHeader>
          <ModalBody>
            <p className="text-[var(--color-text-secondary)]">
              {t('admin.delete_confirm')}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onDeleteClose}>
              {t('form.cancel')}
            </Button>
            <Button
              color="danger"
              isLoading={isDeleting}
              onPress={handleDeleteChallenge}
            >
              {t('admin.delete_challenge')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Outcome Editor Modal (I10) */}
      <Modal isOpen={isOutcomeOpen} onClose={onOutcomeClose} size="lg">
        <ModalContent>
          <ModalHeader>{t('outcomes.title')}</ModalHeader>
          <ModalBody>
            {/* Winning idea selector */}
            {ideas.length > 0 && (
              <Select
                label={t('outcomes.winning_idea')}
                selectedKeys={outcomeForm.winning_idea_id ? new Set([outcomeForm.winning_idea_id]) : new Set<string>()}
                onSelectionChange={(keys) => {
                  if (keys === 'all') return;
                  const selected = Array.from(keys)[0];
                  setOutcomeForm(prev => ({
                    ...prev,
                    winning_idea_id: selected ? String(selected) : '',
                  }));
                }}
                variant="bordered"
              >
                {ideas.map((idea) => (
                  <SelectItem key={String(idea.id)} id={String(idea.id)}>
                    {idea.title}
                  </SelectItem>
                ))}
              </Select>
            )}

            <Select
              label={t('outcomes.implementation_status_label')}
              selectedKeys={[outcomeForm.implementation_status]}
              onSelectionChange={(keys) => {
                const selected = Array.from(keys)[0];
                if (selected) {
                  setOutcomeForm(prev => ({
                    ...prev,
                    implementation_status: String(selected),
                  }));
                }
              }}
              variant="bordered"
            >
              <SelectItem key="not_started" id="not_started">{t('outcomes.status_not_started')}</SelectItem>
              <SelectItem key="in_progress" id="in_progress">{t('outcomes.status_in_progress')}</SelectItem>
              <SelectItem key="implemented" id="implemented">{t('outcomes.status_implemented')}</SelectItem>
              <SelectItem key="abandoned" id="abandoned">{t('outcomes.status_abandoned')}</SelectItem>
            </Select>

            <Textarea
              label={t('outcomes.impact_description')}
              placeholder={t('outcomes.impact_placeholder')}
              value={outcomeForm.impact_description}
              onValueChange={(val) => setOutcomeForm(prev => ({ ...prev, impact_description: val }))}
              variant="bordered"
              minRows={3}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onOutcomeClose}>
              {t('form.cancel')}
            </Button>
            <Button
              color="primary"
              isLoading={isSavingOutcome}
              onPress={handleSaveOutcome}
            >
              {isSavingOutcome ? t('outcomes.saving') : t('outcomes.save')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Link to Campaign Modal (I7) */}
      <Modal isOpen={isCampaignOpen} onClose={onCampaignClose}>
        <ModalContent>
          <ModalHeader>{t('campaigns.link_challenge')}</ModalHeader>
          <ModalBody>
            {campaigns.length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)]">
                {t('campaigns.empty_description')}
              </p>
            ) : (
              <Select
                label={t('campaigns.title')}
                selectedKeys={selectedCampaignId ? new Set([selectedCampaignId]) : new Set<string>()}
                onSelectionChange={(keys) => {
                  if (keys === 'all') return;
                  const selected = Array.from(keys)[0];
                  setSelectedCampaignId(selected ? String(selected) : '');
                }}
                variant="bordered"
              >
                {campaigns.map((c) => (
                  <SelectItem key={String(c.id)} id={String(c.id)}>
                    {c.title}
                  </SelectItem>
                ))}
              </Select>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onCampaignClose}>
              {t('form.cancel')}
            </Button>
            <Button
              color="primary"
              isLoading={isLinkingCampaign}
              isDisabled={!selectedCampaignId}
              onPress={handleLinkCampaign}
            >
              {t('campaigns.link_challenge')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default ChallengeDetailPage;
