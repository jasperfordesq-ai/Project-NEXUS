// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * How far this community has got in dressing its own site ("Make it yours",
 * warmth phase 6). Reads GET /v2/admin/community-setup; never writes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { logError } from '@/lib/logger';
import { adminCommunitySetup, type CommunitySetupStatus } from '../../../api/adminApi';

export interface CommunitySetupState {
  status: CommunitySetupStatus | null;
  loading: boolean;
  /** True when the last read failed; `status` keeps the last good answer. */
  failed: boolean;
  refetch: () => Promise<void>;
}

export function useCommunitySetup(withSuggestions = true): CommunitySetupState {
  const [status, setStatus] = useState<CommunitySetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // A slow first answer must not overwrite a newer one (an upload refetches).
  const latest = useRef(0);

  const refetch = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const res = await adminCommunitySetup.get(withSuggestions);
      if (mine !== latest.current) return;
      if (res.success && res.data && Array.isArray(res.data.steps)) {
        setStatus(res.data);
        setFailed(false);
      } else {
        setFailed(true);
      }
    } catch (err) {
      if (mine !== latest.current) return;
      logError('Community setup load error', err);
      setFailed(true);
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [withSuggestions]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { status, loading, failed, refetch };
}

export default useCommunitySetup;
