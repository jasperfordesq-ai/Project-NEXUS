// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ShieldOff from 'lucide-react/icons/shield-off';
import UserX from 'lucide-react/icons/user-x';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { EmptyState, LoadingScreen } from '@/components/feedback';
import { useToast, useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';

interface BlockedUser {
  block_id: number;
  user_id: number;
  name: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  reason: string | null;
  blocked_at: string;
}

export function BlockedUsersPage() {
  const { t } = useTranslation('settings');
  usePageTitle(t('blocked_users.title'));
  const toast = useToast();
  const { tenantPath } = useTenant();
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [unblockTarget, setUnblockTarget] = useState<BlockedUser | null>(null);
  const [isUnblocking, setIsUnblocking] = useState(false);

  const loadBlockedUsers = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError(false);
      const response = await api.get<BlockedUser[]>('/v2/users/blocked');
      // api.get resolves { success:false } on a 4xx WITHOUT throwing — without
      // this branch a failed load rendered "No blocked users" on a
      // privacy-critical screen, telling the user nobody is blocked when the
      // list simply failed to load.
      if (response.success && response.data) {
        setBlockedUsers(response.data);
      } else {
        setLoadError(true);
      }
    } catch (err) {
      logError('Failed to load blocked users', err);
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBlockedUsers();
  }, [loadBlockedUsers]);

  async function handleUnblock() {
    if (!unblockTarget) return;
    setIsUnblocking(true);
    try {
      const response = await api.delete(`/v2/users/${unblockTarget.user_id}/block`);
      if (response.success) {
        setBlockedUsers((prev) => prev.filter((u) => u.user_id !== unblockTarget.user_id));
        toast.success(
          t('blocked_users.unblocked'),
          t('blocked_users.unblocked_desc', { name: unblockTarget.name })
        );
      } else {
        // api.delete resolves { success:false } on a 4xx/5xx WITHOUT throwing (and a
        // 4xx raises no global toast), so without this branch a failed unblock just
        // closed the modal (via finally) as if it worked while the user stayed blocked.
        toast.error(t('error_title', { ns: 'common' }), t('blocked_users.unblock_error'));
      }
    } catch (err) {
      logError('Failed to unblock user', err);
      toast.error(t('error_title', { ns: 'common' }), t('blocked_users.unblock_error'));
    } finally {
      setIsUnblocking(false);
      setUnblockTarget(null);
    }
  }

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-0">
      <PageMeta title={t('blocked_users.title')} noIndex />

      {/* Back to the privacy settings, above the panel. */}
      <Button as={Link} to={tenantPath('/settings?tab=privacy')} isIconOnly variant="tertiary" aria-label={t('back', { ns: 'common' })}>
        <ArrowLeft className="h-5 w-5" aria-hidden="true" />
      </Button>

      {/* Header — the same soft panel in the community colour that opens the
          offers, events and groups pages (AWID: warmer, more inviting). Was a
          grey bordered card. */}
      <PublicPageHero
        size="compact"
        eyebrow={t('blocked_users.privacy_badge')}
        title={t('blocked_users.title')}
        description={t('blocked_users.subtitle')}
        icon={<ShieldOff className="h-6 w-6" aria-hidden="true" />}
        accent="rose"
        action={!loadError ? (
          <div className="rounded-xl border border-theme-default bg-theme-elevated px-4 py-3 lg:min-w-64">
            <span className="block text-xs font-medium uppercase tracking-wide text-theme-subtle">{t('blocked_users.summary_label')}</span>
            <span className="mt-1 block font-semibold text-theme-primary">{t('blocked_users.count', { count: blockedUsers.length })}</span>
          </div>
        ) : undefined}
      />

      {/* List — never show the "No blocked users" empty state on a failed load */}
      {loadError ? (
        <GlassCard role="alert" className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('blocked_users.load_error')}</h2>
          <p className="text-theme-muted mb-4">{t('blocked_users.load_error_desc')}</p>
          <Button
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={loadBlockedUsers}
          >
            {t('blocked_users.retry')}
          </Button>
        </GlassCard>
      ) : blockedUsers.length === 0 ? (
        <EmptyState
          icon={<UserX className="w-12 h-12" />}
          title={t('blocked_users.empty')}
          description={t('blocked_users.empty_desc')}
        />
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="grid gap-3"
        >
          {blockedUsers.map((user) => (
            <GlassCard key={user.user_id} className="p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <Avatar
                  src={resolveAvatarUrl(user.avatar_url)}
                  name={user.name}
                  size="md"
                  className="ring-2 ring-theme-default"
                />
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-theme-primary truncate">{user.name}</h3>
                  <p className="text-xs text-theme-subtle">
                    {t('blocked_users.blocked_on', {
                      date: new Date(user.blocked_at).toLocaleDateString(getFormattingLocale(), {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      }),
                    })}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="danger-soft"
                  className="bg-red-500/10 text-red-600 dark:text-red-400 sm:ml-auto"
                  onPress={() => setUnblockTarget(user)}
                >
                  {t('blocked_users.unblock')}
                </Button>
              </div>
            </GlassCard>
          ))}
        </motion.div>
      )}

      {/* Unblock confirmation modal */}
      <Modal
        isOpen={!!unblockTarget}
        onClose={() => setUnblockTarget(null)}
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
        }}
      >
        <ModalContent>
          <ModalHeader className="text-theme-primary">
            {t('blocked_users.unblock_confirm', { name: unblockTarget?.name })}
          </ModalHeader>
          <ModalBody>
            <p className="text-theme-muted">
              {t('blocked_users.unblock_confirm_body')}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setUnblockTarget(null)}>
              {t('cancel', { ns: 'common' })}
            </Button>
            <Button
              onPress={handleUnblock}
              isLoading={isUnblocking}
            >
              {t('blocked_users.unblock')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default BlockedUsersPage;
