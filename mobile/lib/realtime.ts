// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import Pusher from 'pusher-js';

import { authenticatedApiIdentity } from '@/lib/api/client';
import { API_BASE_URL } from '@/lib/constants';

export interface PusherConfig {
  key: string;
  cluster: string;
  enabled: boolean;
  channels?: {
    user: string;
    presence: string;
  };
  userId?: number;
}

let pusherClient: Pusher | null = null;

/**
 * Initialize the Pusher client with a custom authorizer that injects
 * the Bearer token and X-Tenant-Slug header into every channel auth request.
 */
export function initRealtime(config: PusherConfig): Pusher | null {
  if (!config.enabled || !config.key) return null;

  // Tear down any existing connection first
  if (pusherClient) {
    pusherClient.disconnect();
    pusherClient = null;
  }

  pusherClient = new Pusher(config.key, {
    cluster: config.cluster ?? 'eu',
    forceTLS: true,
    disableStats: true,
    authorizer: (channel) => ({
      authorize: async (socketId, callback) => {
        try {
          const { token, tenantSlug } = await authenticatedApiIdentity();

          const body = [
            `socket_id=${encodeURIComponent(socketId)}`,
            `channel_name=${encodeURIComponent(channel.name)}`,
          ].join('&');

          const headers: Record<string, string> = {
            'Content-Type': 'application/x-www-form-urlencoded',
          };
          headers['Authorization'] = `Bearer ${token}`;
          headers['X-Tenant-Slug'] = tenantSlug;

          const res = await fetch(`${API_BASE_URL}/api/pusher/auth`, {
            method: 'POST',
            headers,
            body,
          });

          if (!res.ok) {
            callback(new Error(`Auth failed: ${res.status}`), null);
            return;
          }

          const data = (await res.json()) as { auth: string; channel_data?: string };
          callback(null, data);
        } catch (err) {
          callback(err instanceof Error ? err : new Error('Auth error'), null);
        }
      },
    }),
  });

  return pusherClient;
}

export function getRealtimeClient(): Pusher | null {
  return pusherClient;
}

export function disconnectRealtime(): void {
  if (pusherClient) {
    pusherClient.disconnect();
    pusherClient = null;
  }
}
