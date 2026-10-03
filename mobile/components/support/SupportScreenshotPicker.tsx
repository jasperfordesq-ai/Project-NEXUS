// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Optional screenshots for a Help & support request (HELP-11).
 *
 * The native twin of the website's `SupportScreenshotPicker`
 * (`react-frontend/src/components/feedback/SupportScreenshotPicker.tsx`): up to three
 * pictures from the phone, shown as thumbnails the member can remove before sending.
 *
 * 🔴 Everything a picture goes through before it is accepted, and why:
 *  - `prepareImageForUpload` shrinks it, like every other photo the app sends
 *    (`app/imageUploadSizing.test.ts`). The longest side here is 2048, not 1600: a
 *    support person reads the small text in a screenshot.
 *  - `convertUnsupportedFormats` turns an iPhone's HEIC (or anything else that is not
 *    PNG, JPEG or WebP) into JPEG on the phone. The server checks the file's CONTENT and
 *    refuses anything else, so renaming would not do.
 *  - A picture that could not be converted, or that is still over 10 MB, is refused
 *    HERE with a reason, rather than sent and refused by the server after the upload.
 *
 * The photo library opens without asking for permission first: the system photo picker
 * needs none, and asking did harm once (`app/imageUploadSizing.test.ts`).
 */

import { useRef, useState } from 'react';
import { Image, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { Card as HeroCard, Text } from 'heroui-native';

import { Button as HeroButton } from '@/components/ui/NativeButton';
import { Ionicons } from '@/components/ui/Icon';
import { describeApiError } from '@/lib/api/describeApiError';
import {
  isSupportScreenshotType,
  SUPPORT_SCREENSHOT_MAX_BYTES,
  SUPPORT_SCREENSHOTS_MAX,
  type SupportScreenshot,
  type SupportScreenshotType,
} from '@/lib/api/support';
import { useTheme } from '@/lib/hooks/useTheme';
import { prepareImageForUpload } from '@/lib/media/prepareImageForUpload';
import { withAlpha } from '@/lib/utils/color';

/** Longest side of a screenshot after shrinking. Readable text matters more than bytes here. */
export const SUPPORT_SCREENSHOT_MAX_EDGE = 2048;

/** A screenshot the member has added, with a key that survives removing its neighbours. */
export interface PickedSupportScreenshot extends SupportScreenshot {
  id: string;
}

const EXTENSIONS: Record<SupportScreenshotType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const EXTENSION_TYPES: Record<string, SupportScreenshotType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** The prepared file's type, from the encoder when it re-encoded, else from the picker or extension. */
function resolveType(prepared: { uri: string; mimeType?: string | null }, picked: { mimeType?: string | null }): string | null {
  const reported = (prepared.mimeType ?? picked.mimeType ?? '').trim().toLowerCase();
  if (reported === 'image/jpg') return 'image/jpeg';
  if (reported) return reported;
  const extension = /\.([a-z0-9]+)(\?|$)/i.exec(prepared.uri)?.[1]?.toLowerCase();
  return extension ? EXTENSION_TYPES[extension] ?? null : null;
}

type Notice =
  | { kind: 'tooMany' }
  | { kind: 'tooLarge' }
  | { kind: 'unsupported' }
  | { kind: 'failed'; message: string };

export default function SupportScreenshotPicker({
  screenshots,
  onChange,
  disabled = false,
  serverError,
}: {
  screenshots: PickedSupportScreenshot[];
  onChange: (next: PickedSupportScreenshot[]) => void;
  disabled?: boolean;
  /** The server's own (already translated) refusal of a screenshot, if it sent one. */
  serverError?: string;
}) {
  const { t } = useTranslation(['profile', 'common']);
  const theme = useTheme();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [isPicking, setIsPicking] = useState(false);
  // State alone cannot stop two presses in the same frame from opening two pickers.
  const pickingRef = useRef(false);
  const nextIdRef = useRef(1);

  const remaining = SUPPORT_SCREENSHOTS_MAX - screenshots.length;
  const sizeMb = SUPPORT_SCREENSHOT_MAX_BYTES / 1024 / 1024;

  async function pick() {
    if (pickingRef.current || disabled || remaining <= 0) return;
    pickingRef.current = true;
    setIsPicking(true);
    setNotices([]);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 0.9,
      });
      if (result.canceled) return;

      const found: Notice[] = [];
      // Not every Android photo picker honours `selectionLimit`.
      if (result.assets.length > remaining) found.push({ kind: 'tooMany' });

      const accepted: PickedSupportScreenshot[] = [];
      let tooLarge = false;
      let unsupported = false;
      for (const asset of result.assets.slice(0, remaining)) {
        const prepared = await prepareImageForUpload(asset, {
          maxEdge: SUPPORT_SCREENSHOT_MAX_EDGE,
          convertUnsupportedFormats: true,
        });
        const type = resolveType(prepared, asset);
        if (!isSupportScreenshotType(type)) {
          unsupported = true;
          continue;
        }
        // Only the untouched original has a known size; a re-encoded copy is far smaller,
        // and the server still checks it.
        if (prepared.uri === asset.uri && typeof asset.fileSize === 'number' && asset.fileSize > SUPPORT_SCREENSHOT_MAX_BYTES) {
          tooLarge = true;
          continue;
        }
        const number = screenshots.length + accepted.length + 1;
        accepted.push({
          id: `screenshot-${nextIdRef.current++}`,
          uri: prepared.uri,
          name: `screenshot-${number}.${EXTENSIONS[type]}`,
          mimeType: type,
        });
      }
      if (tooLarge) found.push({ kind: 'tooLarge' });
      if (unsupported) found.push({ kind: 'unsupported' });

      setNotices(found);
      if (accepted.length > 0) onChange([...screenshots, ...accepted].slice(0, SUPPORT_SCREENSHOTS_MAX));
    } catch (caught) {
      setNotices([{ kind: 'failed', message: describeApiError(caught, t('profile:support.request.screenshots.failed')) }]);
    } finally {
      pickingRef.current = false;
      setIsPicking(false);
    }
  }

  function remove(id: string) {
    setNotices([]);
    onChange(screenshots.filter((screenshot) => screenshot.id !== id));
  }

  function describe(notice: Notice): string {
    switch (notice.kind) {
      case 'tooMany':
        return t('profile:support.request.screenshots.tooMany', { max: SUPPORT_SCREENSHOTS_MAX });
      case 'tooLarge':
        return t('profile:support.request.screenshots.tooLarge', { size: sizeMb });
      case 'unsupported':
        return t('profile:support.request.screenshots.unsupported');
      default:
        return notice.message;
    }
  }

  const messages = [...notices.map(describe), ...(serverError ? [serverError] : [])];

  return (
    <View testID="help-support-screenshots" className="gap-2">
      <Text className="text-sm font-semibold" style={{ color: theme.text }}>
        {t('profile:support.request.screenshots.label')}
      </Text>
      <Text className="text-xs leading-5" style={{ color: theme.textSecondary }}>
        {t('profile:support.request.screenshots.hint', { max: SUPPORT_SCREENSHOTS_MAX, size: sizeMb })}
      </Text>

      {screenshots.length > 0 ? (
        <View className="flex-row flex-wrap gap-2" accessibilityLabel={t('profile:support.request.screenshots.listLabel')}>
          {screenshots.map((screenshot, index) => (
            <HeroCard
              key={screenshot.id}
              testID={`help-support-screenshot-${index}`}
              variant="secondary"
              className="w-[96px] overflow-hidden rounded-panel-inner p-0"
            >
              <Image
                source={{ uri: screenshot.uri }}
                accessibilityLabel={t('profile:support.request.screenshots.thumbnail', { number: index + 1 })}
                className="h-[96px] w-full"
                resizeMode="cover"
              />
              <HeroCard.Body className="px-1 py-0.5">
                <HeroButton
                  testID={`help-support-screenshot-remove-${index}`}
                  size="sm"
                  variant="ghost"
                  isDisabled={disabled}
                  accessibilityLabel={t('profile:support.request.screenshots.remove', { number: index + 1 })}
                  onPress={() => remove(screenshot.id)}
                >
                  <Ionicons name="close-circle-outline" size={16} color={theme.error} />
                  <HeroButton.Label className="text-xs">{t('profile:support.request.screenshots.removeLabel')}</HeroButton.Label>
                </HeroButton>
              </HeroCard.Body>
            </HeroCard>
          ))}
        </View>
      ) : null}

      {remaining > 0 ? (
        <HeroButton
          testID="help-support-screenshots-add"
          variant="secondary"
          size="sm"
          isDisabled={disabled || isPicking}
          accessibilityLabel={t('profile:support.request.screenshots.add')}
          onPress={() => void pick()}
          className="self-start rounded-full"
        >
          <Ionicons name="image-outline" size={16} color={theme.textSecondary} />
          <HeroButton.Label className="text-sm">{t('profile:support.request.screenshots.add')}</HeroButton.Label>
        </HeroButton>
      ) : (
        <Text testID="help-support-screenshots-full" className="text-xs leading-5" style={{ color: theme.textSecondary }}>
          {t('profile:support.request.screenshots.full', { max: SUPPORT_SCREENSHOTS_MAX })}
        </Text>
      )}

      {screenshots.length > 0 ? (
        <Text className="text-xs leading-5" style={{ color: theme.textSecondary }}>
          {t('profile:support.request.screenshots.privacy')}
        </Text>
      ) : null}

      {messages.length > 0 ? (
        <View
          testID="help-support-screenshots-notice"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          className="gap-1 rounded-panel-inner p-3"
          style={{ backgroundColor: withAlpha(theme.warning, 0.12), borderWidth: 1, borderColor: withAlpha(theme.warning, 0.28) }}
        >
          {messages.map((message) => (
            <Text key={message} className="text-sm leading-5" style={{ color: theme.text }}>
              {message}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
