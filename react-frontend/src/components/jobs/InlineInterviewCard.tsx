// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import Calendar from 'lucide-react/icons/calendar';
import Clock from 'lucide-react/icons/clock';
import MapPin from 'lucide-react/icons/map-pin';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import Video from 'lucide-react/icons/video';
import CalendarPlus from 'lucide-react/icons/calendar-plus';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { useToast } from '@/contexts';
import { formatDateTime } from '@/lib/helpers';
import { safeHref, webHref } from '@/lib/safeHref';
import type { InlineInterview } from './JobDetailTypes';

interface InlineInterviewCardProps {
  pendingInterview: InlineInterview;
  isResponding: boolean;
  onAccept: () => void;
  onDeclineOpen: () => void;
}

export function InlineInterviewCard({
  pendingInterview,
  isResponding,
  onAccept,
  onDeclineOpen,
}: InlineInterviewCardProps) {
  const { t } = useTranslation('jobs');
  const toast = useToast();

  if (pendingInterview.status !== 'proposed') return null;

  // F-298: both values are typed by the employer; only a web URL becomes a link.
  // location_notes is prose, so it is a link only when it is an absolute web URL.
  const meetingHref = safeHref(pendingInterview.meeting_link);
  const locationHref = webHref(pendingInterview.location_notes);

  return (
    <GlassCard className="p-5 border-l-4 border-l-accent bg-accent-soft">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-accent-soft flex items-center justify-center flex-shrink-0">
          <Calendar className="w-5 h-5 text-accent" aria-hidden="true" />
        </div>
        <div className="flex-1 space-y-3">
          <div>
            <h3 className="text-base font-semibold text-theme-primary">
              {t('inline_response.interview_pending')}
            </h3>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-theme-secondary">
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
                {formatDateTime(pendingInterview.scheduled_at)}
              </span>
              <Chip size="sm" variant="tertiary" color="accent">
                {t(`interview.type_${pendingInterview.interview_type}`)}
              </Chip>
              {pendingInterview.duration_mins && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                  {pendingInterview.duration_mins} {t('interview.minutes')}
                </span>
              )}
            </div>
            {meetingHref && (
              <div className="mt-2">
                <Button
                  as="a"
                  href={meetingHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  size="sm"
                  color="success"
                  variant="flat"
                  startContent={<Video className="w-3.5 h-3.5" aria-hidden="true" />}
                >
                  {t('interview.join_call')}
                </Button>
              </div>
            )}
            {pendingInterview.id && (
              <div className="mt-2 flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="flat"
                  onPress={() => {
                    // api.download carries the sign-in token; a plain link sent none (401).
                    api.download(`/v2/jobs/interviews/${pendingInterview.id}/calendar`, {
                      filename: 'interview.ics',
                    }).catch(() => toast.error(t('common:errors.download_failed')));
                  }}
                  startContent={<CalendarPlus className="w-3.5 h-3.5" aria-hidden="true" />}
                >
                  {t('interview.download_ics')}
                </Button>
              </div>
            )}
            {pendingInterview.location_notes && (
              <p className="text-sm text-theme-muted mt-1">
                {pendingInterview.interview_type === 'video' && !meetingHref ? (
                  locationHref ? (
                    <a
                      href={locationHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline"
                    >
                      {pendingInterview.location_notes}
                    </a>
                  ) : (
                    <span>{pendingInterview.location_notes}</span>
                  )
                ) : pendingInterview.interview_type !== 'video' ? (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                    {pendingInterview.location_notes}
                  </span>
                ) : null}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              color="success"
              size="sm"
              isLoading={isResponding}
              onPress={onAccept}
              startContent={<CheckCircle className="w-4 h-4" aria-hidden="true" />}
            >
              {t('inline_response.interview_accept')}
            </Button>
            <Button
              color="danger"
              variant="flat"
              size="sm"
              isDisabled={isResponding}
              onPress={onDeclineOpen}
              startContent={<XCircle className="w-4 h-4" aria-hidden="true" />}
            >
              {t('inline_response.interview_decline')}
            </Button>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
