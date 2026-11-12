// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Doodle — a drawing of people from Open Doodles (Pablo Stanley, CC0 public
 * domain; see THIRD_PARTY_LICENSES.md), warmth plan C2 (12 Nov 2026).
 *
 * The highlight shape takes the community colour (`--accent`) and the line work
 * takes the text colour, so a drawing suits every community and both themes.
 * Each drawing is loaded only by the page that shows it. Decoration only:
 * hidden from screen readers, and it simply stays empty if it cannot load.
 */

import { useEffect, useState } from 'react';
import type { DoodleData } from './doodles/types';

const LOADERS = {
  chilling: () => import('./doodles/chilling'),
  coffee: () => import('./doodles/coffee'),
  dancing: () => import('./doodles/dancing'),
  float: () => import('./doodles/float'),
  jumping: () => import('./doodles/jumping'),
  loving: () => import('./doodles/loving'),
  reading: () => import('./doodles/reading'),
  selfie: () => import('./doodles/selfie'),
  sittingReading: () => import('./doodles/sittingReading'),
  strolling: () => import('./doodles/strolling'),
  unboxing: () => import('./doodles/unboxing'),
} as const;

export type DoodleName = keyof typeof LOADERS;
export const DOODLE_NAMES = Object.keys(LOADERS) as DoodleName[];

const loaded = new Map<DoodleName, DoodleData>();

export interface DoodleProps {
  name: DoodleName;
  className?: string;
}

export function Doodle({ name, className = 'w-56 max-w-full h-auto' }: DoodleProps) {
  const [data, setData] = useState<DoodleData | null>(() => loaded.get(name) ?? null);

  useEffect(() => {
    const cached = loaded.get(name);
    if (cached) {
      setData(cached);
      return undefined;
    }
    let alive = true;
    setData(null);
    LOADERS[name]()
      .then((module) => {
        loaded.set(name, module.default);
        if (alive) setData(module.default);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [name]);

  return (
    <svg
      viewBox={data?.viewBox ?? '0 0 1024 768'}
      xmlns="http://www.w3.org/2000/svg"
      className={`text-[var(--text-primary)] ${className}`}
      aria-hidden="true"
      focusable="false"
      data-doodle={name}
    >
      {data && (
        <>
          <path data-doodle-part="accent" d={data.accent} fill="var(--accent)" fillRule="evenodd" />
          <g data-doodle-part="ink" transform={data.inkTransform} fill="currentColor" fillRule="evenodd">
            {data.ink.map((d, index) => (
              <path key={index} d={d} />
            ))}
          </g>
        </>
      )}
    </svg>
  );
}

export default Doodle;
