// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * HeaderColumnTitleCard
 * Lets an admin name the column of the community's own pages in the More menu.
 * Empty means the default ("Our Pages") is used.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTenant, useToast } from '@/contexts';
import { logError } from '@/lib/logger';
import { Button, Card, CardBody, Input } from '@/components/ui';
import { adminSettings } from '../../api/adminApi';

const MAX_LENGTH = 30;

export function HeaderColumnTitleCard() {
  const { t } = useTranslation('admin_content');
  const toast = useToast();
  const { refreshTenant } = useTenant();
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    adminSettings
      .get()
      .then((res) => {
        if (cancelled) return;
        if (!res.success || !res.data) {
          toast.error(t('content.header_column_title_load_failed'));
          return;
        }
        setTitle(res.data.settings?.header_column_title ?? '');
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        logError('HeaderColumnTitleCard: load failed', err);
        toast.error(t('content.header_column_title_load_failed'));
      });
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await adminSettings.update({ header_column_title: title.trim() });
      if (res?.success) {
        setTitle(title.trim());
        toast.success(t('content.header_column_title_saved'));
        // So this admin's own header shows the new title without a reload.
        void refreshTenant({ silent: true });
      } else {
        toast.error(t('content.header_column_title_failed'));
      }
    } catch (err) {
      logError('HeaderColumnTitleCard: save failed', err);
      toast.error(t('content.header_column_title_failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mb-4">
      <CardBody className="flex flex-col gap-3">
        <p className="text-sm text-muted">{t('content.header_column_title_intro')}</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Input
              label={t('content.header_column_title')}
              description={`${t('content.header_column_title_help')} ${title.length}/${MAX_LENGTH}`}
              variant="secondary"
              maxLength={MAX_LENGTH}
              value={title}
              isDisabled={saving}
              onValueChange={setTitle}
            />
          </div>
          <Button onPress={handleSave} isLoading={saving} isDisabled={saving || !loaded}>
            {t('content.save_changes')}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export default HeaderColumnTitleCard;
