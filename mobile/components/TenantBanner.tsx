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

/**
 * 🔴 The banner is the LOGO and nothing else (owner instruction, 2026-09-07).
 *
 * It used to show the logo, then the community's name and tagline beside it — three things
 * saying who you are, in a strip at the top of the feed. The owner asked for the name and
 * tagline to go and the logo to take the room they were using. A brand mark is what a
 * member recognises; the name is on the More screen, the picker and the sign-in screen.
 *
 * The logo is therefore twice the height it was (30 → 60) and may run to nearly the full
 * width of the row. A community with no logo still gets its initial in a branded square,
 * because the strip exists to say WHICH community this is.
 */
const LOGO_HEIGHT = 60;
const LOGO_MAX_WIDTH = 260;

/**
 * Width for the logo box from the image's own aspect ratio.
 *
 * 🔴 This was a fixed 30×30 box. Hour Timebank's logo is a wide wordmark, so `contain`
 * shrank it to a 30dp-wide smear that no one could read (emulator, 2026-09-05). Square
 * logos get a square box; wide ones get up to `LOGO_MAX_WIDTH`, which is a cap rather than
 * a target so a banner-shaped asset cannot overflow the row on a narrow phone.
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
      className="mx-3 mt-2 items-center justify-center overflow-hidden rounded-panel px-3 py-2"
      style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
      testID="tenant-banner"
    >
      {tenant.branding.logo_url ? (
        <Image
          source={{ uri: logoUri ?? undefined }}
          style={{ width: logoWidth, height: LOGO_HEIGHT }}
          resizeMode="contain"
          /*
            The community's name is now carried entirely by this label: with the visible
            name gone, a screen reader would otherwise announce nothing at all for the
            strip. The logo is information here, not decoration.
          */
          accessibilityLabel={t('tenant.logoLabel', { name: tenant.name })}
          testID="tenant-banner-logo"
        />
      ) : (
        <View
          className="items-center justify-center rounded-2xl"
          style={{ backgroundColor: primary, width: LOGO_HEIGHT, height: LOGO_HEIGHT }}
          accessibilityLabel={t('tenant.logoLabel', { name: tenant.name })}
          testID="tenant-banner-initial"
        >
          <Text className="text-2xl font-bold" style={{ color: contrastText(primary) }}>
            {tenant.name.charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
    </Surface>
  );
}
