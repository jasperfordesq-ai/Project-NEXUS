// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BuilderPreviewModal - a device-framed preview of compiled builder HTML.
 *
 * The builder canvas shows editable content; this renders the exported HTML
 * into a sandboxed iframe (no scripts) at a desktop or mobile width.
 */

import { useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalHeader, ModalHeading } from '@/components/ui';
import { useTheme, type ResolvedTheme } from '@/contexts';
import Monitor from 'lucide-react/icons/monitor';
import Smartphone from 'lucide-react/icons/smartphone';

type PreviewDevice = 'desktop' | 'mobile';

interface BuilderPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Compiled HTML to render (from the builder's exportHtml). */
  html: string;
  t: (key: string) => string;
  labels?: Partial<{
    title: string;
    deviceLabel: string;
    desktop: string;
    mobile: string;
  }>;
}

const FRAME_WIDTH: Record<PreviewDevice, string> = {
  desktop: 'w-[640px]',
  mobile: 'w-[375px]',
};

const PREVIEW_THEME_CSS: Record<ResolvedTheme, string> = {
  dark: `
:root{--background:#0c0a09;--foreground:#ededed;--foreground-muted:rgba(237,237,237,.7);--surface-elevated:rgba(255,255,255,.05);--border-default:rgba(255,255,255,.10);--accent-color:#818cf8;--color-accent:#06b6d4;--color-warning:#f59e0b;--accent-foreground:#ffffff;--shadow-md:0 4px 16px rgba(0,0,0,.4)}
html{color-scheme:dark}
`.trim(),
  light: `
:root{--background:#fafaf9;--foreground:#292524;--foreground-muted:rgba(41,37,36,.7);--surface-elevated:rgba(255,255,255,.9);--border-default:rgba(0,0,0,.08);--accent-color:#4f46e5;--color-accent:#0891b2;--color-warning:#d97706;--accent-foreground:#ffffff;--shadow-md:0 4px 16px rgba(0,0,0,.12)}
html{color-scheme:light}
`.trim(),
};

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildBuilderPreviewSrcDoc(html: string, theme: ResolvedTheme): string {
  const safeTheme = theme === 'dark' ? 'dark' : 'light';
  return `<!doctype html><html data-theme="${safeTheme}" class="${safeTheme}"><head><meta charset="utf-8"><meta name="color-scheme" content="${safeTheme}"><style>${PREVIEW_THEME_CSS[safeTheme]}body{margin:0;background:var(--background);color:var(--foreground);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:var(--accent-color)}</style></head><body data-nexus-preview-theme="${escapeHtmlAttr(safeTheme)}">${html}</body></html>`;
}

export function BuilderPreviewModal({ isOpen, onClose, html, t, labels }: BuilderPreviewModalProps) {
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  const { resolvedTheme } = useTheme();
  const srcDoc = buildBuilderPreviewSrcDoc(html, resolvedTheme);

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()} size="5xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex items-center justify-between gap-4">
          <ModalHeading>{labels?.title ?? t('newsletter_builder.preview_title')}</ModalHeading>
          <div className="flex items-center gap-1" role="group" aria-label={labels?.deviceLabel ?? t('newsletter_builder.preview_device_label')}>
            <Button
              size="sm"
              variant={device === 'desktop' ? 'primary' : 'light'}
              startContent={<Monitor size={15} />}
              onPress={() => setDevice('desktop')}
              aria-pressed={device === 'desktop'}
            >
              {labels?.desktop ?? t('newsletter_builder.preview_desktop')}
            </Button>
            <Button
              size="sm"
              variant={device === 'mobile' ? 'primary' : 'light'}
              startContent={<Smartphone size={15} />}
              onPress={() => setDevice('mobile')}
              aria-pressed={device === 'mobile'}
            >
              {labels?.mobile ?? t('newsletter_builder.preview_mobile')}
            </Button>
          </div>
        </ModalHeader>
        <ModalBody className="bg-surface-secondary">
          <div className="flex justify-center py-4">
            <iframe
              title={labels?.title ?? t('newsletter_builder.preview_title')}
              srcDoc={srcDoc}
              sandbox=""
              className={`h-[70vh] max-w-full rounded-lg border border-border bg-background shadow-sm transition-[width] ${FRAME_WIDTH[device]}`}
            />
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

export default BuilderPreviewModal;
