// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export type OnboardingStepSlug = 'welcome' | 'profile' | 'interests' | 'skills' | 'safeguarding' | 'confirm';

export interface OnboardingInterest {
  category_id: number;
  interest_type: 'interest' | 'skill_offer' | 'skill_need';
}

export interface OnboardingStatus {
  onboarding_completed: boolean;
  has_avatar: boolean;
  has_bio: boolean;
  interests: OnboardingInterest[];
}

export interface OnboardingStep {
  slug: OnboardingStepSlug;
  label_code: string;
  required: boolean;
}

export interface OnboardingConfig {
  enabled?: boolean;
  mandatory?: boolean;
  avatar_required?: boolean;
  bio_required?: boolean;
  bio_min_length?: number;
  listing_creation_mode?: string;
  listing_max_auto?: number;
  welcome_text?: string;
  help_text?: string;
  safeguarding_intro_text?: string;
  [key: string]: unknown;
}

export interface OnboardingConfiguration {
  config: OnboardingConfig;
  steps: OnboardingStep[];
}

export interface OnboardingCategory {
  id: number;
  name: string;
  slug: string | null;
  color: string | null;
}

export interface SafeguardingOption {
  id: number;
  option_key: string;
  option_type: 'checkbox' | 'info' | 'select';
  label: string;
  description?: string | null;
  help_url?: string | null;
  is_required: boolean;
  select_options?: string | null;
}

export interface SafeguardingPreference {
  option_id: number;
  value: string;
}

export interface OnboardingCompletePayload {
  interests: number[];
  offers: number[];
  needs: number[];
}

export interface OnboardingCompleteResult {
  message: string;
  listings_created: number;
  listing_ids: number[];
}

type DataEnvelope<T> = T | { data: T };

function unwrap<T>(response: DataEnvelope<T>): T {
  if (response && typeof response === 'object' && 'data' in response) {
    return (response as { data: T }).data;
  }
  return response as T;
}

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  return unwrap(await api.get<DataEnvelope<OnboardingStatus>>(`${API_V2}/onboarding/status`));
}

export async function getOnboardingConfig(): Promise<OnboardingConfiguration> {
  return unwrap(await api.get<DataEnvelope<OnboardingConfiguration>>(`${API_V2}/onboarding/config`));
}

export async function getOnboardingCategories(): Promise<OnboardingCategory[]> {
  return unwrap(await api.get<DataEnvelope<OnboardingCategory[]>>(`${API_V2}/onboarding/categories`));
}

export async function getSafeguardingOptions(): Promise<SafeguardingOption[]> {
  return unwrap(await api.get<DataEnvelope<SafeguardingOption[]>>(`${API_V2}/onboarding/safeguarding-options`));
}

export async function saveSafeguardingPreferences(preferences: SafeguardingPreference[]) {
  return unwrap(await api.post<DataEnvelope<{ message: string; preferences_count: number }>>(
    `${API_V2}/onboarding/safeguarding`,
    { preferences },
  ));
}

export async function completeOnboarding(payload: OnboardingCompletePayload): Promise<OnboardingCompleteResult> {
  return unwrap(await api.post<DataEnvelope<OnboardingCompleteResult>>(`${API_V2}/onboarding/complete`, payload));
}
