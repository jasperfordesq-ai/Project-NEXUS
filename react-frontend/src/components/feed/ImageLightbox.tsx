// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ImageLightbox — Fullscreen image viewer overlay.
 *
 * - Left/right navigation arrows
 * - Keyboard navigation (ArrowLeft/ArrowRight, Escape to close)
 * - Swipe gestures on mobile via Framer Motion
 * - Dark backdrop with blur
 * - Image counter "3 of 7"
 * - Focus trap
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence, type PanInfo } from '@/lib/motion';import X from 'lucide-react/icons/x';
import ChevronLeft from 'lucide-react/icons/chevron-left';
import ChevronRight from 'lucide-react/icons/chevron-right';
import Download from 'lucide-react/icons/download';
import { useTranslation } from 'react-i18next';
import { resolveAssetUrl, resolveThumbnailUrl } from '@/lib/helpers';
import type { PostMedia } from './types';
import { Button } from '@/components/ui/Button';
import { Modal, ModalBody, ModalContent } from '@/components/ui/Modal';

interface ImageLightboxProps {
  media: PostMedia[];
  initialIndex?: number;
  onClose: () => void;
}

const SWIPE_THRESHOLD = 80;

export function ImageLightbox({ media, initialIndex = 0, onClose }: ImageLightboxProps) {
  const { t } = useTranslation('feed');
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [direction, setDirection] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const total = media.length;
  const current = media[currentIndex];

  const goNext = useCallback(() => {
    if (currentIndex < total - 1) {
      setDirection(1);
      setCurrentIndex((i) => i + 1);
    }
  }, [currentIndex, total]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      setDirection(-1);
      setCurrentIndex((i) => i - 1);
    }
  }, [currentIndex]);

  const handleDragEnd = useCallback(
    (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (info.offset.x < -SWIPE_THRESHOLD) {
        goNext();
      } else if (info.offset.x > SWIPE_THRESHOLD) {
        goPrev();
      }
    },
    [goNext, goPrev],
  );

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose();
          break;
        case 'ArrowRight':
          e.preventDefault();
          goNext();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          goPrev();
          break;
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, goNext, goPrev]);

  // Lock body scroll when lightbox is open
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // Focus trap — focus the container on mount, restore on close
  const previousFocusRef = useRef<Element | null>(null);
  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    containerRef.current?.focus();
    return () => {
      (previousFocusRef.current as HTMLElement)?.focus?.();
    };
  }, []);

  if (!current) return null;

  const slideVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? '50%' : '-50%',
      opacity: 0,
      scale: 0.95,
    }),
    center: {
      x: 0,
      opacity: 1,
      scale: 1,
    },
    exit: (dir: number) => ({
      x: dir > 0 ? '-50%' : '50%',
      opacity: 0,
      scale: 0.95,
    }),
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="full"
      backdrop="blur"
      hideCloseButton
      classNames={{
        base: 'h-dvh max-h-dvh border-0 bg-black/90 p-0 text-white shadow-none',
        backdrop: 'bg-black/90 backdrop-blur-lg',
        body: 'p-0',
        wrapper: 'p-0',
      }}
    >
      <ModalContent aria-label={t('lightbox.aria_label')}>
        <ModalBody
      ref={containerRef}
      className="relative flex h-dvh items-center justify-center overflow-hidden"
      onClick={onClose}
      aria-label={t('lightbox.aria_label')}
      tabIndex={-1}
    >
      {/* Close button — large, high contrast, always visible */}
      <Button
        isIconOnly
        variant="flat"
        size="sm"
        className="absolute top-4 right-4 z-10 bg-theme-elevated text-theme-primary rounded-full shadow-lg"
        onPress={onClose}
        aria-label={t('lightbox.close')}
      >
        <X className="w-6 h-6 stroke-[2.5]" />
      </Button>

      {/* Download button — top-left */}
      <a
        href={resolveAssetUrl(current.file_url)}
        download
        className="absolute top-4 left-4 z-10 bg-black/40 backdrop-blur-sm text-white rounded-full p-2.5 hover:bg-black/60 transition-colors focus:outline-none focus:ring-2 focus:ring-white/50"
        onClick={(e) => e.stopPropagation()}
        aria-label={t('lightbox.download')}
      >
        <Download className="w-5 h-5" />
      </a>

      {/* Counter (screen reader live region) */}
      {total > 1 && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 text-white/80 text-sm font-medium" aria-live="polite" aria-atomic="true">
          {t('lightbox.counter', { current: currentIndex + 1, total })}
        </div>
      )}

      {/* Image container */}
      {/* Event containment, not a control: it stops a click on the image from
          reaching the backdrop's close handler. Keyboard users close the
          lightbox with Escape, which this element does not intercept. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className="relative w-full h-full flex items-center justify-center px-16 py-16"
        onClick={(e) => e.stopPropagation()}
      >
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div
            key={currentIndex}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              x: { type: 'spring', stiffness: 300, damping: 30 },
              opacity: { duration: 0.15 },
              scale: { duration: 0.15 },
            }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.3}
            onDragEnd={handleDragEnd}
            className="flex items-center justify-center max-w-full max-h-full"
          >
            {current.media_type === 'video' ? (
              <video
                src={resolveAssetUrl(current.file_url)}
                poster={current.thumbnail_url ? resolveThumbnailUrl(current.thumbnail_url, { width: 1200, height: 675 }) : undefined}
                controls
                autoPlay
                playsInline
                className="max-w-full max-h-full object-contain select-none rounded-lg"
                aria-label={current.alt_text || t('lightbox.aria_label')}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <img
                src={resolveThumbnailUrl(current.thumbnail_url || current.file_url, { width: 1600, height: 1200, fit: 'contain' })}
                alt={current.alt_text || ''}
                className="max-w-full max-h-full object-contain select-none rounded-lg"
                draggable={false}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Alt text */}
      {current.alt_text && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 max-w-lg text-center">
          <p className="text-white/70 text-sm bg-black/40 backdrop-blur-sm px-4 py-2 rounded-lg">
            {current.alt_text}
          </p>
        </div>
      )}

      {/* Left arrow */}
      {currentIndex > 0 && (
        <Button
          isIconOnly
          variant="flat"
          size="sm"
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 bg-white/10 backdrop-blur-sm text-white rounded-full"
          onPress={goPrev}
          aria-label={t('carousel.previous')}
        >
          <ChevronLeft className="w-6 h-6" />
        </Button>
      )}

      {/* Right arrow */}
      {currentIndex < total - 1 && (
        <Button
          isIconOnly
          variant="flat"
          size="sm"
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 bg-white/10 backdrop-blur-sm text-white rounded-full"
          onPress={goNext}
          aria-label={t('carousel.next')}
        >
          <ChevronRight className="w-6 h-6" />
        </Button>
      )}

      {/* Dot indicators — collapses to max 7 visible dots for 8+ images */}
      {total > 1 && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
          {media.map((item, idx) => {
            // For 8+ images, only show dots near the current index (Instagram-style)
            if (total > 7) {
              const distance = Math.abs(idx - currentIndex);
              if (distance > 3) return null;
              const scale = distance <= 1 ? '' : distance === 2 ? 'scale-75' : 'scale-50 opacity-50';
              return (
                <Button
                  key={item.id}
                  isIconOnly
                  variant="light"
                  size="sm"
                  className={`relative h-8 w-8 min-w-8 rounded-full bg-transparent p-0 transition-all after:absolute after:left-1/2 after:top-1/2 after:h-2.5 after:w-2.5 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:transition-all ${scale} ${
                    idx === currentIndex
                      ? 'after:bg-white after:scale-110'
                      : 'after:bg-white/40 hover:after:bg-white/60'
                  }`}
                  onPress={() => { setDirection(idx > currentIndex ? 1 : -1); setCurrentIndex(idx); }}
                  aria-label={t('carousel.go_to_image', { number: idx + 1 })}
                  aria-current={idx === currentIndex ? 'true' : undefined}
                />
              );
            }
            return (
              <Button
                key={item.id}
                isIconOnly
                variant="light"
                size="sm"
                className={`relative h-8 w-8 min-w-8 rounded-full bg-transparent p-0 transition-all after:absolute after:left-1/2 after:top-1/2 after:h-2.5 after:w-2.5 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:transition-all ${
                  idx === currentIndex
                    ? 'after:bg-white after:scale-110'
                    : 'after:bg-white/40 hover:after:bg-white/60'
                }`}
                onPress={() => { setDirection(idx > currentIndex ? 1 : -1); setCurrentIndex(idx); }}
                aria-label={t('carousel.go_to_image', { number: idx + 1 })}
                aria-current={idx === currentIndex ? 'true' : undefined}
              />
            );
          })}
        </div>
      )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
