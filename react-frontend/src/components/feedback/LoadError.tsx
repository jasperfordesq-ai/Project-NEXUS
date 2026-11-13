// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * LoadError — the one friendly panel for "that didn't load" (warmth phase 6).
 *
 * On 13 Nov 2026 the member-facing text held 458 messages beginning "Failed
 * to…" and 107 beginning "Unable to…", most of them a page or a list that did
 * not load, each worded on its own. docs/VOICE-AND-TONE.md asks for "we", no
 * blame, and a next step. This says it once, well, in every language, in the
 * same soft scene as an empty page — so a failed load looks like the same
 * site, not a fault screen.
 *
 * Use it wherever a page, a list or a panel could not be loaded. Pass `title`
 * to name the thing in the member's words ("We couldn't load your exchanges");
 * leave it out for the general wording. Pass `onRetry` whenever trying again
 * can help: a message that says something went wrong must say what to do.
 *
 * It is an alert, so a screen reader hears it when it appears.
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import CloudOff from 'lucide-react/icons/cloud-off';
import { EmptyState } from './EmptyState';

export interface LoadErrorProps {
  /** Names what did not load, in the member's words. Defaults to the general wording. */
  title?: string;
  /** What to do next. Defaults to "try again in a moment, check your connection". */
  description?: string;
  /** Runs when the member presses "Try again". Leave out only when retrying cannot help. */
  onRetry?: () => void;
  /** A different picture for the scene. Defaults to a cloud with a line through it. */
  icon?: ReactNode;
  className?: string;
}

export function LoadError({ title, description, onRetry, icon, className = '' }: LoadErrorProps) {
  const { t } = useTranslation('common');

  return (
    <div role="alert" data-testid="load-error" className={className}>
      <EmptyState
        icon={icon ?? <CloudOff className="h-10 w-10" aria-hidden="true" />}
        title={title ?? t('couldnt_load_title')}
        description={description ?? t('couldnt_load_text')}
        action={onRetry ? { label: t('couldnt_load_retry'), onClick: onRetry } : undefined}
        className="py-10"
      />
    </div>
  );
}

export default LoadError;
