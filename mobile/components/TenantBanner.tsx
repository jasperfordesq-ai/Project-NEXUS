// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { contrastText } from '@/lib/utils/color';
import { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { Surface } from 'heroui-native';

import { useTranslation } from 'react-i18next';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { resolveImageUrl } from '@/lib/utils/resolveImageUrl';

const LOGO_HEIGHT = 30;
const LOGO_MAX_WIDTH = 120;

/**
 * Width for the logo box from the image's own aspect ratio.
 *
 * 🔴 This was a fixed 30×30 box. Hour Timebank's logo is a wide wordmark, so `contain`
 * shrank it to a 30dp-wide smear that no one could read (emulator, 2026-09-05). Square
 * logos still get 30×30; wide ones get up to 120dp, capped so a banner-shaped asset
 * cannot push the community name off the row.
 */
function useLogoWidth(uri: string | null): number {
  const [width, setWidth] = useState(LOGO_HEIGHT);
  useEffect(() => {
    if (!uri) return undefined;
    let cancelled = false;
    Image.getSize(
      uri,
      (w, h) => {
        if (cancelled || !w || !h) return;
        setWidth(Math.max(LOGO_HEIGHT, Math.min(LOGO_MAX_WIDTH, Math.round((LOGO_HEIGHT * w) / h))));
      },
      () => {
        if (!cancelled) setWidth(LOGO_HEIGHT);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [uri]);
  return width;
}

export default function TenantBanner() {
  const { t } = useTranslation('home');
  const { tenant } = useTenant();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const logoUri = tenant?.branding.logo_url
    ? resolveImageUrl(tenant.branding.logo_url) ?? tenant.branding.logo_url
    : null;
  const logoWidth = useLogoWidth(logoUri);

  if (!tenant) return null;

  return (
    <Surface
      variant="default"
      className="mx-3 mt-2 flex-row items-center gap-2 overflow-hidden rounded-panel px-3 py-2"
      style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
    >
      {tenant.branding.logo_url ? (
        <Image
          source={{ uri: logoUri ?? undefined }}
          style={{ width: logoWidth, height: LOGO_HEIGHT }}
          resizeMode="contain"
          accessibilityLabel={t('tenant.logoLabel', { name: tenant.name })}
        />
      ) : (
        <View className="h-9 w-9 items-center justify-center rounded-2xl" style={{ backgroundColor: primary }}>
          <Text className="text-base font-bold" style={{ color: contrastText(primary) }}>{tenant.name.charAt(0).toUpperCase()}</Text>
        </View>
      )}
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-bold leading-5" style={{ color: theme.text }} numberOfLines={1}>
          {tenant.name}
        </Text>
        {tenant.tagline ? (
          <Text className="text-xs leading-4" style={{ color: theme.textSecondary }} numberOfLines={1}>
            {tenant.tagline}
          </Text>
        ) : null}
      </View>
    </Surface>
  );
}
