// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MediaUploader — Multi-file upload component for the post composer.
 *
 * Features:
 * - "Add Photos" button with drag-and-drop zone
 * - Thumbnail preview grid with remove/reorder
 * - Alt text input per image (via overlay button)
 * - Client-side image compression before handoff
 * - File validation: type (image/*), size (max 10MB), count (max 10)
 * - Upload progress (visual feedback during compression)
 */

import { useRef, useState, useCallback, type DragEvent } from 'react';import ImagePlus from 'lucide-react/icons/image-plus';
import X from 'lucide-react/icons/x';
import GripVertical from 'lucide-react/icons/grip-vertical';
import Type from 'lucide-react/icons/type';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { compressImage } from '@/lib/compress-image';
import { Button, Input } from '@/components/ui';
import { OverlayActionButton } from '@/components/ui/OverlayActionButton';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface MediaFile {
  file: File;
  preview: string;
  altText: string;
}

export interface MediaUploaderProps {
  onMediaChange: (files: MediaFile[]) => void;
  mediaFiles: MediaFile[];
  maxFiles?: number;
  maxSizeMb?: number;
  onError?: (msg: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Sortable thumbnail with alt text                                   */
/* ------------------------------------------------------------------ */

interface SortableMediaItemProps {
  id: string;
  item: MediaFile;
  index: number;
  onRemove: (index: number) => void;
  onAltTextChange: (index: number, altText: string) => void;
}

function SortableMediaItem({
  id,
  item,
  index,
  onRemove,
  onAltTextChange,
}: SortableMediaItemProps) {
  const { t } = useTranslation('feed');
  const { t: tc } = useTranslation('common');
  const [showAltInput, setShowAltInput] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative rounded-xl overflow-hidden border border-[var(--border-default)] group/item ${
        isDragging ? 'opacity-50 scale-105 z-10' : ''
      } transition-all`}
    >
      {/* Drag handle */}
      <OverlayActionButton
        variant="tertiary"
        className="absolute top-1.5 left-1.5 z-10 cursor-grab rounded-lg bg-black/60 text-white backdrop-blur-sm transition-opacity pointer-fine:group-hover/item:opacity-100 active:cursor-grabbing"
        aria-label={tc('aria.drag_to_reorder')}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </OverlayActionButton>

      {/* Order badge */}
      <div className="absolute top-1.5 left-1/2 -translate-x-1/2 z-10 bg-black/60 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center backdrop-blur-sm pointer-events-none">
        {index + 1}
      </div>

      {/* Image preview */}
      <img
        src={item.preview}
        alt={item.altText || t('compose.upload_preview_alt', { number: index + 1 })}
        className="w-full aspect-square object-cover"
        draggable={false}
      />

      {/* Remove button */}
      <OverlayActionButton
        revealOnFinePointer={false}
        variant="tertiary"
        className="absolute top-1.5 right-1.5 z-10 rounded-full bg-black/60 text-white backdrop-blur-sm"
        onPress={() => onRemove(index)}
        aria-label={t('compose.image_remove_number_aria', { number: index + 1 })}
      >
        <X className="size-4" aria-hidden="true" />
      </OverlayActionButton>

      {/* Alt text toggle button */}
      <OverlayActionButton
        revealOnFinePointer={!item.altText}
        variant="tertiary"
        className={`absolute bottom-1.5 right-1.5 z-10 rounded-full backdrop-blur-sm ${
          item.altText
            ? 'bg-[var(--color-primary)]/80 text-white'
            : 'bg-black/60 text-white pointer-fine:group-hover/item:opacity-100'
        } transition-opacity`}
        onPress={() => setShowAltInput(!showAltInput)}
        aria-label={item.altText ? t('compose.alt_text_edit') : t('compose.alt_text_add')}
      >
        <Type className="size-4" aria-hidden="true" />
      </OverlayActionButton>

      {/* Alt text input overlay */}
      {showAltInput && (
        // This onClick is event containment, not a control: it stops a click
        // inside the alt-text field from reaching the parent tile's own click
        // handler. There is no action for a keyboard user to trigger here, and
        // keyboard events do not bubble out of the Input the way clicks do.
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
        <div
          className="absolute inset-x-0 bottom-0 bg-black/80 backdrop-blur-sm p-2 z-20"
          onClick={(e) => e.stopPropagation()}
        >
          <Input
            size="sm"
            variant="secondary"
            placeholder={t('compose.alt_text_placeholder')}
            value={item.altText}
            onChange={(e) => onAltTextChange(index, e.target.value)}
            classNames={{
              input: 'text-white text-xs',
              inputWrapper: 'border-white/30 bg-transparent min-h-8 h-8',
            }}
            aria-label={t('compose.alt_text_label')}
            maxLength={500}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setShowAltInput(false);
            }}
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function MediaUploader({
  onMediaChange,
  mediaFiles,
  maxFiles = 10,
  maxSizeMb = 10,
  onError,
}: MediaUploaderProps) {
  const { t } = useTranslation('feed');
  const { t: tc } = useTranslation('common');
  const inputRef = useRef<HTMLInputElement>(null);
  const [compressing, setCompressing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const itemIds = mediaFiles.map((_, i) => `media-${i}`);

  /* ---- File processing ---- */

  const processFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const availableSlots = maxFiles - mediaFiles.length;
      if (availableSlots <= 0) {
        onError?.(t('compose.images_max', { max: maxFiles }));
        return;
      }

      const filesToProcess = Array.from(fileList).slice(0, availableSlots);
      const rejected = filesToProcess.filter(
        (f) => !f.type.startsWith('image/') || f.size > maxSizeMb * 1024 * 1024,
      );
      const validFiles = filesToProcess.filter(
        (f) => f.type.startsWith('image/') && f.size <= maxSizeMb * 1024 * 1024,
      );

      if (rejected.length > 0) {
        onError?.(t('compose.media_rejected', { count: rejected.length }));
      }

      if (validFiles.length === 0) return;

      setCompressing(true);
      try {
        const newItems: MediaFile[] = [];
        let failedCount = 0;

        for (const file of validFiles) {
          try {
            const compressed = await compressImage(file);
            const preview = await readFileAsDataUrl(compressed);
            newItems.push({
              file: compressed,
              preview,
              altText: '',
            });
          } catch {
            failedCount++;
          }
        }

        if (newItems.length > 0) {
          onMediaChange([...mediaFiles, ...newItems]);
        }

        if (failedCount > 0) {
          onError?.(t('compose.media_compression_failed', { count: failedCount }));
        }
      } catch {
        onError?.(t('compose.media_upload_error'));
      } finally {
        setCompressing(false);
      }
    },
    [maxFiles, maxSizeMb, mediaFiles, onMediaChange, onError, t],
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        await processFiles(e.target.files);
      }
      // Reset the input so the same files can be re-selected
      if (inputRef.current) inputRef.current.value = '';
    },
    [processFiles],
  );

  /* ---- Drag and drop ---- */

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (e.dataTransfer.files) {
        await processFiles(e.dataTransfer.files);
      }
    },
    [processFiles],
  );

  /* ---- Reorder ---- */

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = itemIds.indexOf(active.id as string);
      const newIndex = itemIds.indexOf(over.id as string);

      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(mediaFiles, oldIndex, newIndex);
      onMediaChange(reordered);
    },
    [mediaFiles, itemIds, onMediaChange],
  );

  /* ---- Handlers ---- */

  const handleRemove = useCallback(
    (index: number) => {
      const updated = mediaFiles.filter((_, i) => i !== index);
      onMediaChange(updated);
    },
    [mediaFiles, onMediaChange],
  );

  const handleAltTextChange = useCallback(
    (index: number, altText: string) => {
      const updated = mediaFiles.map((item, i) =>
        i === index ? { ...item, altText } : item,
      );
      onMediaChange(updated);
    },
    [mediaFiles, onMediaChange],
  );

  /* ---- Render ---- */

  const canAddMore = mediaFiles.length < maxFiles;
  const hasFiles = mediaFiles.length > 0;

  return (
    <div className="space-y-2">
      {/* Hidden file input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        multiple
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={handleFileChange}
      />

      {/* Drag-and-drop zone (shown when no files yet) */}
      {!hasFiles && (
        <div
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
            isDragOver
              ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5'
              : 'border-gray-300 dark:border-gray-600 hover:border-[var(--color-primary)]/50'
          }`}
          onClick={() => inputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          role="button"
          tabIndex={0}
          aria-label={tc('aria.click_or_drag_to_upload')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
        >
          <ImagePlus className="w-8 h-8 mx-auto mb-2 text-[var(--text-subtle)]" aria-hidden="true" />
          <p className="text-sm text-[var(--text-muted)]">
            {t('compose.media_drag_drop')}
          </p>
          <p className="text-xs text-[var(--text-subtle)] mt-1">
            {t('compose.media_formats')}
          </p>
        </div>
      )}

      {/* Image grid with drag-and-drop reorder */}
      {hasFiles && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={itemIds} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {mediaFiles.map((item, index) => (
                  <SortableMediaItem
                    key={itemIds[index] ?? index}
                    id={itemIds[index] ?? ''}
                    item={item}
                    index={index}
                    onRemove={handleRemove}
                    onAltTextChange={handleAltTextChange}
                  />
                ))}

                {/* Add more button (inline in grid) */}
                {canAddMore && (
                  <Button
                    variant="secondary"
                    onPress={() => inputRef.current?.click()}
                    isDisabled={compressing}
                    aria-label={tc('aria.add_more_photos')}
                    className={`aspect-square min-h-[96px] rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer transition-all ${
                      isDragOver
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5'
                        : 'border-gray-300 dark:border-gray-600 hover:border-[var(--color-primary)]/50'
                    }`}
                  >
                    <ImagePlus className="w-6 h-6 text-[var(--text-subtle)]" aria-hidden="true" />
                    <span className="text-[10px] text-[var(--text-subtle)]">
                      {compressing ? t('compose.image_compressing') : '+'}
                    </span>
                  </Button>
                )}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* Controls row */}
      {hasFiles && (
        <div className="flex items-center gap-2 flex-wrap">
          {/* File count */}
          <span className="text-xs text-[var(--text-subtle)]">
            {t('compose.images_count', { current: mediaFiles.length, max: maxFiles })}
          </span>

          {/* Reorder hint */}
          {mediaFiles.length > 1 && (
            <span className="text-xs text-[var(--text-subtle)] hidden sm:inline">
              {t('compose.images_reorder')}
            </span>
          )}

          {compressing && (
            <span className="text-xs text-[var(--color-primary)] animate-pulse">
              {t('compose.image_compressing')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
