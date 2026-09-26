// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import UserPlus from 'lucide-react/icons/user-plus';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl } from '@/lib/helpers';

/**
 * GoalBuddyRequests — pending buddy offers on the viewer's OWN goal.
 *
 * F-004 (E-038): offering to be a buddy no longer makes someone a buddy. The
 * goal owner sees each offer here and accepts or declines it. Renders nothing
 * when there are no pending offers or the list cannot be loaded (the API only
 * answers the owner).
 */

export interface GoalBuddyRequest {
  id: number;
  status: string;
  created_at: string | null;
  requester: {
    id: number;
    name: string;
    avatar_url: string | null;
  };
}

export interface AcceptedBuddyGoal {
  buddy_id?: number | null;
  buddy_name?: string | null;
  buddy_avatar?: string | null;
}

interface GoalBuddyRequestsProps {
  goalId: number;
  onAccepted?: (goal: AcceptedBuddyGoal) => void;
}

export function GoalBuddyRequests({ goalId, onAccepted }: GoalBuddyRequestsProps) {
  const { t } = useTranslation('gamification');
  const toast = useToast();
  const [requests, setRequests] = useState<GoalBuddyRequest[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await api.get<GoalBuddyRequest[]>(`/v2/goals/${goalId}/buddy-requests`);
      setRequests(response.success && Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      logError('Failed to load goal buddy requests', err);
      setRequests([]);
    }
  }, [goalId]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (request: GoalBuddyRequest, decision: 'accept' | 'decline') => {
    setBusyId(request.id);
    try {
      const response = await api.post<{ goal?: AcceptedBuddyGoal }>(
        `/v2/goals/${goalId}/buddy-requests/${request.id}/${decision}`,
        {}
      );
      if (response.success) {
        if (decision === 'accept') {
          toast.success(t('goals.toast.buddy_request_accepted'));
          // Accepting closes every other offer on the goal.
          setRequests([]);
          if (response.data?.goal) onAccepted?.(response.data.goal);
        } else {
          toast.success(t('goals.toast.buddy_request_declined'));
          setRequests((prev) => prev.filter((r) => r.id !== request.id));
        }
      } else {
        toast.error(t('goals.toast.buddy_request_failed'));
        load();
      }
    } catch (err) {
      logError('Failed to decide goal buddy request', err);
      toast.error(t('goals.toast.buddy_request_failed'));
    } finally {
      setBusyId(null);
    }
  };

  if (requests.length === 0) return null;

  return (
    <section className="bg-theme-elevated rounded-xl p-3 space-y-3" aria-labelledby={`goal-buddy-requests-${goalId}`}>
      <div>
        <h2 id={`goal-buddy-requests-${goalId}`} className="text-sm font-semibold text-theme-primary flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-accent" aria-hidden="true" />
          {t('goals.buddy_requests.title')}
        </h2>
        <p className="text-xs text-theme-muted mt-1">{t('goals.buddy_requests.description')}</p>
      </div>
      <ul className="space-y-2">
        {requests.map((request) => (
          <li key={request.id} className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <Avatar
                name={request.requester.name}
                src={resolveAvatarUrl(request.requester.avatar_url)}
                size="sm"
                className="w-6 h-6"
              />
              <span className="text-sm text-theme-primary font-medium truncate">{request.requester.name}</span>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                isDisabled={busyId !== null}
                aria-label={t('goals.buddy_requests.accept_aria', { name: request.requester.name })}
                onPress={() => decide(request, 'accept')}
              >
                {t('goals.buddy_requests.accept')}
              </Button>
              <Button
                size="sm"
                variant="flat"
                className="text-theme-muted"
                isDisabled={busyId !== null}
                aria-label={t('goals.buddy_requests.decline_aria', { name: request.requester.name })}
                onPress={() => decide(request, 'decline')}
              >
                {t('goals.buddy_requests.decline')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default GoalBuddyRequests;
