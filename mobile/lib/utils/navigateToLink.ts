// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Linking } from 'react-native';
import { router, type Href } from 'expo-router';
import { mapSystemPathToNativeRoute } from '@/app/+native-intent';
import { reportException, reportMessage, safeLinkSummary } from '@/lib/observability/report';
import { isSafeExternalBrowserLink } from '@/lib/utils/safeExternalLink';
import { isNativeHrefDisabled } from '@/lib/navigation/tenantCapabilityStore';
import { sessionNoticeStore } from '@/lib/notices/sessionNoticeStore';
// The i18next singleton, not '@/lib/i18n' — same reason as lib/utils/dateLocale.ts.
import i18n from 'i18next';

/**
 * Navigate a platform web/custom-scheme link through the same canonical mapper used by
 * Android App Links and iOS Universal Links. Keeping one route contract prevents push taps
 * from lagging behind newer native modules while cold-start App Links continue to work.
 */
export function navigateToLink(link: string | null): void {
  if (!link) return;

  if (isSafeExternalBrowserLink(link)) {
    void Linking.openURL(link).catch((error) => {
      reportException(error, { tags: { module: 'push-external-cta' } });
    });
    return;
  }

  const mappedHref = mapSystemPathToNativeRoute(link);
  if (!mappedHref) {
    reportMessage(
      '[DeepLink] Unhandled link',
      { link: safeLinkSummary(link) },
      'deeplink-unhandled'
    );
    return;
  }
  if (isNativeHrefDisabled(mappedHref)) {
    /*
      The community has switched this module off. This used to push the notifications
      list — which, tapped FROM the notifications list, stacked a second copy of the same
      screen on top of the first (audit 2026-09-07, B/F-11). Say so where the member is
      instead; nothing about a disabled module is improved by moving them.
    */
    sessionNoticeStore.publish({
      title: i18n.t('common:featureUnavailable.title'),
      description: i18n.t('common:featureUnavailable.subtitle'),
      variant: 'warning',
    });
    return;
  }

  const target = routerTarget(mappedHref);
  if (mappedHref.startsWith('/(tabs)/')) {
    router.replace(target);
  } else {
    router.push(target);
  }
}

function routerTarget(mappedHref: string): Href {
  const queryIndex = mappedHref.indexOf('?');
  if (queryIndex === -1) return mappedHref as Href;

  const pathname = mappedHref.slice(0, queryIndex);
  const search = mappedHref.slice(queryIndex + 1);
  return {
    pathname,
    params: Object.fromEntries(new URLSearchParams(search).entries()),
  } as Href;
}
