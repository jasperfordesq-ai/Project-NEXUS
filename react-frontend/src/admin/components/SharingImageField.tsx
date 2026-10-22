// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * SharingImageField — the default social sharing (Open Graph) image, with a
 * plain explanation of what it is for, the size to use, an Upload button
 * that fills the address in, and a preview.
 *
 * Used by /admin/seo (the community's own admin, `seo_og_image_url` setting)
 * and the super-admin tenant form (`tenants.og_image_url`). Both screens
 * save on their own Save button, so this field only changes the value it is
 * given; the upload itself goes to the tenant's image library at once
 * (`POST /v2/upload`, admin-only, 10 MB, JPG/PNG/GIF/WebP) and the returned
 * address is handed back through `onChange`.
 */

import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Upload from 'lucide-react/icons/upload';
import Trash2 from 'lucide-react/icons/trash-2';
import ImageOff from 'lucide-react/icons/image-off';
import { Button, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { useToast } from '@/contexts';

const ACCEPT = 'image/jpeg,image/png,image/gif,image/webp';

export interface SharingImageFieldProps {
  /** Current image address ('' when none). */
  value: string;
  /** Called with the new address: a pasted URL, the uploaded file's URL, or '' on remove. */
  onChange: (url: string) => void;
}

export function SharingImageField({ value, onChange }: SharingImageFieldProps) {
  const { t } = useTranslation('admin_advanced', { keyPrefix: 'advanced' });
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [broken, setBroken] = useState(false);

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const res = await api.upload<{ url: string; path: string }>('/v2/upload', file, 'file');
      const url = res.success && res.data?.url ? String(res.data.url) : '';
      if (!url) throw new Error('upload returned no url');
      setBroken(false);
      onChange(url);
      toast.success(t('og_image_uploaded'));
    } catch {
      toast.error(t('og_image_upload_failed'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="sharing-image-field">
      <p className="text-sm text-foreground">{t('og_image_explainer')}</p>
      <p className="text-xs leading-5 text-muted">{t('og_image_size_hint')}</p>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        data-testid="sharing-image-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          isPending={uploading}
          startContent={!uploading ? <Upload size={14} aria-hidden="true" /> : undefined}
          onPress={() => inputRef.current?.click()}
        >
          {uploading ? t('og_image_uploading') : value ? t('og_image_replace') : t('og_image_upload')}
        </Button>
        {value && (
          <Button
            variant="tertiary"
            size="sm"
            className="text-danger"
            startContent={<Trash2 size={14} aria-hidden="true" />}
            isDisabled={uploading}
            onPress={() => { setBroken(false); onChange(''); }}
          >
            {t('og_image_remove')}
          </Button>
        )}
      </div>

      <Input
        label={t('og_image_address_label')}
        placeholder="https://your-domain.com/images/sharing.png"
        variant="secondary"
        value={value}
        onValueChange={(v) => { setBroken(false); onChange(v); }}
        description={t('og_image_address_desc')}
      />

      {value && (
        <figure className="rounded-lg border border-border p-3">
          <figcaption className="mb-2 text-xs text-muted">{t('og_image_preview')}</figcaption>
          {broken ? (
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <ImageOff size={14} aria-hidden="true" />
              {t('og_image_failed_to_load')}
            </span>
          ) : (
            <img
              src={value}
              alt={t('og_image_preview')}
              className="max-h-48 w-auto max-w-full rounded-md object-contain"
              onError={() => setBroken(true)}
            />
          )}
        </figure>
      )}

      <p className="text-xs text-muted">{t('og_image_save_reminder')}</p>
    </div>
  );
}

export default SharingImageField;
