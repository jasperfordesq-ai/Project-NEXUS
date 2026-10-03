import { getFormattingLocale } from '@/lib/helpers';
import { Select, SelectItem, Button, Chip, Spinner, Input, Avatar, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Pagination } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React, { useState, useEffect } from 'react';

import Search from 'lucide-react/icons/search';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import EyeOff from 'lucide-react/icons/eye-off';
import Trash2 from 'lucide-react/icons/trash-2';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import PageHeader from '@/admin/components/PageHeader';
import ConfirmModal from '@/admin/components/ConfirmModal';
import { adminModeration } from '@/admin/api/adminApi';
import { adminSuper } from '@/admin/api/adminApi';
import { canModerateContent } from '@/lib/roles';
import { htmlToPlainText } from '@/lib/sanitize';
import type { AdminFeedPost } from '@/admin/api/types';
import { ModerationCards, useModerationCards } from '../../components/ModerationCards';

export default function FeedModeration() {
  const { t } = useTranslation('admin_moderation');
  usePageTitle(t('moderation.page_title'));

  const POST_TYPES = [
    { label: t('moderation.filter_all_types'), value: '' },
    { label: t('moderation.post_type_text'), value: 'post' },
    { label: t('moderation.post_type_poll'), value: 'poll' },
    { label: t('moderation.content_type_event'), value: 'event' },
    { label: t('moderation.content_type_listing'), value: 'listing' },
    { label: t('moderation.post_type_goal'), value: 'goal' },
    { label: t('moderation.content_type_review'), value: 'review' },
    { label: t('moderation.post_type_job'), value: 'job' },
    { label: t('moderation.post_type_challenge'), value: 'challenge' },
    { label: t('moderation.post_type_volunteer'), value: 'volunteer' },
    { label: t('moderation.post_type_blog'), value: 'blog' },
    { label: t('moderation.post_type_discussion'), value: 'discussion' },
  ];

  const toast = useToast();
  const { user } = useAuth();
  const isSuperAdmin =
    user?.role === 'super_admin' ||
    user?.is_super_admin === true ||
    user?.is_tenant_super_admin === true;

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [activeType, setActiveType] = useState('');
  const [activeTenant, setActiveTenant] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'hide' | 'delete';
    post: AdminFeedPost;
  } | null>(null);
  const [tenants, setTenants] = useState<Array<{ id: number; name: string }>>([]);

  // Load tenants list for super admin filter
  useEffect(() => {
    if (!isSuperAdmin) return;
    adminSuper.listTenants().then((res) => {
      if (res.success && Array.isArray(res.data)) {
        setTenants(res.data.map((tenant) => ({
          id: Number(tenant.id),
          name: String(tenant.name || t('moderation.unknown_tenant')),
        })));
      }
    }).catch(() => {
      // Tenant list is optional; silently fail
    });
  }, [isSuperAdmin, t]);

  // Build query params for the endpoint
  const buildQueryString = () => {
    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('limit', '20');
    if (activeSearch) params.append('search', activeSearch);
    if (activeType) params.append('type', activeType);
    if (activeTenant && activeTenant !== 'all') params.append('tenant_id', activeTenant);
    return params.toString();
  };

  const { data, isLoading, error, execute, meta } = useApi<AdminFeedPost[]>(
    `/v2/admin/feed/posts?${buildQueryString()}`,
    { immediate: true, deps: [page, activeSearch, activeType, activeTenant] }
  );

  const handleSearch = () => {
    setActiveSearch(search);
    setActiveType(typeFilter);
    setActiveTenant(tenantFilter);
    setPage(1);
  };

  const handleClear = () => {
    setSearch('');
    setTypeFilter('');
    setTenantFilter('');
    setActiveSearch('');
    setActiveType('');
    setActiveTenant('');
    setPage(1);
  };

  const handleAction = async () => {
    if (!confirmAction) return;

    // Re-validate authorization before performing any moderation action.
    // This MUST mirror the backend `requireBrokerOrAdmin()` guard on the
    // /v2/admin/feed/* endpoints (admin-tier OR broker/coordinator) — see
    // canModerateContent(). The previous inline check accepted only
    // admin/super_admin/moderator, so a `tenant_admin` or `broker` was blocked
    // CLIENT-SIDE with an "Unauthorized" toast and the DELETE never reached the
    // server — the root cause of the recurring "admin can't delete a feed post"
    // bug in the broker panel (this screen is reused at /broker/moderation/feed).
    if (!canModerateContent(user)) {
      toast.error(t('moderation.unauthorized'));
      setConfirmAction(null);
      return;
    }

    setActionLoading(true);
    try {
      const postType = confirmAction.post.type || 'post';
      const response = confirmAction.type === 'hide'
        ? await adminModeration.hideFeedPost(confirmAction.post.id, postType)
        : await adminModeration.deleteFeedPost(confirmAction.post.id, postType);

      if (response.success) {
        toast.success(
          confirmAction.type === 'hide'
            ? t('moderation.post_hidden_successfully')
            : t('moderation.post_deleted_successfully')
        );
        setConfirmAction(null);
        execute();
      } else {
        toast.error(t('something_wrong'));
      }
    } catch {
      toast.error(t('something_wrong'));
    } finally {
      setActionLoading(false);
    }
  };

  const posts = data || [];
  const totalPages = meta?.total_pages || 1;

  // Build cell content for a post row
  const renderCells = (post: AdminFeedPost): React.ReactElement<React.ComponentProps<typeof TableCell>>[] => {
    const cells: React.ReactElement<React.ComponentProps<typeof TableCell>>[] = [
      <TableCell key="user">
        <div className="flex items-center gap-3">
          <Avatar
            src={post.user_avatar || undefined}
            name={post.user_name}
            size="sm"
            className="flex-shrink-0"
          />
          <div className="flex flex-col">
            <span className="text-sm font-medium">{post.user_name}</span>
            <span className="text-xs text-muted">{t('moderation.member_id', { id: post.user_id })}</span>
          </div>
        </div>
      </TableCell>,
    ];

    if (isSuperAdmin) {
      cells.push(
        <TableCell key="tenant">
          <Chip size="sm" variant="soft" color="default">
            {post.tenant_name}
          </Chip>
        </TableCell>
      );
    }

    cells.push(
      <TableCell key="content">
        <div className="max-w-md">
          {post.title && <p className="text-sm font-medium line-clamp-1">{post.title}</p>}
          {post.content && <p className="text-sm line-clamp-2">{htmlToPlainText(post.content)}</p>}
          {post.is_flagged && (
            <Chip size="sm" color="warning" variant="soft" className="mt-1">
              {t('moderation.flagged')}
            </Chip>
          )}
        </div>
      </TableCell>,
      <TableCell key="type">
        <Chip size="sm" variant="soft">
          {t(`moderation.post_type_${post.type || 'text'}`)}
        </Chip>
      </TableCell>,
      <TableCell key="status">
        {post.is_hidden ? (
          <Chip size="sm" color="warning" variant="soft">{t('moderation.hidden')}</Chip>
        ) : (
          <Chip size="sm" color="success" variant="soft">{t('moderation.visible')}</Chip>
        )}
      </TableCell>,
      <TableCell key="created">
        <span className="whitespace-nowrap text-sm tabular-nums text-muted">
          {new Date(post.created_at).toLocaleDateString(getFormattingLocale())}
        </span>
      </TableCell>,
      <TableCell key="actions">
        <div className="flex items-center gap-2">
          {!post.is_hidden && (
            <Button
              size="sm"
              variant="tertiary"
              color="warning"
              startContent={<EyeOff aria-hidden="true" className="w-4 h-4" />}
              onPress={() => setConfirmAction({ type: 'hide', post })}
            >
              {t('moderation.hide')}
            </Button>
          )}
          <Button
            size="sm"
            variant="danger"
            startContent={<Trash2 aria-hidden="true" className="w-4 h-4" />}
            onPress={() => setConfirmAction({ type: 'delete', post })}
          >
            {t('moderation.delete')}
          </Button>
        </div>
      </TableCell>
    );

    return cells;
  };

  // Determine columns based on super admin status
  const showCards = useModerationCards();
  const columns = isSuperAdmin
    ? [
        { key: 'user', label: t('moderation.col_user') },
        { key: 'tenant', label: t('moderation.label_tenant') },
        { key: 'content', label: t('moderation.label_content') },
        { key: 'type', label: t('moderation.label_post_type') },
        { key: 'status', label: t('moderation.label_status') },
        { key: 'created', label: t('moderation.col_created') },
        { key: 'actions', label: t('moderation.col_actions') },
      ]
    : [
        { key: 'user', label: t('moderation.col_user') },
        { key: 'content', label: t('moderation.label_content') },
        { key: 'type', label: t('moderation.label_post_type') },
        { key: 'status', label: t('moderation.label_status') },
        { key: 'created', label: t('moderation.col_created') },
        { key: 'actions', label: t('moderation.col_actions') },
      ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('moderation.feed_moderation_title')}
        description={isSuperAdmin ? t('moderation.feed_desc_super') : t('moderation.feed_desc')}
        actions={
          <Button
            variant="tertiary"
            startContent={<RefreshCw aria-hidden="true" className="w-4 h-4" />}
            onPress={() => execute()}
            isLoading={isLoading}
          >
            {t('moderation.refresh')}
          </Button>
        }
      />

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-4">
        <Input type="search" name="admin-search" autoComplete="off"
          placeholder={t('moderation.placeholder_search_posts_or_users')}
          aria-label={t('moderation.label_search_posts')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          startContent={<Search aria-hidden="true" className="w-4 h-4 text-muted" />}
          className="flex-1"
        />
        <Select
          label={t('moderation.label_post_type')}
          selectedKeys={typeFilter ? [typeFilter] : []}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="w-full sm:w-48"
        >
          {POST_TYPES.map((type) => (
            <SelectItem key={type.value} id={type.value}>
              {type.label}
            </SelectItem>
          ))}
        </Select>
        {isSuperAdmin && (
          <Select
            label={t('moderation.label_tenant')}
            selectedKeys={tenantFilter ? [tenantFilter] : []}
            onChange={(e) => setTenantFilter(e.target.value)}
            className="w-full sm:w-56"
          >
            {[
              <SelectItem key="all" id="all">{t('moderation.filter_all_tenants')}</SelectItem>,
              ...tenants.map((t) => (
                <SelectItem key={t.id.toString()} id={t.id.toString()}>
                  {t.name}
                </SelectItem>
              )),
            ]}
          </Select>
        )}
        <div className="flex gap-2">
          <Button onPress={handleSearch}>
            {t('moderation.apply')}
          </Button>
          <Button variant="tertiary" onPress={handleClear}>
            {t('moderation.clear')}
          </Button>
        </div>
      </div>

      {/* Stats */}
      {meta && (
        <div className="text-sm text-muted">
          {t('moderation.showing_count', { shown: data?.length ?? 0, total: meta.total ?? meta.total_items ?? data?.length ?? 0 })}
          {isSuperAdmin && !activeTenant && ` (${t('moderation.filter_all_tenants')})`}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div role="alert" className="bg-danger-50 dark:bg-danger-950 text-danger border border-danger rounded-lg p-4">
          {t('moderation.failed_to_load_posts')}
        </div>
      )}

      {/* Table */}
      {/* Phones get one card per row, built from the same cells (ModerationCards). */}
      {showCards ? (
        <ModerationCards
          ariaLabel={t('moderation.label_feed_posts_table')}
          columns={columns}
          items={posts ?? []}
          getKey={(row) => row.id}
          renderCells={renderCells}
          isLoading={isLoading}
          emptyContent={
            <div className="text-center py-8 text-muted">
              {activeSearch || activeType ? t('moderation.no_posts_match_filters') : t('moderation.no_posts_to_moderate')}
            </div>
          }
        />
      ) : (
        <Table aria-label={t('moderation.label_feed_posts_table')}>
          <TableHeader>
            {columns.map((col) => (
              <TableColumn key={col.key}>{col.label}</TableColumn>
            ))}
          </TableHeader>
          <TableBody
            items={posts}
            isLoading={isLoading}
            loadingContent={<Spinner />}
            emptyContent={
              <div className="text-center py-8 text-muted">
                {activeSearch || activeType ? t('moderation.no_posts_match_filters') : t('moderation.no_posts_to_moderate')}
              </div>
            }
          >
            {(post) => (
              <TableRow key={post.id}>
                {renderCells(post)}
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination
            total={totalPages}
            page={page}
            onChange={setPage}
            showControls
          />
        </div>
      )}

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleAction}
        title={confirmAction?.type === 'hide' ? t('moderation.hide_post') : t('moderation.delete_post')}
        message={
          confirmAction?.type === 'hide'
            ? t('moderation.confirm_hide_post')
            : t('moderation.confirm_delete_post')
        }
        confirmLabel={confirmAction?.type === 'hide' ? t('moderation.hide_post') : t('moderation.delete_post')}
        confirmColor={confirmAction?.type === 'hide' ? 'warning' : 'danger'}
        isLoading={actionLoading}
      />
    </div>
  );
}
