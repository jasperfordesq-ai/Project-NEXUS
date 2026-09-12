// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Goal {
  id: number;
  title: string;
  description: string | null;
  status: 'active' | 'completed' | 'abandoned';
  target_hours: number | null;
  progress_hours: number;
  target_value?: number | string | null;
  current_value?: number | string | null;
  deadline?: string | null;
  due_date: string | null;
  created_at: string;
  is_public?: boolean;
  is_owner?: boolean;
  is_buddy?: boolean;
  buddy_name?: string | null;
  streak_count?: number | null;
  best_streak_count?: number | null;
  progress_percentage?: number | string | null;
  checkin_frequency?: string | null;
  last_checkin_at?: string | null;
}

export interface GoalsResponse {
  data: Goal[];
  meta: {
    has_more: boolean;
    cursor: string | null;
  };
}

export interface GoalHistoryEntry {
  id: number;
  goal_id: number;
  event_type: string;
  type?: string;
  description: string;
  data?: Record<string, unknown>;
  created_at: string;
}

export interface GoalHistoryResponse {
  data: GoalHistoryEntry[];
  meta: {
    has_more: boolean;
    cursor: string | null;
  };
}

export interface GoalMilestone {
  id: number;
  title: string;
  target_percent?: number | string | null;
  target_value?: number | string | null;
  completed_at?: string | null;
}

export interface GoalBuddyNote {
  id: number;
  type: string;
  message: string | null;
  buddy_name?: string | null;
  created_at: string;
}

export interface GoalInsights {
  checkin_count?: number;
  last_checkin_at?: string | null;
  checkin_frequency?: string | null;
  next_checkin_due_at?: string | null;
  is_checkin_due?: boolean;
  streak_count?: number;
  best_streak_count?: number;
  milestones?: GoalMilestone[];
  completed_milestones?: number;
  milestone_count?: number;
  buddy_notes?: GoalBuddyNote[];
}

export type GoalReminderFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

export interface GoalReminder {
  id?: number;
  goal_id?: number;
  frequency: GoalReminderFrequency;
  enabled: boolean | number;
  next_reminder_at?: string | null;
  last_sent_at?: string | null;
}

export interface GoalTemplate {
  id: number;
  title: string;
  description?: string | null;
  category?: string | null;
  target_value?: number | string | null;
  default_target_value?: number | string | null;
  duration_days?: number | string | null;
  is_public?: boolean | number;
}

export interface GoalTemplatesResponse {
  data: GoalTemplate[];
  meta: {
    has_more: boolean;
    cursor: string | null;
  };
}

// ─── API Functions ────────────────────────────────────────────────────────────

/**
 * GET /api/v2/goals
 * Returns cursor-paginated goals for the current user.
 *
 * @param cursor  Opaque cursor string from the previous page's meta, or null for the first page
 */
export function getGoals(cursor: string | null): Promise<GoalsResponse> {
  const params: Record<string, string> = {};
  if (cursor) params['cursor'] = cursor;
  return api.get<GoalsResponse>(`${API_V2}/goals`, params);
}

export function getGoal(id: number): Promise<{ data: Goal }> {
  return api.get<{ data: Goal }>(`${API_V2}/goals/${id}`);
}

/**
 * POST /api/v2/goals
 * Creates a new goal for the current user.
 */
export function createGoal(data: {
  title: string;
  description?: string;
  target_hours?: number;
  target_value?: number;
  due_date?: string;
  deadline?: string;
}): Promise<{ data: Goal }> {
  return api.post<{ data: Goal }>(`${API_V2}/goals`, data);
}

export function getGoalTemplates(category?: string | null): Promise<GoalTemplatesResponse> {
  const params: Record<string, string> = { per_page: '50' };
  if (category) params['category'] = category;
  return api.get<GoalTemplatesResponse>(`${API_V2}/goals/templates`, params);
}

export function getGoalTemplateCategories(): Promise<{ data: string[] }> {
  return api.get<{ data: string[] }>(`${API_V2}/goals/templates/categories`);
}

export function createGoalFromTemplate(templateId: number): Promise<{ data: Goal }> {
  return api.post<{ data: Goal }>(`${API_V2}/goals/from-template/${templateId}`, {});
}

/**
 * PATCH /api/v2/goals/{id}
 * Updates the status of a goal (complete or abandon).
 */
export function updateGoalStatus(
  id: number,
  status: 'completed' | 'abandoned',
): Promise<{ data: Goal }> {
  return api.put<{ data: Goal }>(`${API_V2}/goals/${id}`, { status });
}

export function completeGoal(id: number): Promise<{ data: Goal & { idempotent_replay?: boolean } }> {
  return api.post<{ data: Goal & { idempotent_replay?: boolean } }>(`${API_V2}/goals/${id}/complete`);
}

export function updateGoalProgress(id: number, increment: number): Promise<{ data: Goal }> {
  return api.post<{ data: Goal }>(`${API_V2}/goals/${id}/progress`, { increment });
}

export function getGoalHistory(id: number): Promise<GoalHistoryResponse> {
  return api.get<GoalHistoryResponse>(`${API_V2}/goals/${id}/history`);
}

export function getGoalInsights(id: number): Promise<{ data: GoalInsights }> {
  return api.get<{ data: GoalInsights }>(`${API_V2}/goals/${id}/insights`);
}

export function getGoalReminder(id: number): Promise<{ data: GoalReminder | null }> {
  return api.get<{ data: GoalReminder | null }>(`${API_V2}/goals/${id}/reminder`);
}

export function setGoalReminder(id: number, reminder: Pick<GoalReminder, 'frequency' | 'enabled'>): Promise<{ data: GoalReminder }> {
  return api.put<{ data: GoalReminder }>(`${API_V2}/goals/${id}/reminder`, reminder);
}

export function deleteGoalReminder(id: number): Promise<void> {
  return api.delete<void>(`${API_V2}/goals/${id}/reminder`);
}
