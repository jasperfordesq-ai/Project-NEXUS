import { getFormattingLocale } from '@/lib/helpers';
import { Button, Card, CardBody, CardHeader, Chip, Input, Spinner, Textarea, Select, SelectItem, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Tooltip, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow, useConfirm } from '@/components/ui';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Copy from 'lucide-react/icons/copy';
import Info from 'lucide-react/icons/info';
import KeyRound from 'lucide-react/icons/key-round';
import Plus from 'lucide-react/icons/plus';
import Power from 'lucide-react/icons/power';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Server from 'lucide-react/icons/server';
import Trash2 from 'lucide-react/icons/trash-2';
import { BrokerEmptyState } from '@/broker/components';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { PageHeader } from '../../components/PageHeader';
import { safeHref } from '@/lib/safeHref';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * FederationPeersAdminPage — AG23 follow-up
 *
 * Admin console for cross-platform federation peers. Each peer is a remote
 * NEXUS install this cooperative has agreed to send/receive hour transfers
 * with. The shared secret is shown ONCE on creation or rotation — copy it
 * to the remote side immediately.
 *
 */


type PeerStatus = 'pending' | 'active' | 'suspended';

interface Peer {
  id: number;
  peer_slug: string;
  display_name: string;
  base_url: string;
  shared_secret: string | null;
  shared_secret_set: boolean;
  status: PeerStatus;
  notes: string | null;
  last_handshake_at: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_COLOR: Record<PeerStatus, 'default' | 'success' | 'warning' | 'danger'> = {
  pending:   'warning',
  active:    'success',
  suspended: 'danger',
};

export default function FederationPeersAdminPage() {
  const { t } = useTranslation(['admin_caring_community', 'common']);
  const confirm = useConfirm();
  usePageTitle(t('federation_peers_admin.meta.page_title'));
  const { showToast } = useToast();

  const [peers, setPeers] = useState<Peer[]>([]);
  const [loading, setLoading] = useState(true);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [peerSlug, setPeerSlug] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://');
  const [notes, setNotes] = useState('');

  // Secret-reveal modal (after create / rotate)
  const [secretReveal, setSecretReveal] = useState<{ peerSlug: string; baseUrl: string; secret: string } | null>(null);

  // ── Fetch ────────────────────────────────────────────────────────────────

  const fetchPeers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ peers: Peer[] }>('/v2/admin/caring-community/federation-peers');
      setPeers(res.data?.peers ?? []);
    } catch (err) {
      logError('FederationPeersAdminPage.fetch', err);
      showToast(t('federation_peers_admin.toasts.load_failed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    void fetchPeers();
  }, [fetchPeers]);

  // ── Create ───────────────────────────────────────────────────────────────

  const resetForm = () => {
    setPeerSlug('');
    setDisplayName('');
    setBaseUrl('https://');
    setNotes('');
  };

  async function handleCreate() {
    if (!peerSlug.trim() || !displayName.trim() || !baseUrl.trim()) {
      showToast(t('federation_peers_admin.validation.required_fields'), 'error');
      return;
    }
    setCreating(true);
    try {
      const res = await api.post<Peer>('/v2/admin/caring-community/federation-peers', {
        peer_slug: peerSlug.trim().toLowerCase(),
        display_name: displayName.trim(),
        base_url: baseUrl.trim().replace(/\/+$/, ''),
        notes: notes.trim() || null,
      });
      const peer = res.data;
      if (peer && peer.shared_secret) {
        setSecretReveal({
          peerSlug: peer.peer_slug,
          baseUrl: peer.base_url,
          secret: peer.shared_secret,
        });
      }
      showToast(t('federation_peers_admin.toasts.created'), 'success');
      setCreateOpen(false);
      resetForm();
      void fetchPeers();
    } catch (err) {
      logError('FederationPeersAdminPage.create', err);
      showToast(t('federation_peers_admin.toasts.create_failed'), 'error');
    } finally {
      setCreating(false);
    }
  }

  // ── Status / rotate / delete ─────────────────────────────────────────────

  async function handleStatus(peer: Peer, status: PeerStatus) {
    try {
      const res = await api.put(`/v2/admin/caring-community/federation-peers/${peer.id}/status`, { status });
      if (res.success) {
        showToast(t('federation_peers_admin.toasts.status_updated', { status: t(`federation_peers_admin.status.${status}`) }), 'success');
        void fetchPeers();
      } else {
        showToast(t('federation_peers_admin.toasts.status_failed'), 'error');
      }
    } catch (err) {
      logError('FederationPeersAdminPage.status', err);
      showToast(t('federation_peers_admin.toasts.status_failed'), 'error');
    }
  }

  async function handleRotate(peer: Peer) {
    const ok = await confirm({
      title: t('federation_peers_admin.confirm_rotate', { name: peer.display_name }),
      status: 'warning',
      confirmLabel: t('common:confirm'),
    });
    if (!ok) {
      return;
    }
    try {
      const res = await api.post<Peer>(`/v2/admin/caring-community/federation-peers/${peer.id}/rotate-secret`, {});
      const updated = res.data;
      if (updated && updated.shared_secret) {
        setSecretReveal({
          peerSlug: updated.peer_slug,
          baseUrl: updated.base_url,
          secret: updated.shared_secret,
        });
      }
      showToast(t('federation_peers_admin.toasts.secret_rotated'), 'success');
      void fetchPeers();
    } catch (err) {
      logError('FederationPeersAdminPage.rotate', err);
      showToast(t('federation_peers_admin.toasts.rotate_failed'), 'error');
    }
  }

  async function handleDelete(peer: Peer) {
    const ok = await confirm({
      title: t('federation_peers_admin.confirm_delete', { name: peer.display_name }),
      status: 'danger',
      confirmLabel: t('common:delete'),
    });
    if (!ok) {
      return;
    }
    try {
      const res = await api.delete(`/v2/admin/caring-community/federation-peers/${peer.id}`);
      if (res.success) {
        showToast(t('federation_peers_admin.toasts.deleted'), 'success');
        void fetchPeers();
      } else {
        showToast(t('federation_peers_admin.toasts.delete_failed'), 'error');
      }
    } catch (err) {
      logError('FederationPeersAdminPage.delete', err);
      showToast(t('federation_peers_admin.toasts.delete_failed'), 'error');
    }
  }

  function copyToClipboard(value: string) {
    void navigator.clipboard.writeText(value).then(
      () => showToast(t('federation_peers_admin.toasts.copied'), 'success'),
      () => showToast(t('federation_peers_admin.toasts.copy_failed'), 'error'),
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('federation_peers_admin.meta.title')}
        subtitle={t('federation_peers_admin.meta.subtitle')}
        icon={<Server size={20} />}
        actions={
          <div className="flex items-center gap-2">
            <Tooltip content={t('federation_peers_admin.actions.refresh')}>
              <Button
                isIconOnly
                size="sm"
                variant="tertiary"
                onPress={() => void fetchPeers()}
                isLoading={loading}
                aria-label={t('federation_peers_admin.actions.refresh_aria')}
              >
                <RefreshCw size={15} />
              </Button>
            </Tooltip>
            <Button
              size="sm"
              startContent={<Plus size={15} />}
              onPress={() => { resetForm(); setCreateOpen(true); }}
            >
              {t('federation_peers_admin.actions.add_peer')}
            </Button>
          </div>
        }
      />

      {/* Intro card */}
      <Card className="border-l-4 border-l-accent bg-accent-soft dark:bg-accent-soft" >
        <CardBody className="px-4 py-3">
          <div className="flex gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-accent dark:text-accent">{t('federation_peers_admin.about.title')}</p>
              <p className="text-muted">
                {t('federation_peers_admin.about.body')}
              </p>
              <div className="space-y-0.5 pt-1 text-muted">
                <p><strong>{t('federation_peers_admin.about.shared_secret_label')}</strong> {t('federation_peers_admin.about.shared_secret_body')}</p>
                <p><strong>{t('federation_peers_admin.status.pending')}:</strong> {t('federation_peers_admin.about.pending_body')}</p>
                <p><strong>{t('federation_peers_admin.status.active')}:</strong> {t('federation_peers_admin.about.active_body')}</p>
                <p><strong>{t('federation_peers_admin.status.suspended')}:</strong> {t('federation_peers_admin.about.suspended_body')}</p>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2">
          <Server size={18} className="text-accent" />
          <span className="font-semibold">{t('federation_peers_admin.peers.title')}</span>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-10"><Spinner /></div>
          ) : (
            <Table aria-label={t('federation_peers_admin.peers.table_aria')} removeWrapper>
              <TableHeader>
                <TableColumn>{t('federation_peers_admin.table.name')}</TableColumn>
                <TableColumn>{t('federation_peers_admin.table.slug')}</TableColumn>
                <TableColumn>{t('federation_peers_admin.table.base_url')}</TableColumn>
                <TableColumn>{t('federation_peers_admin.table.status')}</TableColumn>
                <TableColumn>{t('federation_peers_admin.table.last_handshake')}</TableColumn>
                <TableColumn>{t('federation_peers_admin.table.actions')}</TableColumn>
              </TableHeader>
              <TableBody emptyContent={<BrokerEmptyState bare icon={Server} title={t('federation_peers_admin.peers.empty')} />}>
                {peers.map((peer) => (
                  <TableRow key={peer.id}>
                    <TableCell>
                      <div className="font-medium">{peer.display_name}</div>
                      {peer.notes && (
                        <div className="text-xs text-muted max-w-xs truncate">{peer.notes}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-surface-secondary px-1.5 py-0.5 rounded">
                        {peer.peer_slug}
                      </code>
                    </TableCell>
                    <TableCell>
                      <a
                        href={safeHref(peer.base_url)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent text-xs"
                      >
                        {peer.base_url}
                      </a>
                    </TableCell>
                    <TableCell>
                      <Chip size="sm" color={STATUS_COLOR[peer.status]} variant="soft">
                        {t(`federation_peers_admin.status.${peer.status}`)}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted">
                        {peer.last_handshake_at
                          ? new Date(peer.last_handshake_at).toLocaleString(getFormattingLocale())
                          : t('federation_peers_admin.empty.never')}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Select
                          aria-label={t('federation_peers_admin.table.status')}
                          size="sm"
                          className="min-w-[110px]"
                          selectedKeys={[peer.status]}
                          onChange={(e) => {
                            const v = e.target.value as PeerStatus;
                            if (v && v !== peer.status) void handleStatus(peer, v);
                          }}
                        >
                          {(['pending', 'active', 'suspended'] as PeerStatus[]).map((s) => (
                            <SelectItem key={s} id={s}>{t(`federation_peers_admin.status.${s}`)}</SelectItem>
                          ))}
                        </Select>
                        <Tooltip content={t('federation_peers_admin.actions.rotate_secret')}>
                          <Button
                            size="sm"
                            variant="tertiary"
                            isIconOnly
                            onPress={() => void handleRotate(peer)}
                            aria-label={t('federation_peers_admin.actions.rotate_secret')}
                          >
                            <KeyRound size={14} />
                          </Button>
                        </Tooltip>
                        <Tooltip content={t('federation_peers_admin.actions.delete_peer')}>
                          <Button
                            size="sm"
                            variant="danger"
                            isIconOnly
                            onPress={() => void handleDelete(peer)}
                            aria-label={t('federation_peers_admin.actions.delete_peer')}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Create Modal */}
      <Modal isOpen={createOpen} onOpenChange={setCreateOpen} size="2xl">
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader>{t('federation_peers_admin.create_modal.title')}</ModalHeader>
              <ModalBody className="gap-4">
                <Input
                  label={t('federation_peers_admin.create_modal.peer_slug')}
                  isRequired
                  description={t('federation_peers_admin.create_modal.peer_slug_description')}
                  placeholder={t('federation_peers_admin.create_modal.peer_slug_placeholder')}
                  value={peerSlug}
                  onValueChange={setPeerSlug}
                />
                <Input
                  label={t('federation_peers_admin.create_modal.display_name')}
                  isRequired
                  placeholder={t('federation_peers_admin.create_modal.display_name_placeholder')}
                  value={displayName}
                  onValueChange={setDisplayName}
                />
                <Input
                  label={t('federation_peers_admin.create_modal.base_url')}
                  isRequired
                  description={t('federation_peers_admin.create_modal.base_url_description')}
                  placeholder={t('federation_peers_admin.create_modal.base_url_placeholder')}
                  value={baseUrl}
                  onValueChange={setBaseUrl}
                />
                <Textarea
                  label={t('federation_peers_admin.create_modal.notes')}
                  placeholder={t('federation_peers_admin.create_modal.notes_placeholder')}
                  value={notes}
                  onValueChange={setNotes}
                  minRows={2}
                />
                <div className="text-xs text-muted">
                  <Power size={12} className="inline mr-1" />
                  {t('federation_peers_admin.create_modal.status_hint_prefix')}{' '}
                  <strong>{t('federation_peers_admin.status.pending')}</strong>.
                  {' '}{t('federation_peers_admin.create_modal.status_hint_middle')}{' '}
                  <strong>{t('federation_peers_admin.status.active')}</strong>.
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={close} isDisabled={creating}>{t('federation_peers_admin.actions.cancel')}</Button>
                <Button onPress={() => void handleCreate()} isLoading={creating}>
                  {t('federation_peers_admin.actions.create_reveal_secret')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Secret-reveal modal (one-time) */}
      <Modal
        isOpen={secretReveal !== null}
        onOpenChange={(open) => { if (!open) setSecretReveal(null); }}
        size="2xl"
      >
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader>{t('federation_peers_admin.secret_modal.title')}</ModalHeader>
              <ModalBody className="gap-3">
                <p className="text-sm">
                  {t('federation_peers_admin.secret_modal.body_prefix')}{' '}
                  <strong>{t('federation_peers_admin.secret_modal.only_once')}</strong>.
                  {' '}{t('federation_peers_admin.secret_modal.body_suffix')}
                </p>
                {secretReveal && (
                  <>
                    <div className="rounded-lg border border-border bg-surface-secondary p-3 font-mono text-xs break-all">
                      {secretReveal.secret}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="tertiary"
                        startContent={<Copy size={14} />}
                        onPress={() => copyToClipboard(secretReveal.secret)}
                      >
                        {t('federation_peers_admin.actions.copy_secret')}
                      </Button>
                      <Button
                        variant="tertiary"
                        startContent={<Copy size={14} />}
                        onPress={() => copyToClipboard(secretReveal.peerSlug)}
                      >
                        {t('federation_peers_admin.actions.copy_peer_slug')}
                      </Button>
                    </div>
                    <div className="text-xs text-muted">
                      <strong>{t('federation_peers_admin.secret_modal.peer_slug_label')}</strong> <code>{secretReveal.peerSlug}</code><br />
                      <strong>{t('federation_peers_admin.secret_modal.base_url_label')}</strong> <code>{secretReveal.baseUrl}</code>
                    </div>
                  </>
                )}
              </ModalBody>
              <ModalFooter>
                <Button onPress={close}>{t('federation_peers_admin.actions.copied_secret')}</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
