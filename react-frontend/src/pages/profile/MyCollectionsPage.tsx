// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { CardBody, Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Switch } from '@/components/ui/Switch';
/**
 * SOC10 — MyCollectionsPage at /me/collections
 * Grid of saved collections owned by the authenticated user.
 */

import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';

import Bookmark from 'lucide-react/icons/bookmark';
import Plus from 'lucide-react/icons/plus';
import FolderOpen from 'lucide-react/icons/folder-open';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { usePageTitle } from '@/hooks';
import { LoadingScreen, EmptyState } from '@/components/feedback';
import { PageMeta } from '@/components/seo';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { useTenant, useToast } from '@/contexts';

interface Collection {
  id: number;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  items_count: number;
  is_public: boolean;
}

export default function MyCollectionsPage() {
  const { t } = useTranslation('common');
  const toast = useToast();
  const { tenantPath } = useTenant();
  usePageTitle(t('collections.my_title'));

  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPublic, setNewPublic] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await api.get<Collection[]>('/v2/me/collections');
      if (res.success && Array.isArray(res.data)) {
        setCollections(res.data);
      } else {
        // api.get resolves { success:false } on 4xx/5xx without throwing —
        // without this branch a failed load fell through to the empty state.
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await api.post<Collection>('/v2/me/collections', {
        name: newName.trim(),
        description: newDescription.trim() || null,
        is_public: newPublic,
      });
      if (res.success && res.data) {
        setCollections((prev) => [...prev, res.data as Collection]);
        toast.success(t('collections.created'));
        setNewName('');
        setNewDescription('');
        setNewPublic(false);
        setShowCreate(false);
      } else {
        // api.post resolves { success:false } on a 4xx (e.g. duplicate/invalid name)
        // WITHOUT throwing, so the catch never fires — without this branch the modal
        // just stayed open with no feedback. Surface the failure and keep the dialog
        // open so the user can fix the name and retry.
        toast.error(res.error || t('common.error'));
      }
    } catch {
      toast.error(t('common.error'));
    } finally {
      setCreating(false);
    }
  }, [newName, newDescription, newPublic, toast, t]);

  if (loading) return <LoadingScreen />;

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl">
      <PageMeta title={t('collections.my_title')} noIndex />
      {/* The same soft panel in the community colour that opens the offers,
          events and groups pages (AWID: warmer, more inviting). */}
      <div className="mb-6">
        <PublicPageHero
          size="compact"
          title={t('collections.my_title')}
          icon={<Bookmark className="h-6 w-6" aria-hidden="true" />}
          accent="amber"
          action={
            <Button color="primary" startContent={<Plus className="w-4 h-4" />} onPress={() => setShowCreate(true)}>
              {t('collections.new')}
            </Button>
          }
        />
      </div>

      {loadError ? (
        <div role="alert" className="text-center py-12">
          <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-danger" aria-hidden="true" />
          <p className="text-[var(--text-muted)]">{t('collections.load_error')}</p>
          <Button className="mt-4" color="primary" onPress={() => void load()}>
            {t('collections.retry')}
          </Button>
        </div>
      ) : collections.length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="w-12 h-12 text-[var(--text-muted)]" />}
          title={t('collections.empty_title')}
          description={t('collections.empty_desc')}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {collections.map((c) => (
            <Link key={c.id} to={tenantPath(`/me/collections/${c.id}`)} className="block">
              <Card className="hover:shadow-md transition-shadow">
                <CardBody className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: c.color || 'var(--color-primary)' }}
                      aria-hidden="true"
                    />
                    <h3 className="font-semibold flex-1 truncate">{c.name}</h3>
                    <span className="text-sm text-[var(--text-muted)]">{c.items_count}</span>
                  </div>
                  {c.description && (
                    <p className="text-sm text-[var(--text-muted)] line-clamp-2">{c.description}</p>
                  )}
                  {c.is_public && (
                    <span className="text-xs text-[var(--color-primary)]">
                      {t('collections.public_label')}
                    </span>
                  )}
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)}>
        <ModalContent>
          <ModalHeader>{t('collections.new')}</ModalHeader>
          <ModalBody className="space-y-3">
            <Input
              label={t('collections.name_label')}
              value={newName}
              onValueChange={setNewName}
              variant="bordered"
              autoFocus
            />
            <Input
              label={t('collections.description_label')}
              value={newDescription}
              onValueChange={setNewDescription}
              variant="bordered"
            />
            <Switch isSelected={newPublic} onValueChange={setNewPublic}>
              {t('collections.make_public')}
            </Switch>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setShowCreate(false)}>
              {t('common.cancel')}
            </Button>
            <Button color="primary" onPress={handleCreate} isLoading={creating} isDisabled={!newName.trim()}>
              {t('collections.create')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
