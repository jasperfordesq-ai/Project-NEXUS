// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin page for the offers & requests round-up email.
 *
 * - How often members get it by default (members can still choose their own).
 * - A live preview of the email as this admin would get it.
 * - "Send now": every current offer and request to every member who has not
 *   switched the round-up off. Runs in the background; asks first.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Mail from 'lucide-react/icons/mail';
import Send from 'lucide-react/icons/send';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { Button, Card, CardBody, CardHeader, Select, SelectItem, Spinner } from '@/components/ui';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { adminListingsDigest, type ListingsDigestAdminSettings } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';

type Frequency = ListingsDigestAdminSettings['default_frequency'];
type PreviewMode = 'all' | 'new';

const FREQUENCIES: Frequency[] = ['monthly', 'weekly', 'off'];

export function ListingsDigestAdmin() {
  const { t } = useTranslation('admin_newsletters');
  usePageTitle(t('listings_digest.page_title'));
  const toast = useToast();

  const [settings, setSettings] = useState<ListingsDigestAdminSettings | null>(null);
  const [isSavingDefault, setIsSavingDefault] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>('all');
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    adminListingsDigest.get().then((res) => {
      if (res.success && res.data) setSettings(res.data);
      else toast.error(t('listings_digest.load_failed'));
    }).catch(() => toast.error(t('listings_digest.load_failed')));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once
  }, []);

  const loadPreview = useCallback(async (mode: PreviewMode) => {
    setIsLoadingPreview(true);
    try {
      const res = await adminListingsDigest.preview(mode);
      if (res.success && res.data) setPreviewHtml(res.data.html);
      else toast.error(t('listings_digest.preview_failed'));
    } catch {
      toast.error(t('listings_digest.preview_failed'));
    } finally {
      setIsLoadingPreview(false);
    }
  }, [t, toast]);

  useEffect(() => {
    void loadPreview(previewMode);
  }, [previewMode, loadPreview]);

  const changeDefault = async (frequency: Frequency) => {
    if (!settings || frequency === settings.default_frequency) return;
    setIsSavingDefault(true);
    try {
      const res = await adminListingsDigest.update(frequency);
      if (res.success && res.data) {
        setSettings(res.data);
        toast.success(t('listings_digest.default_saved'));
      } else {
        toast.error(t('listings_digest.default_save_failed'));
      }
    } catch {
      toast.error(t('listings_digest.default_save_failed'));
    } finally {
      setIsSavingDefault(false);
    }
  };

  const sendNow = async () => {
    setIsSending(true);
    try {
      const res = await adminListingsDigest.sendNow();
      if (res.success && res.data) {
        toast.success(t('listings_digest.send_queued', { count: res.data.recipient_count }));
        setIsConfirmOpen(false);
      } else {
        toast.error(res.error || t('listings_digest.send_failed'));
      }
    } catch {
      toast.error(t('listings_digest.send_failed'));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('listings_digest.title')}
        description={t('listings_digest.description')}
        icon={<Mail size={20} aria-hidden="true" />}
        actions={
          <Button
            color="primary"
            startContent={<Send size={16} aria-hidden="true" />}
            isDisabled={!settings || settings.recipient_count === 0}
            onPress={() => setIsConfirmOpen(true)}
          >
            {t('listings_digest.send_now')}
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold">{t('listings_digest.schedule_title')}</h2>
          </CardHeader>
          <CardBody className="gap-4">
            {!settings ? (
              <Spinner size="sm" />
            ) : (
              <>
                <Select
                  label={t('listings_digest.default_label')}
                  selectedKeys={[settings.default_frequency]}
                  isDisabled={isSavingDefault}
                  onSelectionChange={(keys) => {
                    const value = Array.from(keys)[0] as Frequency | undefined;
                    if (value) void changeDefault(value);
                  }}
                >
                  {FREQUENCIES.map((frequency) => (
                    <SelectItem key={frequency} id={frequency}>
                      {t(`listings_digest.frequency_${frequency}`)}
                    </SelectItem>
                  ))}
                </Select>
                <p className="text-sm text-muted">{t('listings_digest.default_help')}</p>
                <p className="text-sm text-muted">{t('listings_digest.how_it_works')}</p>
                <p className="text-sm font-medium">
                  {t('listings_digest.recipient_count', { count: settings.recipient_count })}
                </p>
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">{t('listings_digest.preview_title')}</h2>
            <div className="flex items-center gap-2">
              <Select
                aria-label={t('listings_digest.preview_mode_label')}
                selectedKeys={[previewMode]}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys)[0] as PreviewMode | undefined;
                  if (value) setPreviewMode(value);
                }}
                className="min-w-[220px]"
              >
                <SelectItem key="all" id="all">{t('listings_digest.preview_mode_all')}</SelectItem>
                <SelectItem key="new" id="new">{t('listings_digest.preview_mode_new')}</SelectItem>
              </Select>
              <Button
                isIconOnly
                variant="ghost"
                aria-label={t('listings_digest.preview_refresh')}
                isDisabled={isLoadingPreview}
                onPress={() => void loadPreview(previewMode)}
              >
                <RefreshCw size={16} aria-hidden="true" />
              </Button>
            </div>
          </CardHeader>
          <CardBody>
            {isLoadingPreview && !previewHtml ? (
              <div className="flex h-64 items-center justify-center"><Spinner /></div>
            ) : previewHtml ? (
              <iframe
                title={t('listings_digest.preview_title')}
                sandbox="allow-same-origin"
                srcDoc={previewHtml}
                className="h-[75vh] min-h-[520px] w-full rounded-lg border-0"
              />
            ) : null}
          </CardBody>
        </Card>
      </div>

      <ConfirmModal
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={() => void sendNow()}
        title={t('listings_digest.confirm_title')}
        message={t('listings_digest.confirm_message', { count: settings?.recipient_count ?? 0 })}
        confirmLabel={t('listings_digest.confirm_send')}
        cancelLabel={t('listings_digest.cancel')}
        confirmColor="primary"
        isLoading={isSending}
      />
    </div>
  );
}

export default ListingsDigestAdmin;
