// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The member window, openable from anywhere in the broker panel.
 *
 * Until October 2026 the member window (MemberDetailModal) lived inside the
 * Members page and could only be reached from that page's row menu. Every
 * other place a member's name appears — an exchange, a message copy, a
 * monitoring row, a risk tag — showed plain text. This provider mounts the
 * window once, in BrokerLayout, and drives it from the `?member=<id>` search
 * parameter, so:
 *
 *   - any page can open it with `useMemberWindow().open(id)`;
 *   - the open window survives a reload and can be linked to;
 *   - closing it removes only that one parameter, keeping the page's filters.
 *
 * `MemberName` is the one way names should be rendered across the panel: a
 * button styled as a link that opens the window, with an accessible label.
 */

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import MemberDetailModal from './components/MemberDetailModal';

export const MEMBER_WINDOW_PARAM = 'member';

interface MemberWindowApi {
  /** The member currently shown, or null when the window is closed. */
  openId: number | null;
  open: (userId: number) => void;
  close: () => void;
}

const noop: MemberWindowApi = { openId: null, open: () => undefined, close: () => undefined };
const MemberWindowContext = createContext<MemberWindowApi>(noop);

function parseMemberParam(value: string | null): number | null {
  if (!value) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function BrokerMemberWindowProvider({ children }: { children: ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = parseMemberParam(searchParams.get(MEMBER_WINDOW_PARAM));

  const open = useCallback(
    (userId: number) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(MEMBER_WINDOW_PARAM, String(userId));
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  const close = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(MEMBER_WINDOW_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  const api = useMemo<MemberWindowApi>(() => ({ openId, open, close }), [openId, open, close]);

  return (
    <MemberWindowContext.Provider value={api}>
      {children}
      {/* The modal's own writes fire API_WRITE_EVENT, which every broker list
          already listens to (useBrokerAutoRefresh), so onChanged needs no
          extra plumbing here. */}
      <MemberDetailModal userId={openId} onClose={close} onChanged={() => undefined} />
    </MemberWindowContext.Provider>
  );
}

/** Open or close the panel-wide member window. Safe (no-op) without a provider. */
export function useMemberWindow(): MemberWindowApi {
  return useContext(MemberWindowContext);
}

interface MemberNameProps {
  userId: number | null | undefined;
  name: string | null | undefined;
  className?: string;
}

/**
 * A member's name as a link-styled button that opens the member window.
 * Falls back to plain text when there is no id to open.
 */
export function MemberName({ userId, name, className = '' }: MemberNameProps) {
  const { t } = useTranslation('broker');
  const { open } = useMemberWindow();
  const label = name?.trim() || t('common.unknown_member');

  if (!userId) {
    return <span className={className}>{label}</span>;
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        // Inside a clickable table row the row must not also fire.
        e.stopPropagation();
        open(userId);
      }}
      aria-label={t('common.open_member', { name: label })}
      className={`inline max-w-full truncate text-left font-medium text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${className}`}
    >
      {label}
    </button>
  );
}

export default BrokerMemberWindowProvider;
