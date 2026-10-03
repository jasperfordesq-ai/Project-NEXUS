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
import { AdminEmbedAutoRefresh, useAdminEmbed } from '@/admin/components/AdminEmbedContext';
import { BrokerSkeleton } from '@/broker/components/BrokerSkeleton';
import ConfirmModal from '@/admin/components/ConfirmModal';
import { adminModeration } from '@/admin/api/adminApi';
import { adminSuper } from '@/admin/api/adminApi';
import type { AdminComment } from '@/admin/api/types';
import { ModerationCards, useModerationCards } from '../../components/ModerationCards';

export default function CommentsModeration() {
  const { t } = useTranslation('admin_moderation');
  usePageTitle(t('moderation.page_title'));
  const { embedded } = useAdminEmbed();

  const CONTENT_TYPES = [
    { label: t('moderation.filter_all_types'), value: '' },
    { label: t('moderation.post_type_post'), value: 'post' },
    { label: t('moderation.content_type_listing'), value: 'listing' },
    { label: t('moderation.content_type_event'), value: 'event' },
    { label: t('moderation.content_type_group'), value: 'group' },
  ];

  const toast = useToast();
  const { user } = useAuth();
  const isSuperAdmin =
    user?.role === 'super_admin' ||
    user?.is_super_admin === true ||
    user?.is_tenant_super_admin === true;

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [contentTypeFilter, setContentTypeFilter] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [activeContentType, setActiveContentType] = useState('');
  const [activeTenant, setActiveTenant] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'hide' | 'delete';
    comment: AdminComment;
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
      toast.error(t('moderation.failed_to_load_tenants'));
    });
  }, [isSuperAdmin, t, toast]);

  // Build query params for the endpoint
  const buildQueryString = () => {
    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('limit', '20');
    if (activeSearch) params.append('search', activeSearch);
    if (activeContentType) params.append('content_type', activeContentType);
    if (activeTenant && activeTenant !== 'all') params.append('tenant_id', activeTenant);
    return params.toString();
  };

  const { data, isLoading, error, execute, meta } = useApi<AdminComment[]>(
    `/v2/admin/comments?${buildQueryString()}`,
    { immediate: true, deps: [page, activeSearch, activeContentType, activeTenant] }
  );

  const handleSearch = () => {
    setActiveSearch(search);
    setActiveContentType(contentTypeFilter);
    setActiveTenant(tenantFilter);
    setPage(1);
  };

  const handleClear = () => {
    setSearch('');
    setContentTypeFilter('');
    setTenantFilter('');
    setActiveSearch('');
    setActiveContentType('');
    setActiveTenant('');
    setPage(1);
  };

  const handleAction = async () => {
    if (!confirmAction) return;

    setActionLoading(true);
    try {
      const response = confirmAction.type === 'hide'
        ? await adminModeration.hideComment(confirmAction.comment.id)
        : await adminModeration.deleteComment(confirmAction.comment.id);

      if (response.success) {
        toast.success(
          confirmAction.type === 'hide'
            ? t('moderation.comment_hidden_successfully')
            : t('moderation.comment_deleted_successfully')
        );
        setConfirmAction(null);
        execute();
      } else {
        toast.error(t('common.unexpected_error'));
      }
    } catch {
      toast.error(t('common.unexpected_error'));
    } finally {
      setActionLoading(false);
    }
  };

  const comments = data || [];
  // Embedded in the broker panel the first load is a shaped skeleton and a
  // reload keeps the current rows on screen, so auto-refresh never flashes.
  const showSkeleton = embedded && isLoading && data === null;
  const tableLoading = isLoading && !embedded;
  const totalPages = meta?.total_pages || 1;

  // Build cell content for a comment row
  const renderCells = (comment: AdminComment): React.ReactElement<React.ComponentProps<typeof TableCell>>[] => {
    const cells: React.ReactElement<React.ComponentProps<typeof TableCell>>[] = [
      <TableCell key="user">
        <div className="flex items-center gap-3">
          <Avatar
            src={comment.user_avatar || undefined}
            name={comment.user_name}
            size="sm"
            className="flex-shrink-0"
          />
          <div className="flex flex-col">
            <span className="text-sm font-medium">{comment.user_name}</span>
            <span className="text-xs text-muted">{t('moderation.member_id', { id: comment.user_id })}</span>
          </div>
        </div>
      </TableCell>,
    ];

    if (isSuperAdmin) {
      cells.push(
        <TableCell key="tenant">
          <Chip size="sm" variant="soft">
            {comment.tenant_name}
          </Chip>
        </TableCell>
      );
    }

    cells.push(
      <TableCell key="comment">
        <div className="max-w-md">
          <p className="text-sm line-clamp-2">{comment.content}</p>
          {comment.is_flagged && (
            <Chip size="sm" color="warning" variant="soft" className="mt-1">
              {t('moderation.flagged')}
            </Chip>
          )}
        </div>
      </TableCell>,
      <TableCell key="contentType">
        <Chip size="sm" variant="soft">
          {t(`moderation.content_type_${comment.content_type || 'comment'}`)}
        </Chip>
      </TableCell>,
      <TableCell key="created">
        <span className="whitespace-nowrap text-sm tabular-nums text-muted">
          {new Date(comment.created_at).toLocaleDateString(getFormattingLocale())}
        </span>
      </TableCell>,
      <TableCell key="actions">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="tertiary"
            color="warning"
            startContent={<EyeOff aria-hidden="true" className="w-4 h-4" />}
            onPress={() => setConfirmAction({ type: 'hide', comment })}
          >
            {t('moderation.hide')}
          </Button>
          <Button
            size="sm"
            variant="danger"
            startContent={<Trash2 aria-hidden="true" className="w-4 h-4" />}
            onPress={() => setConfirmAction({ type: 'delete', comment })}
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
      t('moderation.col_user'),
      t('moderation.label_tenant'),
      t('moderation.col_comment'),
      t('moderation.label_content_type'),
      t('moderation.col_created'),
      t('moderation.col_actions'),
    ]
    : [
      t('moderation.col_user'),
      t('moderation.col_comment'),
      t('moderation.label_content_type'),
      t('moderation.col_created'),
      t('moderation.col_actions'),
    ];

  return (
    <div className="space-y-6">
      <AdminEmbedAutoRefresh reload={() => void execute()} />
      <PageHeader
        title={t('moderation.comments_moderation_title')}
        description={isSuperAdmin ? t('moderation.comments_desc_super') : t('moderation.comments_desc')}
        actions={
          <Button
            variant="tertiary"
            startContent={<RefreshCw aria-hidden="true" className="w-4 h-4" />}
            onPress={() => execute()}
            isLoading={isLoading}
          >
            {t('common.refresh')}
          </Button>
        }
      />

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-4">
        <Input type="search" name="admin-search" autoComplete="off"
          placeholder={t('moderation.placeholder_search_comments_or_users')}
          aria-label={t('moderation.label_search_comments')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          startContent={<Search aria-hidden="true" className="w-4 h-4 text-muted" />}
          className="flex-1"
        />
        <Select
          label={t('moderation.label_content_type')}
          selectedKeys={contentTypeFilter ? [contentTypeFilter] : []}
          onChange={(e) => setContentTypeFilter(e.target.value)}
          className="w-full sm:w-48"
        >
          {CONTENT_TYPES.map((type) => (
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
              <SelectItem key="all" id="all">{t('moderation.all_tenants')}</SelectItem>,
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
          {isSuperAdmin && !activeTenant && ` (${t('moderation.all_tenants')})`}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div role="alert" className="bg-danger-50 dark:bg-danger-950 text-danger border border-danger rounded-lg p-4">
          {t('moderation.failed_to_load_comments')}
        </div>
      )}

      {/* Table */}
      {/* Phones get one card per row, built from the same cells (ModerationCards). */}
      {showSkeleton ? (
        <BrokerSkeleton variant="table" />
      ) : showCards ? (
        <ModerationCards
          ariaLabel={t('moderation.label_comments_table')}
          columns={columns}
          items={comments ?? []}
          getKey={(row) => row.id}
          renderCells={renderCells}
          isLoading={tableLoading}
          emptyContent={
            <div className="text-center py-8 text-muted">
              {activeSearch || activeContentType
                ? t('moderation.no_comments_match_filters')
                : t('moderation.no_comments_to_moderate')}
            </div>
          }
        />
      ) : (
        <Table aria-label={t('moderation.label_comments_table')}>
          <TableHeader>
            {columns.map((col) => (
              <TableColumn key={col}>{col}</TableColumn>
            ))}
          </TableHeader>
          <TableBody
            items={comments}
            isLoading={tableLoading}
            loadingContent={<Spinner />}
            emptyContent={
              <div className="text-center py-8 text-muted">
                {activeSearch || activeContentType
                  ? t('moderation.no_comments_match_filters')
                  : t('moderation.no_comments_to_moderate')}
              </div>
            }
          >
            {(comment) => (
              <TableRow key={comment.id}>
                {renderCells(comment)}
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
        title={confirmAction?.type === 'hide' ? t('moderation.hide_comment') : t('moderation.delete_comment')}
        message={
          confirmAction?.type === 'hide'
            ? t('moderation.confirm_hide_comment')
            : t('moderation.confirm_delete_comment')
        }
        confirmLabel={confirmAction?.type === 'hide' ? t('moderation.hide_comment') : t('moderation.delete_comment')}
        confirmColor={confirmAction?.type === 'hide' ? 'warning' : 'danger'}
        isLoading={actionLoading}
      />
    </div>
  );
}
