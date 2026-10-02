// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Hook to fetch the tenant's onboarding configuration.
 *
 * Returns the full config (step toggles, profile requirements, listing mode,
 * safeguarding settings) and the ordered list of active steps. Used by
 * OnboardingPage to render a dynamic wizard based on admin settings.
 *
 * Falls back to safe defaults that match the pre-module hardcoded behavior,
 * so tenants with no configuration still get a working wizard.
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

export interface OnboardingStepConfig {
  slug: string;
  required: boolean;
}

export interface OnboardingConfig {
  enabled: boolean;
  mandatory: boolean;
  step_welcome_enabled: boolean;
  step_profile_enabled: boolean;
  step_profile_required: boolean;
  step_skills_enabled: boolean;
  step_skills_required: boolean;
  step_safeguarding_enabled: boolean;
  step_safeguarding_required: boolean;
  step_confirm_enabled: boolean;
  avatar_required: boolean;
  bio_required: boolean;
  bio_min_length: number;
  require_completion_for_visibility: boolean;
  require_avatar_for_visibility: boolean;
  require_bio_for_visibility: boolean;
  welcome_text: string | null;
  help_text: string | null;
  safeguarding_intro_text: string | null;
  country_preset: string;
}

/** Safe defaults matching pre-module hardcoded behavior */
const DEFAULT_CONFIG: OnboardingConfig = {
  enabled: true,
  mandatory: true,
  step_welcome_enabled: true,
  step_profile_enabled: true,
  step_profile_required: true,
  step_skills_enabled: true,
  step_skills_required: false,
  step_safeguarding_enabled: true,
  step_safeguarding_required: false,
  step_confirm_enabled: true,
  avatar_required: true,
  bio_required: true,
  bio_min_length: 10,
  require_completion_for_visibility: false,
  require_avatar_for_visibility: false,
  require_bio_for_visibility: false,
  welcome_text: null,
  help_text: null,
  safeguarding_intro_text: null,
  country_preset: 'custom',
};

const DEFAULT_STEPS: OnboardingStepConfig[] = [
  { slug: 'welcome', required: false },
  { slug: 'profile', required: true },
  { slug: 'skills', required: false },
  { slug: 'confirm', required: true },
];

export function useOnboardingConfig() {
  const [config, setConfig] = useState<OnboardingConfig>(DEFAULT_CONFIG);
  const [steps, setSteps] = useState<OnboardingStepConfig[]>(DEFAULT_STEPS);
  const [isLoading, setIsLoading] = useState(true);

  const loadConfig = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await api.get<{ config: OnboardingConfig; steps: OnboardingStepConfig[] }>(
        '/v2/onboarding/config'
      );

      if (res.success && res.data) {
        setConfig(res.data.config ?? DEFAULT_CONFIG);
        setSteps(
          Array.isArray(res.data.steps) && res.data.steps.length > 0
            ? res.data.steps
            : DEFAULT_STEPS
        );
      }
    } catch (error) {
      logError('Failed to load onboarding config', error);
      // Keep defaults — onboarding still works
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  return { config, steps, isLoading };
}
