// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { categoryColour } from '@/lib/categoryColours';

interface ExploreStatCardProps {
  icon: LucideIcon;
  label: string;
  value: number;
  suffix?: string;
  /** A colour from the community palette for the icon tile (default: the accent). */
  colour?: string;
}

/**
 * Animated counter card for community stats.
 * Counts up when the value changes from 0 to a real number.
 */
export function ExploreStatCard({ icon: Icon, label, value, suffix = '', colour }: ExploreStatCardProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (value === 0) return;

    // Clear any in-progress animation
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    const duration = 1200;
    const steps = 40;
    const stepTime = duration / steps;
    let current = 0;
    const increment = value / steps;

    timerRef.current = setInterval(() => {
      current += increment;
      if (current >= value) {
        setDisplayValue(value);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      } else {
        setDisplayValue(Math.floor(current));
      }
    }, stepTime);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [value]);

  const formattedValue = Number.isInteger(displayValue)
    ? displayValue.toLocaleString(getFormattingLocale())
    : displayValue.toFixed(1);

  return (
    <div className="flex flex-col items-center gap-2 p-4 sm:p-5 min-w-[140px]">
      <div
        data-testid="explore-stat-icon"
        className={`flex items-center justify-center w-10 h-10 rounded-xl ${
          colour ? categoryColour(colour).band : 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
        }`}
      >
        <Icon className="w-5 h-5" aria-hidden="true" />
      </div>
      <span className="text-2xl sm:text-3xl font-bold text-[var(--text-primary)] tabular-nums">
        {formattedValue}{suffix}
      </span>
      <span className="text-xs sm:text-sm text-[var(--text-muted)] text-center">
        {label}
      </span>
    </div>
  );
}
