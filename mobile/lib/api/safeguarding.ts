// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The signed-in member's own safeguarding choices — the same endpoints the website's
 * settings tab and the accessible site use, so all three clients behave identically.
 *
 * Adding a choice after joining goes through `POST /v2/safeguarding/add-choice`, which
 * records consent and applies the choice exactly as onboarding does (coordinator alert,
 * summary email, protections). Only choices the community still offers to new members
 * and that the member does not hold are returned by `available-options`.
 */

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

type ApiEnvelope<T> = { success?: boolean; data?: T } | T;

export interface SafeguardingChoice {
  preference_id: number;
  option_id: number;
  option_key: string;
  label: string;
  description: string | null;
  consent_given_at: string | null;
  /** Plain-language, already-translated sentences about what this choice does. */
  effects: string[];
}

export interface AddableSafeguardingOption {
  option_id: number;
  option_key: string;
  label: string;
  description: string | null;
  effects: string[];
}

function unwrap<T>(response: ApiEnvelope<T> | null | undefined): T | undefined {
  if (response && typeof response === 'object' && 'data' in response) {
    return (response as { data?: T }).data;
  }
  return response as T | undefined;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim());
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export async function getMySafeguardingChoices(): Promise<SafeguardingChoice[]> {
  const data = unwrap(await api.get<ApiEnvelope<{ preferences?: unknown[] }>>(`${API_V2}/safeguarding/my-preferences`));
  const rows = Array.isArray(data?.preferences) ? data.preferences : [];
  return rows.flatMap((row) => {
    const item = (row ?? {}) as Record<string, unknown>;
    const optionId = Number(item.option_id);
    const label = text(item.label);
    if (!Number.isInteger(optionId) || optionId <= 0 || !label) return [];
    return [{
      preference_id: Number(item.preference_id) || 0,
      option_id: optionId,
      option_key: typeof item.option_key === 'string' ? item.option_key : '',
      label,
      description: text(item.description),
      consent_given_at: text(item.consent_given_at),
      effects: strings(item.effects),
    }];
  });
}

export async function getAddableSafeguardingOptions(): Promise<AddableSafeguardingOption[]> {
  const data = unwrap(await api.get<ApiEnvelope<{ options?: unknown[] }>>(`${API_V2}/safeguarding/available-options`));
  const rows = Array.isArray(data?.options) ? data.options : [];
  return rows.flatMap((row) => {
    const item = (row ?? {}) as Record<string, unknown>;
    const optionId = Number(item.option_id);
    const label = text(item.label);
    if (!Number.isInteger(optionId) || optionId <= 0 || !label) return [];
    return [{
      option_id: optionId,
      option_key: typeof item.option_key === 'string' ? item.option_key : '',
      label,
      description: text(item.description),
      effects: strings(item.effects),
    }];
  });
}

export function addSafeguardingChoice(optionId: number): Promise<unknown> {
  return api.post<unknown>(`${API_V2}/safeguarding/add-choice`, { option_id: optionId });
}

export function removeSafeguardingChoice(optionId: number): Promise<unknown> {
  return api.post<unknown>(`${API_V2}/safeguarding/revoke`, { option_id: optionId });
}
