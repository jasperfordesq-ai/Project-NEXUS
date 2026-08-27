// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { GlassCard } from '@/components/ui/GlassCard';
/**
 * Group Tasks Tab (I5)
 * Renders the TeamTasks ideation component for a group.
 */

import { useTranslation } from 'react-i18next';
import { TeamTasks } from '@/components/ideation';
import type { GroupMember } from './GroupMembersTab';
import { resolveUserDisplayName } from '@/lib/helpers';

interface GroupTasksTabProps {
  groupId: number;
  isGroupAdmin: boolean;
  members: GroupMember[];
}

export function GroupTasksTab({ groupId, isGroupAdmin, members }: GroupTasksTabProps) {
  const { t } = useTranslation('groups');
  const taskMembers = (members || []).map((m) => ({
    id: m.id,
    name: resolveUserDisplayName(m, t('member_fallback')),
    avatar_url: m.avatar_url ?? m.avatar ?? null,
  }));

  return (
    <GlassCard className="p-6">
      <TeamTasks
        groupId={groupId}
        isGroupAdmin={isGroupAdmin}
        members={taskMembers}
      />
    </GlassCard>
  );
}
