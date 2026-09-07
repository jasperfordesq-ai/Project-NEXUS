// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export interface Skill {
  id: number;
  name: string;
  category: string | null;
  endorsement_count?: number;
}

export interface Endorsement {
  id: number;
  skill: Skill;
  endorsed_by: {
    id: number;
    name: string;
    avatar: string | null;
  };
  message: string | null;
  created_at: string;
}

export interface EndorsementsResponse {
  data: Endorsement[];
  meta: {
    total: number;
    has_more: boolean;
    cursor: string | null;
  };
}

export interface UserSkillsResponse {
  data: {
    skills: Skill[];
    endorsements: Endorsement[];
  };
}

export interface SkillCategory {
  id: number;
  name: string;
  slug?: string | null;
  description?: string | null;
  icon?: string | null;
  skills_count?: number | string | null;
  children?: SkillCategory[];
}

export interface CategorySkill {
  skill_name: string;
  user_count: number | string;
  offering_count?: number | string | null;
  requesting_count?: number | string | null;
}

export interface SkillCategoryDetail extends SkillCategory {
  skills: CategorySkill[];
}

export interface SkillMember {
  id: number;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  avatar?: string | null;
  proficiency_level?: string | null;
  is_offering?: boolean | number | null;
  is_requesting?: boolean | number | null;
}

interface RawUserSkill {
  id?: number;
  skill_name?: string | null;
  name?: string | null;
  category_name?: string | null;
  category?: string | null;
  endorsement_count?: number | string | null;
}

interface RawEndorsementGroup {
  skill_name?: string | null;
  count?: number | string | null;
  endorsed_by_names?: string | null;
  endorsed_by_ids?: string | null;
  endorsed_by_avatars?: string | null;
  latest_endorsement?: string | null;
}

interface RawEndorsementsResponse {
  data?: {
    endorsements?: RawEndorsementGroup[];
    stats?: Record<string, unknown>;
  } | RawEndorsementGroup[];
  meta?: EndorsementsResponse['meta'];
}

function normalizeSkill(raw: RawUserSkill): Skill {
  return {
    id: raw.id ?? 0,
    name: raw.name ?? raw.skill_name ?? '',
    category: raw.category ?? raw.category_name ?? null,
    endorsement_count: raw.endorsement_count != null ? Number(raw.endorsement_count) : undefined,
  };
}

function splitCsv(value?: string | null): string[] {
  if (!value) return [];
  return value.split(',').map((part) => part.trim());
}

function normalizeEndorsementGroups(groups: RawEndorsementGroup[]): Endorsement[] {
  return groups.flatMap((group, groupIndex) => {
    const skillName = group.skill_name ?? '';
    const names = splitCsv(group.endorsed_by_names);
    const ids = splitCsv(group.endorsed_by_ids);
    const avatars = splitCsv(group.endorsed_by_avatars);
    const fallbackCount = Math.max(Number(group.count ?? 0), 1);
    const rows = names.length > 0 ? names : Array.from({ length: fallbackCount }, () => '');

    return rows.map((name, index) => ({
      id: Number(ids[index] ?? 0) || Number(`${groupIndex + 1}${index + 1}`),
      skill: {
        id: groupIndex + 1,
        name: skillName,
        category: null,
      },
      endorsed_by: {
        id: Number(ids[index] ?? 0),
        name: name || skillName,
        avatar: avatars[index] || null,
      },
      message: null,
      created_at: group.latest_endorsement ?? '',
    }));
  });
}

/**
 * GET /api/v2/members/{userId}/endorsements — endorsements for a user.
 */
export function getUserEndorsements(
  userId: number,
  cursor?: string | null,
): Promise<EndorsementsResponse> {
  const params: Record<string, string> = {};
  if (cursor) params['cursor'] = cursor;
  return api.get<RawEndorsementsResponse>(`${API_V2}/members/${userId}/endorsements`, params)
    .then((response) => {
      const groups = Array.isArray(response.data) ? response.data : response.data?.endorsements ?? [];
      const endorsements = normalizeEndorsementGroups(groups);
      return {
        data: endorsements,
        meta: response.meta ?? {
          total: endorsements.length,
          has_more: false,
          cursor: null,
        },
      };
    });
}

