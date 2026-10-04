// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * One image slot on the admin Settings page (partner logo, header logos,
 * powered-by images). Previews the current image on BOTH a light and a dark
 * surface — a white SVG on a light grey box used to look like nothing had
 * uploaded — and says plainly whether changes here persist at once or on
 * Save, which differs per slot because only some have a delete endpoint.
 */

import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import Upload from 'lucide-react/icons/upload';
import Trash2 from 'lucide-react/icons/trash-2';
import ImageOff from 'lucide-react/icons/image-off';
import { Button, Chip } from '@/components/ui';

const DEFAULT_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp,image/svg+xml';

export interface LogoUploadFieldProps {
  id: string;
  label: string;
  hint?: ReactNode;
  /** Current image URL, already resolved to something an <img> can load. */
  value: string | null;
  /** Whether upload/remove persist on the server at once, or removal waits for Save. */
  persistence: 'immediate' | 'deferred';
  /** True when a deferred removal is waiting for Save. */
  pendingRemoval?: boolean;
  accept?: string;
  uploading: boolean;
  onUpload: (file: File) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
}

function PreviewTile({ src, alt, dark, caption }: { src: string; alt: string; dark: boolean; caption: string }) {
  const [broken, setBroken] = useState(false);
  const { t } = useTranslation('admin_system');
  return (
    <figure className="min-w-0 flex-1">
      <div
        className={`flex h-20 items-center justify-center overflow-hidden rounded-xl border border-divider px-4 ${
          dark
            ? 'bg-neutral-900'
            : 'bg-white bg-[linear-gradient(45deg,#e5e7eb_25%,transparent_25%,transparent_75%,#e5e7eb_75%),linear-gradient(45deg,#e5e7eb_25%,transparent_25%,transparent_75%,#e5e7eb_75%)] bg-[length:16px_16px] bg-[position:0_0,8px_8px]'
        }`}
      >
        {broken ? (
          <span className={`flex items-center gap-1.5 text-xs ${dark ? 'text-neutral-400' : 'text-muted'}`}>
            <ImageOff size={14} aria-hidden="true" />
            {t('admin_settings.image_failed_to_load')}
          </span>
        ) : (
          <img src={src} alt={alt} className="max-h-12 w-auto max-w-full object-contain" onError={() => setBroken(true)} />
        )}
      </div>
      <figcaption className="mt-1 text-xs text-muted">{caption}</figcaption>
    </figure>
  );
}

export function LogoUploadField({
  id,
  label,
  hint,
  value,
  persistence,
  pendingRemoval = false,
  accept = DEFAULT_ACCEPT,
  uploading,
  onUpload,
  onRemove,
}: LogoUploadFieldProps) {
  const { t } = useTranslation('admin_system');
  const inputRef = useRef<HTMLInputElement>(null);
  const hasImage = Boolean(value);

  return (
    <div className="space-y-3" data-testid={`logo-field-${id}`}>
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        {hint && <p className="mt-0.5 text-xs leading-5 text-muted">{hint}</p>}
      </div>

      {hasImage && value && (
        <div className="flex flex-col gap-3 sm:flex-row">
          <PreviewTile src={value} alt={label} dark={false} caption={t('admin_settings.preview_light')} />
          <PreviewTile src={value} alt={label} dark caption={t('admin_settings.preview_dark')} />
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        data-testid={`logo-input-${id}`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onUpload(file);
          // Allow re-selecting the same file after a failed or replaced upload.
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
          {hasImage ? t('admin_settings.replace_image') : t('admin_settings.upload_image')}
        </Button>
        {hasImage && (
          <Button
            variant="tertiary"
            size="sm"
            className="text-danger"
            startContent={<Trash2 size={14} aria-hidden="true" />}
            onPress={() => void onRemove()}
            isDisabled={uploading}
          >
            {t('admin_settings.remove_image')}
          </Button>
        )}
        {pendingRemoval && (
          <Chip size="sm" color="warning" variant="soft">
            {t('admin_settings.removal_pending')}
          </Chip>
        )}
      </div>
      <p className="text-xs text-muted">
        {persistence === 'immediate'
          ? t('admin_settings.upload_persists_immediately')
          : t('admin_settings.upload_persists_on_save')}
      </p>
    </div>
  );
}

export default LogoUploadField;
