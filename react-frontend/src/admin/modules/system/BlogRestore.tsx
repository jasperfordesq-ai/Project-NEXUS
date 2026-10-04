import { getFormattingLocale } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Button, Spinner } from '@/components/ui';
import { useState, useEffect, useCallback } from 'react';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import FileArchive from 'lucide-react/icons/file-archive';
import Download from 'lucide-react/icons/download';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmModal } from '../../components/ConfirmModal';
import { adminTools } from '../../api/adminApi';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Blog Restore
 * Tool for restoring deleted or corrupted blog posts from backups.
 * Loads real backup entries from the API and uses a ConfirmModal before restoring.
 */


interface BlogBackup {
  id: number;
  filename: string;
  created_at: string;
  size: string;
}

export function BlogRestore() {
  const { t } = useTranslation('admin_system');
  usePageTitle(t('system.page_title'));
  const toast = useToast();

  const [backups, setBackups] = useState<BlogBackup[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [confirmBackup, setConfirmBackup] = useState<BlogBackup | null>(null);

  const fetchBackups = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminTools.getBlogBackups();
      if (res.success && res.data) {
        // Handle both direct array and wrapped { data: [...] } responses
        const payload = res.data as unknown;
        if (Array.isArray(payload)) {
          setBackups(payload);
        } else if (payload && typeof payload === 'object' && 'data' in payload) {
          setBackups((payload as { data: BlogBackup[] }).data);
        } else {
          setBackups([]);
        }
      } else {
        setBackups([]);
      }
    } catch {
      toast.error(t('system.failed_to_load_blog_backups'));
    } finally {
      setLoading(false);
    }
  }, [t, toast])


  useEffect(() => {
    fetchBackups();
  }, [fetchBackups]);

  const handleRestoreConfirm = useCallback(async () => {
    if (!confirmBackup) return;
    setRestoringId(confirmBackup.id);
    setConfirmBackup(null);
    try {
      const res = await adminTools.restoreBlogBackup(confirmBackup.id);
      if (res.success) {
        const restored = (res.data as { restored_count?: number })?.restored_count;
        const message = restored !== undefined
          ? t('system.blog_posts_restored', { count: restored, filename: confirmBackup.filename })
          : t('system.blog_data_restored', { filename: confirmBackup.filename });
        toast.success(t('system.restore_complete'), message);
        // Refresh the backup list in case status changed
        await fetchBackups();
      } else {
        toast.error(t('system.restore_failed'), t('system.restore_server_error'));
      }
    } catch {
      toast.error(t('system.restore_failed'), t('system.restore_error_occurred'));
    } finally {
      setRestoringId(null);
    }
  }, [confirmBackup, t, toast, fetchBackups])


  if (loading) {
    return (
      <div>
        <PageHeader title={t('system.blog_restore_title')} description={t('system.blog_restore_desc')} />
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={t('system.blog_restore_title')} description={t('system.blog_restore_desc')} />

      <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 mb-4 flex items-start gap-3">
        <AlertTriangle size={20} className="text-warning shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-warning-soft-foreground">{t('system.use_with_caution')}</p>
          <p className="text-sm text-warning-soft-foreground">{t('system.blog_restore_warning')}</p>
        </div>
      </div>

      {backups.length === 0 ? (
        <EmptyState
          icon={RotateCcw}
          title={t('system.no_backups_available')}
          description={t('system.desc_blog_post_backups_will_appear_here_when_')}
        />
      ) : (
        <Card >
          <CardHeader>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <FileArchive size={20} /> {t('system.available_backups', { count: backups.length })}
            </h3>
          </CardHeader>
          <CardBody>
            <div className="space-y-2">
              {backups.map((backup) => (
                <div
                  key={backup.id}
                  className="flex items-center justify-between rounded-lg border border-border p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-secondary">
                      <FileArchive size={20} className="text-muted" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{backup.filename}</p>
                      <p className="text-xs text-muted">
                        {new Date(backup.created_at).toLocaleString(getFormattingLocale())} &middot; {backup.size}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="tertiary"
                    startContent={<Download size={14} />}
                    onPress={() => setConfirmBackup(backup)}
                    isLoading={restoringId === backup.id}
                    isDisabled={restoringId !== null}
                  >
                    {t('system.restore')}
                  </Button>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      <ConfirmModal
        isOpen={confirmBackup !== null}
        onClose={() => setConfirmBackup(null)}
        onConfirm={handleRestoreConfirm}
        title={t('system.restore_blog_backup')}
        message={
          confirmBackup
            ? t('system.restore_blog_confirm', { filename: confirmBackup.filename })
            : ''
        }
        confirmLabel={t('system.restore_backup')}
        confirmColor="warning"
        isLoading={restoringId !== null}
      />
    </div>
  );
}

export default BlogRestore;