/**
 * GET /api/v2/users/me/skills — current user's skills and endorsements received.
 */
export function getMySkills(): Promise<UserSkillsResponse> {
  return api.get<{ data?: RawUserSkill[] }>(`${API_V2}/users/me/skills`)
    .then((response) => ({
      data: {
        skills: (response.data ?? []).map(normalizeSkill),
        endorsements: [],
      },
    }));
}

/**
 * POST /api/v2/members/{userId}/endorse — endorse a skill on another member's profile.
 *
 * 🔴 This function had ZERO callers app-wide, so no member could endorse anyone from the
 * app: endorsements could only ever arrive from the website. Worse, it would not have
 * worked if it had been called — it sent `skill_id` alone, and `EndorsementService::endorse`
 * requires `skill_name` and refuses without it (`skill_id` is optional and only stored).
 * A profile's skills come back as plain strings, so the name is what the caller has.
 * Found by the 2026-09-07 audit (F/F-3).
 *
 * Refusals worth passing on: 409 `ALREADY_ENDORSED`, and 422 `SELF_ENDORSEMENT`.
 */
export function endorseSkill(
  userId: number,
  skillName: string,
  comment?: string,
): Promise<{ data: { endorsement_id: number; message: string } }> {
  return api.post<{ data: { endorsement_id: number; message: string } }>(
    `${API_V2}/members/${userId}/endorse`,
    {
      skill_name: skillName,
      ...(comment ? { comment } : {}),
    },
  );
}

/**
 * DELETE /api/v2/members/{userId}/endorse — take back an endorsement you gave.
 */
export function removeSkillEndorsement(
  userId: number,
  skillName: string,
): Promise<{ data: { message: string } }> {
  // Sent as a query parameter: `api.delete` carries no body, and the controller reads
  // `input('skill_name') ?? query('skill_name')` for exactly this reason.
  return api.delete<{ data: { message: string } }>(
    `${API_V2}/members/${userId}/endorse`,
    { params: { skill_name: skillName } },
  );
}

/**
 * POST /api/v2/users/me/skills — add a new skill to the current user's profile.
 */
export function addSkill(skillName: string): Promise<{ data: Skill }> {
  return api.post<{ data?: RawUserSkill[] }>(`${API_V2}/users/me/skills`, { skill_name: skillName })
    .then((response) => ({
      data: normalizeSkill((response.data ?? []).find((skill) => skill.skill_name === skillName) ?? {
        id: 0,
        skill_name: skillName,
      }),
    }));
}

/**
 * DELETE /api/v2/users/me/skills/{skillId} — remove a skill from the current user's profile.
 */
export function removeSkill(skillId: number): Promise<void> {
  return api.delete<void>(`${API_V2}/users/me/skills/${skillId}`);
}

/**
 * GET /api/v2/skills/search — search available skills for autocomplete/picker.
 */
export function getAvailableSkills(query = ''): Promise<{ data: Skill[] }> {
  const trimmed = query.trim();
  if (!trimmed) {
    return Promise.resolve({ data: [] });
  }

  return api.get<{ data?: RawUserSkill[] }>(`${API_V2}/skills/search`, { q: trimmed })
    .then((response) => ({ data: (response.data ?? []).map(normalizeSkill) }));
}

export function getSkillCategories(): Promise<{ data: SkillCategory[] }> {
  return api.get<{ data: SkillCategory[] }>(`${API_V2}/skills/categories`);
}

export function getSkillCategory(id: number): Promise<{ data: SkillCategoryDetail }> {
  return api.get<{ data: SkillCategoryDetail }>(`${API_V2}/skills/categories/${id}`);
}

export function getMembersWithSkill(skillName: string, limit = 30): Promise<{ data: SkillMember[] }> {
  return api.get<{ data: SkillMember[] }>(`${API_V2}/skills/members`, {
    skill: skillName,
    limit: String(limit),
  });
}
