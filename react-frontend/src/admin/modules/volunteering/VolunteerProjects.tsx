// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { Select, SelectItem, useDisclosure, Button, Chip, Textarea, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui';

/**
 * Volunteer Community Projects
 * Admin page to review and manage community-proposed volunteer projects.
 */

import { useState, useCallback, useEffect } from 'react';

import FolderKanban from 'lucide-react/icons/folder-kanban';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Play from 'lucide-react/icons/play';
import Flag from 'lucide-react/icons/flag';
import Users from 'lucide-react/icons/users';
import PlusCircle from 'lucide-react/icons/circle-plus';
import { usePageTitle } from '@/hooks';
import { useToast, useTenant } from '@/contexts';
import { adminVolunteering } from '../../api/adminApi';
import { DataTable, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { EmptyState } from '../../components/EmptyState';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

interface CommunityProject {
  id: number;
  title: string;
  proposer_name: string;
  category: string;
  target_volunteers: number;
  status: string;
  supporters_count: number;
  created_at: string;
}

interface ProjectStats {
  total: number;
  approved: number;
  active: number;
  completed: number;
  total_supporters: number;
}

const statusColorMap: Record<string, 'success' | 'warning' | 'danger' | 'default' | 'primary' | 'secondary'> = {
  proposed: 'default',
  under_review: 'warning',
  approved: 'success',
  rejected: 'danger',
  active: 'primary',
  completed: 'secondary',
  cancelled: 'danger',
};

const reviewStatuses = ['approved', 'rejected', 'under_review'] as const;

export default function VolunteerProjects() {
  const { t } = useTranslation('admin_volunteering');
  usePageTitle(t('volunteering.projects_title'));
  const toast = useToast();
  const { tenantPath } = useTenant();
  const navigate = useNavigate();

  const [projects, setProjects] = useState<CommunityProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [stats, setStats] = useState<ProjectStats>({
    total: 0,
    approved: 0,
    active: 0,
    completed: 0,
    total_supporters: 0,
  });
  const [saving, setSaving] = useState(false);
  const [reviewingProject, setReviewingProject] = useState<CommunityProject | null>(null);
  const [reviewStatus, setReviewStatus] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');

  const { isOpen, onOpen, onClose } = useDisclosure();

  const loadData = useCallback(async (append = false, nextCursor: string | null = null) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    try {
      const res = await adminVolunteering.getCommunityProjects({
        cursor: append && nextCursor ? nextCursor : undefined,
        per_page: 20,
      });
      if (res.success && res.data) {
        const payload = res.data as unknown;
        let loadedProjects: CommunityProject[] = [];
        if (Array.isArray(payload)) {
          loadedProjects = payload;
        } else if (payload && typeof payload === 'object' && 'data' in payload) {
          loadedProjects = (payload as { data: CommunityProject[] }).data || [];
        }
        setProjects((prev) => append ? [...prev, ...loadedProjects] : loadedProjects);

        const meta = res.meta as { cursor?: string; has_more?: boolean; stats?: ProjectStats } | undefined;
        setCursor(meta?.cursor ?? null);
        setHasMore(Boolean(meta?.has_more));
        if (meta?.stats) setStats(meta.stats);
      } else {
        throw new Error('community_projects_load_failed');
      }
    } catch {
      toast.error(t('volunteering.failed_to_load_projects'));
      if (!append) setProjects([]);
    }
    setLoading(false);
    setLoadingMore(false);
  }, [t, toast]);


  useEffect(() => { loadData(); }, [loadData]);

  const openReview = (project: CommunityProject) => {
    setReviewingProject(project);
    setReviewStatus('');
    setReviewNotes('');
    onOpen();
  };

  const handleReview = async () => {
    if (!reviewingProject || !reviewStatus) {
      toast.error(t('volunteering.select_status'));
      return;
    }
    setSaving(true);
    try {
      const res = await adminVolunteering.reviewCommunityProject(reviewingProject.id, {
        status: reviewStatus,
        review_notes: reviewNotes.trim() || undefined,
      });
      if (res.success) {
        toast.success(t('volunteering.project_reviewed'));
        onClose();
        loadData();
      } else {
        // admin-i18n-ignore: localized server message — the volunteering
        // controller's refusals are __() keys.
        toast.error(res.error || t('volunteering.review_failed'));
      }
    } catch {
      toast.error(t('volunteering.review_failed'));
    }
    setSaving(false);
  };

  const handleCreateOpportunity = (project: CommunityProject) => {
    const params = new URLSearchParams({
      from_project: String(project.id),
      title: project.title,
    });
    navigate(tenantPath(`/volunteering/create?${params.toString()}`));
  };

  const columns: Column<CommunityProject>[] = [
    {
      key: 'title',
      label: t('volunteering.col_title'),
      sortable: true,
    },
    {
      key: 'proposer_name',
      label: t('volunteering.col_proposer'),
      sortable: true,
    },
    {
      key: 'category',
      label: t('volunteering.col_category'),
      sortable: true,
    },
    {
      key: 'target_volunteers',
      label: t('volunteering.col_target_volunteers'),
      sortable: true,
    },
    {
      key: 'status',
      label: t('volunteering.col_status'),
      sortable: true,
      render: (row) => (
        <Chip size="sm" color={statusColorMap[row.status] || 'default'} variant="soft">
          {t(`volunteering.project_status_${row.status}`)}
        </Chip>
      ),
    },
    {
      key: 'supporters_count',
      label: t('volunteering.col_supporters'),
      sortable: true,
    },
    {
      key: 'created_at',
      label: t('volunteering.col_date'),
      sortable: true,
      render: (row) => (
        <span>{row.created_at ? new Date(row.created_at).toLocaleDateString(getFormattingLocale()) : '-'}</span>
      ),
    },
    {
      key: 'actions' as keyof CommunityProject,
      label: t('volunteering.col_actions'),
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="tertiary"
            startContent={<ClipboardCheck size={14} />}
            onPress={() => openReview(row)}
          >
            {t('volunteering.review')}
          </Button>
          {row.status === 'approved' && (
            <Button
              size="sm"
              variant="tertiary"
              color="success"
              startContent={<PlusCircle size={14} />}
              onPress={() => handleCreateOpportunity(row)}
            >
              {t('volunteering.create_opportunity')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('volunteering.projects_title')}
        description={t('volunteering.projects_desc')}
        actions={
          <Button variant="tertiary" startContent={<RefreshCw size={16} />} onPress={() => loadData()} isLoading={loading}>
            {t('volunteering.refresh')}
          </Button>
        }
      />

      {/* Project Analytics Stats */}
      {stats.total > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard
            label={t('volunteering.total_projects')}
            value={stats.total}
            icon={FolderKanban}
            loading={loading}
          />
          <StatCard
            label={t('volunteering.approved_projects')}
            value={stats.approved}
            icon={CheckCircle}
            color="success"
            loading={loading}
          />
          <StatCard
            label={t('volunteering.active_projects')}
            value={stats.active}
            icon={Play}
            loading={loading}
          />
          <StatCard
            label={t('volunteering.completed_projects')}
            value={stats.completed}
            icon={Flag}
            loading={loading}
          />
          <StatCard
            label={t('volunteering.total_supporters')}
            value={stats.total_supporters}
            icon={Users}
            color="warning"
            loading={loading}
          />
        </div>
      )}

      {projects.length === 0 && !loading ? (
        <EmptyState
          icon={FolderKanban}
          title={t('volunteering.no_projects')}
          description={t('volunteering.no_projects_desc')}
        />
      ) : (
        <>
          <DataTable columns={columns} data={projects} isLoading={loading} />
          {hasMore && (
            <div className="flex justify-center">
              <Button variant="tertiary" onPress={() => loadData(true, cursor)} isLoading={loadingMore}>
                {t('volunteering.load_more')}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Review Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="lg">
        <ModalContent>
          <ModalHeader>
            {t('volunteering.review_project')}: {reviewingProject?.title}
          </ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-4">
              <Select
                label={t('volunteering.review_decision')}
                selectedKeys={reviewStatus ? [reviewStatus] : []}
                onSelectionChange={(keys) => {
                  const selected = Array.from(keys)[0];
                  if (typeof selected === 'string') setReviewStatus(selected);
                }}
                variant="secondary"
                isRequired
              >
                {reviewStatuses.map((status) => (
                  <SelectItem key={status} id={status}>
                    {t(`volunteering.review_status_${status}`)}
                  </SelectItem>
                ))}
              </Select>
              <Textarea
                label={t('volunteering.review_notes')}
                value={reviewNotes}
                onValueChange={setReviewNotes}
                variant="secondary"
                placeholder={t('volunteering.review_notes_placeholder')}
                minRows={3}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={onClose}>{t('volunteering.cancel')}</Button>
            <Button onPress={handleReview} isLoading={saving}>
              {t('volunteering.submit_review')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
