// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ImagePlus from 'lucide-react/icons/image-plus';
import X from 'lucide-react/icons/x';

import { Button } from '@/components/ui';

/** Keep in step with SupportReportScreenshotService on the server. */
export const SCREENSHOT_MAX_FILES = 3;
export const SCREENSHOT_MAX_MB = 10;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

interface Picked {
  file: File;
  url: string;
}

interface SupportScreenshotPickerProps {
  files: File[];
  onChange: (files: File[]) => void;
  /** Element that should also accept a pasted screenshot (the whole form). */
  pasteTarget?: HTMLElement | null;
}

/**
 * "Add a screenshot" for the Help & support form (HELP-11). Up to three PNG,
 * JPEG or WebP images, chosen with the file picker or pasted from the
 * clipboard. Files are checked here for a quick answer; the server checks
 * them again by their content and re-encodes them.
 */
export function SupportScreenshotPicker({ files, onChange, pasteTarget }: SupportScreenshotPickerProps) {
  const { t } = useTranslation('common');
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const errorId = useId();
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Picked[]>([]);

  // One object URL per file, released when the file goes away.
  useEffect(() => {
    const next = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPreviews(next);
    return () => next.forEach((p) => URL.revokeObjectURL(p.url));
  }, [files]);

  const add = (incoming: File[]) => {
    if (incoming.length === 0) return;
    const accepted: File[] = [];
    let problem: string | null = null;

    for (const file of incoming) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        problem = t('report_problem.screenshots.error_type', { name: file.name || t('report_problem.screenshots.pasted') });
        continue;
      }
      if (file.size > SCREENSHOT_MAX_MB * 1024 * 1024) {
        problem = t('report_problem.screenshots.error_size', { name: file.name, size: SCREENSHOT_MAX_MB });
        continue;
      }
      if (files.length + accepted.length >= SCREENSHOT_MAX_FILES) {
        problem = t('report_problem.screenshots.error_count', { count: SCREENSHOT_MAX_FILES });
        break;
      }
      accepted.push(file);
    }

    setError(problem);
    if (accepted.length > 0) onChange([...files, ...accepted]);
  };

  // Paste anywhere in the form: the quickest way to send what is on screen.
  useEffect(() => {
    if (!pasteTarget) return undefined;
    const onPaste = (event: ClipboardEvent) => {
      const images = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (images.length === 0) return;
      event.preventDefault();
      add(images.map((image, index) => (image.name
        ? image
        : new File([image], `screenshot-${Date.now()}-${index}.png`, { type: image.type }))));
    };
    pasteTarget.addEventListener('paste', onPaste);
    return () => pasteTarget.removeEventListener('paste', onPaste);
  });

  const remove = (index: number) => {
    setError(null);
    onChange(files.filter((_, i) => i !== index));
  };

  const full = files.length >= SCREENSHOT_MAX_FILES;

  return (
    <fieldset className="space-y-2" data-testid="report-problem-screenshots">
      <legend className="text-sm font-semibold text-theme-primary">{t('report_problem.screenshots.label')}</legend>
      <p id={hintId} className="text-sm text-theme-secondary">
        {t('report_problem.screenshots.hint', { count: SCREENSHOT_MAX_FILES, size: SCREENSHOT_MAX_MB })}{' '}
        {t('report_problem.screenshots.privacy')}
      </p>

      {previews.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2" aria-label={t('report_problem.screenshots.list_label')}>
          {previews.map((preview, index) => (
            <li key={`${index}-${preview.file.name}`} className="relative overflow-hidden rounded-lg border border-[var(--border-default)] bg-theme-elevated">
              <img src={preview.url} alt={preview.file.name} className="aspect-video w-full object-cover" />
              <Button
                isIconOnly
                size="sm"
                variant="secondary"
                className="absolute end-1 top-1 min-h-8 min-w-8"
                aria-label={t('report_problem.screenshots.remove', { name: preview.file.name })}
                onPress={() => remove(index)}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="report-problem-screenshot-input"
        onChange={(event) => {
          add(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        isDisabled={full}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        startContent={<ImagePlus className="size-4" aria-hidden="true" />}
        onPress={() => inputRef.current?.click()}
      >
        {t('report_problem.screenshots.add')}
      </Button>

      <p id={errorId} role="alert" className="text-sm text-danger">
        {error ?? ''}
      </p>
    </fieldset>
  );
}
