// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Federation Connections Page
 * Route: /federation/connections
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from '@/lib/motion';

import UserPlus from 'lucide-react/icons/user-plus';
import UserCheck from 'lucide-react/icons/user-check';
import Clock from 'lucide-react/icons/clock';
import Send from 'lucide-react/icons/send';
import Globe from 'lucide-react/icons/globe';
import MessageSquare from 'lucide-react/icons/message-square';
import Trash2 from 'lucide-react/icons/trash-2';
import Check from 'lucide-react/icons/check';
import X from 'lucide-react/icons/x';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { Tab, Tabs } from '@/components/ui/Tabs';
import { Breadcrumbs } from '@/components/navigation';
import { PageMeta } from '@/components/seo';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { resolveAvatarUrl, formatRelativeTime } from '@/lib/helpers';
import { logError } from '@/lib/logger';
import type { FederationConnection } from '@/types/api';

type TabKey = 'accepted' | 'pending_received' | 'pending_sent';

export function FederationConnectionsPage() {
  const { t } = useTranslation('federation');
  usePageTitle(t('connections.page_title'));
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<TabKey>('accepted');
  const [connections, setConnections] = useState<FederationConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const loadConnections = useCallback(async (tab: TabKey) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      const response = await api.get<FederationConnection[]>(
        `/v2/federation/connections?status=${tab}`,
        { signal: controller.signal }
      );
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setConnections(response.data);
        setLoadError(false);
      } else {
        setConnections([]);
        setLoadError(true);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load federation connections', err);
      setConnections([]);
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConnections(activeTab);
  }, [activeTab, loadConnections]);

  const handleTabChange = (key: React.Key) => {
    setActiveTab(key as TabKey);
  };
  const handleAction = async (
    connectionId: number,
    action: 'accept' | 'reject' | 'remove',
  ) => {
    try {
      setActionLoading(connectionId);
      let response;
      if (action === 'remove') {
        response = await api.delete(`/v2/federation/connections/${connectionId}`);
      } else {
        response = await api.post(`/v2/federation/connections/${connectionId}/${action}`);
      }
      if (response.success) {
        const msgs: Record<string, string> = {
          accept: tRef.current('connections.accepted_success'),
          reject: tRef.current('connections.rejected_success'),
          remove: tRef.current('connections.removed_success'),
        };
        toastRef.current.success(msgs[action] ?? '');
        loadConnections(activeTab);
      } else {
        toastRef.current.error(tRef.current('connections.action_failed'));
      }
    } catch (err) {
      logError(`Failed to ${action} connection`, err);
      toastRef.current.error(tRef.current('connections.action_failed'));
    } finally {
      setActionLoading(null);
    }
  };
  return (
    <div className="space-y-6">
      <PageMeta title={t('connections.page_title')} noIndex />
      <Breadcrumbs
        items={[
          { label: t('connections.breadcrumb_federation'), href: tenantPath('/federation') },
          { label: t('connections.breadcrumb_connections') },
        ]}
      />

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-theme-primary">
            {t('connections.title')}
          </h1>
          <p className="text-theme-muted mt-1">
            {t('connections.subtitle')}
          </p>
        </div>
      </div>

      <Tabs
        aria-label={t('connections.tabs_aria')}
        selectedKey={activeTab}
        onSelectionChange={handleTabChange}
        variant="underlined"
        classNames={{
          tabList: 'gap-4',
          tab: 'text-theme-muted data-[selected=true]:text-accent!',
          cursor: 'bg-accent',
        }}
      >
        <Tab key="accepted" title={<div className="flex items-center gap-2"><UserCheck className="w-4 h-4" />{t('connections.tab_connected')}</div>} />
        <Tab key="pending_received" title={<div className="flex items-center gap-2"><Clock className="w-4 h-4" />{t('connections.tab_received')}</div>} />
        <Tab key="pending_sent" title={<div className="flex items-center gap-2"><Send className="w-4 h-4" />{t('connections.tab_sent')}</div>} />
      </Tabs>

      {isLoading ? (
        <div role="status" aria-busy="true" aria-label={t('connections.loading')} className="flex items-center justify-center py-16">
          <Spinner size="lg" label={t('connections.loading')} />
        </div>
      ) : loadError ? (
        <GlassCard role="alert" className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <p className="text-theme-muted mb-4">{t('connections.load_error')}</p>
          <Button
            color="primary"
            onPress={() => loadConnections(activeTab)}
          >
            {t('connections.try_again')}
          </Button>
        </GlassCard>
      ) : connections.length === 0 ? (
        <GlassCard className="p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200 flex items-center justify-center mx-auto mb-4">
            {activeTab === 'accepted' && <UserCheck className="w-8 h-8" aria-hidden="true" />}
            {activeTab === 'pending_received' && <UserPlus className="w-8 h-8" aria-hidden="true" />}
            {activeTab === 'pending_sent' && <Send className="w-8 h-8" aria-hidden="true" />}
          </div>
          <h3 className="text-lg font-semibold text-theme-primary mb-2">
            {activeTab === 'accepted' && t('connections.empty_connected')}
            {activeTab === 'pending_received' && t('connections.empty_received')}
            {activeTab === 'pending_sent' && t('connections.empty_sent')}
          </h3>
          <p className="text-theme-muted mb-4">
            {activeTab === 'accepted' && t('connections.empty_connected_desc')}
            {activeTab === 'pending_received' && t('connections.empty_received_desc')}
            {activeTab === 'pending_sent' && t('connections.empty_sent_desc')}
          </p>
          {activeTab === 'accepted' && (
            <Button color="primary" startContent={<Globe className="w-4 h-4" aria-hidden="true" />} onPress={() => navigate(tenantPath('/federation/members'))}>
              {t('connections.browse_members')}
            </Button>
          )}
        </GlassCard>      ) : (
        <div className="grid gap-4">
          <AnimatePresence mode="popLayout">
            {connections.map((conn, index) => (
              <motion.div key={conn.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -100 }} transition={{ delay: index * 0.05 }}>
                <ConnectionCard connection={conn} tab={activeTab} actionLoading={actionLoading} onAction={handleAction}
                  onMessage={(userId, tenantId) => navigate(tenantPath(`/federation/messages?compose=true&to_user=${userId}&to_tenant=${tenantId}`))}
                  onViewProfile={(userId, tenantId) => navigate(tenantPath(`/federation/members/${userId}?tenant_id=${encodeURIComponent(String(tenantId))}`))}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
interface ConnectionCardProps {
  connection: FederationConnection;
  tab: TabKey;
  actionLoading: number | null;
  onAction: (id: number, action: 'accept' | 'reject' | 'remove') => void;
  onMessage: (userId: number, tenantId: number) => void;
  onViewProfile: (userId: number, tenantId: number) => void;
}

function ConnectionCard({ connection, tab, actionLoading, onAction, onMessage, onViewProfile }: ConnectionCardProps) {
  const { t } = useTranslation('federation');
  const isActioning = actionLoading === connection.id;
  const displayName = connection.name || t('connections.unknown_member');

  return (
    <GlassCard className="p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row items-start gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer" onClick={() => onViewProfile(connection.user_id, connection.tenant_id)} role="button" tabIndex={0} aria-label={displayName} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onViewProfile(connection.user_id, connection.tenant_id); } }}>
          <div className="relative flex-shrink-0">
            <Avatar src={resolveAvatarUrl(connection.avatar_url)} name={displayName} className="w-12 h-12 ring-2 ring-accent/20" />
            <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-accent-strong flex items-center justify-center ring-1 ring-white dark:ring-gray-900" title={connection.tenant_name}>
              <Globe className="w-3 h-3 text-white" aria-hidden="true" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-theme-primary truncate">{displayName}</p>
            <div className="flex items-center gap-2 text-sm text-theme-muted">
              <Globe className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
              <span className="truncate">{connection.tenant_name}</span>
            </div>
            {connection.message && tab === 'pending_received' && (
              <p className="text-sm text-theme-muted mt-1 line-clamp-2 italic">&#8220;{connection.message}&#8221;</p>
            )}
            <p className="text-xs text-theme-muted mt-1">{formatRelativeTime(connection.created_at)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto">
          {tab === 'accepted' && (
            <>
              <Button size="sm" variant="flat" color="primary" startContent={<MessageSquare className="w-3.5 h-3.5" />} onPress={() => onMessage(connection.user_id, connection.tenant_id)}>
                {t('connections.message')}
              </Button>
              <Button size="sm" variant="flat" className="text-danger" isIconOnly isLoading={isActioning} onPress={() => onAction(connection.id, 'remove')} aria-label={t('connections.remove')}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </>
          )}
          {tab === 'pending_received' && (
            <>
              <Button size="sm" color="primary" startContent={<Check className="w-3.5 h-3.5" />} isLoading={isActioning} onPress={() => onAction(connection.id, 'accept')}>
                {t('connections.accept')}
              </Button>
              <Button size="sm" variant="flat" className="text-danger" startContent={<X className="w-3.5 h-3.5" />} isLoading={isActioning} onPress={() => onAction(connection.id, 'reject')}>
                {t('connections.decline')}
              </Button>
            </>
          )}
          {tab === 'pending_sent' && (
            <Chip size="sm" variant="flat" className="bg-amber-500/10 text-amber-600 dark:text-amber-400" startContent={<Clock className="w-3 h-3" />}>
              {t('connections.pending')}
            </Chip>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

export default FederationConnectionsPage;
