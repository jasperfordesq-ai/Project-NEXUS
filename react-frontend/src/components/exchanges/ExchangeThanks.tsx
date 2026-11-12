// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The thank-you a member sees when their confirmation completes an exchange
 * (AWID feedback, Nov 2026: "energy, warmth, and community"): a soft panel in
 * the community colour, a short burst of confetti in the community's colours
 * (none with reduced motion — the shared shim skips it), and their year so far:
 * how many people they have exchanged with and how many hours, from the
 * server's `thanks` on POST /v2/exchanges/{id}/confirm.
 *
 * It is a status message, so a screen reader announces it when it appears.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import HeartHandshake from 'lucide-react/icons/heart-handshake';
import X from 'lucide-react/icons/x';
import MessageCircleHeart from 'lucide-react/icons/message-circle-heart';
import { Link } from 'react-router-dom';
import { Button, Card, CardBody } from '@/components/ui';
import { ConfettiCelebration } from '@/components/ui/ConfettiCelebration';
import { useSiteAccent } from '@/contexts/SiteAccentContext';
import { confettiColoursFor } from '@/lib/confettiColours';
import { getFormattingLocale, resolveAvatarUrl } from '@/lib/helpers';
import { Avatar } from '@/components/ui/Avatar';

interface ExchangeThanksProps {
  neighbours: number;
  hours: number;
  onClose: () => void;
  /** The other person's name, for "Send … a thank-you message". */
  partnerName?: string;
  /** Where that message is written; no button when messaging is unavailable. */
  messageHref?: string;
  /** The other person's photo; with no photo their coloured initials show. */
  partnerAvatar?: string | null;
}

const STANDARD_ACCENT = '#5b5ede';

export function ExchangeThanks({ neighbours, hours, onClose, partnerName, messageHref, partnerAvatar }: ExchangeThanksProps) {
  const { t } = useTranslation('exchanges');
  const accent = useSiteAccent() ?? STANDARD_ACCENT;
  const panelRef = useRef<HTMLDivElement>(null);

  // The community's own colour, a lighter shade of it, and warm companions.
  const confettiColours = useMemo(
    () => confettiColoursFor(accent),
    [accent],
  );

  // The confirm dialog has just closed; bring the panel into view.
  useEffect(() => {
    panelRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);

  const format = (n: number) => n.toLocaleString(getFormattingLocale(), { maximumFractionDigits: 2 });

  return (
    <div ref={panelRef} role="status" className="relative">
      <Card data-testid="exchange-thanks" className="relative overflow-hidden border-0 bg-accent-soft shadow-none">
        <ConfettiCelebration show colors={confettiColours} />
        <CardBody className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
          {/* The person you just exchanged with, with the handshake as a small
              badge on their picture (warmth plan P10). Without a name to show,
              the handshake stands alone as before. Decorative either way: the
              name is in the button below. */}
          {partnerName ? (
            <span className="relative shrink-0" aria-hidden="true">
              <Avatar
                data-testid="exchange-thanks-face"
                src={resolveAvatarUrl(partnerAvatar)}
                name={partnerName}
                size="lg"
                className="size-14 ring-2 ring-[var(--surface-solid)]"
              />
              <span
                data-testid="exchange-thanks-icon"
                className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full bg-accent-strong text-white shadow-sm ring-2 ring-[var(--surface-solid)]"
              >
                <HeartHandshake className="size-3.5" aria-hidden="true" />
              </span>
            </span>
          ) : (
            <span
              data-testid="exchange-thanks-icon"
              className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent-strong text-white shadow-sm"
            >
              <HeartHandshake className="size-6" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold leading-tight text-theme-primary">{t('thanks.title')}</h2>
            <p className="mt-1 text-sm leading-6 text-theme-secondary">{t('thanks.body')}</p>
            {partnerName && messageHref && (
              <Button
                as={Link}
                to={messageHref}
                size="sm"
                className="mt-3 bg-accent-strong text-white shadow-sm"
                startContent={<MessageCircleHeart className="size-4" aria-hidden="true" />}
              >
                {t('thanks.send_message', { name: partnerName })}
              </Button>
            )}
          </div>
          <dl className="grid shrink-0 grid-cols-2 gap-2 sm:w-72">
            <div className="flex flex-col-reverse rounded-xl bg-white/70 px-3 py-2 text-center dark:bg-white/10">
              <dt className="text-xs leading-4 text-theme-secondary">{t('thanks.neighbours_label')}</dt>
              <dd className="text-2xl font-bold text-theme-primary">{format(neighbours)}</dd>
            </div>
            <div className="flex flex-col-reverse rounded-xl bg-white/70 px-3 py-2 text-center dark:bg-white/10">
              <dt className="text-xs leading-4 text-theme-secondary">{t('thanks.hours_label')}</dt>
              <dd className="text-2xl font-bold text-theme-primary">{format(hours)}</dd>
            </div>
          </dl>
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            aria-label={t('thanks.close')}
            onPress={onClose}
            className="absolute end-2 top-2 sm:static"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}

export default ExchangeThanks;
