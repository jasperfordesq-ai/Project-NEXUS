// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import type { CanonicalEvent, EventAgendaSession } from './api/events';
import type { AgendaSessionPayload } from './api/eventAgendaManagement';
import { eventIsoToLocalInput, eventLocalInputToIso } from './utils/eventDateTime';
import { agendaPayloadSchema } from './eventAgendaOperation';

export interface AgendaDraft {
  title: string; description: string; type: AgendaSessionPayload['session_type'];
  visibility: AgendaSessionPayload['visibility']; start: string; end: string;
  track: string; room: string; capacity: string;
  speakers: { userId?: number; name: string; role: string }[];
  resources: AgendaSessionPayload['resources'];
}
export function agendaDraft(event: CanonicalEvent, session?: EventAgendaSession, input?: AgendaSessionPayload): AgendaDraft {
  const zone = event.schedule.timezone;
  return {
    title: input?.title ?? session?.title ?? '', description: input ? input.description ?? '' : session?.description ?? '',
    type: input?.session_type ?? session?.type ?? 'session', visibility: input?.visibility ?? session?.visibility ?? 'public',
    start: eventIsoToLocalInput(input?.start_at ?? session?.start_at ?? event.schedule.start_at, zone),
    end: eventIsoToLocalInput(input?.end_at ?? session?.end_at ?? event.schedule.end_at, zone),
    track: input ? input.track_name ?? '' : session?.track ?? '', room: input ? input.room_name ?? '' : session?.room ?? '',
    capacity: String((input ? input.capacity : session?.capacity.limit) ?? ''),
    speakers: input ? input.speakers.map(s => ({ userId: s.user_id, name: s.display_name ?? '', role: s.role_label ?? '' }))
      : session?.speakers.map(s => ({ userId: s.member_id ?? undefined, name: s.display_name ?? '', role: s.role ?? '' })) ?? [],
    // Do not silently drop unavailable resources when replacing the complete resource list.
    resources: input?.resources.map(r => ({ ...r })) ?? session?.resources.map(r => ({
      type: r.type, title: r.title, url: r.url ?? '', visibility: r.visibility,
    })) ?? [],
  };
}
export function agendaPayload(draft: AgendaDraft, event: CanonicalEvent): AgendaSessionPayload | null {
  const start = eventLocalInputToIso(draft.start, event.schedule.timezone);
  const end = eventLocalInputToIso(draft.end, event.schedule.timezone);
  if (!start || !end || Date.parse(end) <= Date.parse(start)
    || (event.schedule.start_at && Date.parse(start) < Date.parse(event.schedule.start_at))
    || (event.schedule.end_at && Date.parse(end) > Date.parse(event.schedule.end_at))) return null;
  if (draft.capacity !== '' && !/^[1-9]\d*$/.test(draft.capacity)) return null;
  if (draft.speakers.some(s => !s.userId && !s.name.trim())) return null;
  if (draft.resources.some(r => {
    try { const url = new URL(r.url); return url.protocol !== 'https:' || !!url.username || !!url.password
      || !r.title.trim() || ((r.type === 'stream' || r.type === 'recording') && r.visibility === 'public'); }
    catch { return true; }
  })) return null;
  const result = agendaPayloadSchema.safeParse({ title: draft.title.trim(), description: draft.description || null,
    session_type: draft.type, visibility: draft.visibility, start_at: start, end_at: end, timezone: event.schedule.timezone,
    track_name: draft.track.trim() || null, room_name: draft.room.trim() || null,
    capacity: draft.capacity ? Number(draft.capacity) : null,
    speakers: draft.speakers.map(s => ({ ...(s.userId ? { user_id: s.userId } : { display_name: s.name.trim() }), role_label: s.role.trim() || null })),
    resources: draft.resources.map(r => ({ ...r, title: r.title.trim() })),
  });
  return result.success ? result.data : null;
}
