// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Empty State Component
 * Displays when there's no data to show — centered, vertically stacked layout
 * with an icon in a soft-coloured circle, title, optional description, and
 * an optional call-to-action.
 *
 * The `action` prop accepts either:
 *  - A ReactNode (e.g. a pre-built <Button> or <Link>) — most flexible
 *  - An action config object `{ label, onClick, variant? }` — quick inline CTA
 *
 * Legacy props `actionLabel`/`onAction` are retained for backward compatibility.
 */

import type { ReactNode } from 'react';
import { motion } from '@/lib/motion';
import Inbox from 'lucide-react/icons/inbox';import { Button } from '@/components/ui';

/** Inline action config — alternative to passing a full ReactNode */
export interface EmptyStateActionConfig {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'tertiary' | 'outline' | 'ghost' | 'danger' | 'solid' | 'bordered' | 'light';
}

export interface EmptyStateProps {
  /**
   * Icon element to display inside the icon circle (e.g. a Lucide icon).
   * Defaults to the Inbox icon.
   */
  icon?: ReactNode;

  /**
   * Main heading text shown below the icon.
   */
  title: string;

  /**
   * Supporting description text (also accepted as `message` for back-compat).
   */
  description?: string;
  /** @deprecated Use `description` */
  message?: string;

  /**
   * Call-to-action. Accepts either:
   *  - A ReactNode (rendered as-is after the description)
   *  - An EmptyStateActionConfig object `{ label, onClick, variant? }`
   */
  action?: ReactNode | EmptyStateActionConfig;

  /**
   * Call-to-action button text (legacy — prefer `action`).
   * @deprecated Use `action`
   */
  actionLabel?: string;

  /**
   * Call-to-action handler (legacy — prefer `action`).
   * @deprecated Use `action`
   */
  onAction?: () => void;

  /**
   * Additional Tailwind classes for the root element.
   */
  className?: string;
}

/** Type-guard: returns true when `action` is an EmptyStateActionConfig object */
function isActionConfig(v: unknown): v is EmptyStateActionConfig {
  return (
    typeof v === 'object' &&
    v !== null &&
    'label' in v &&
    'onClick' in v &&
    typeof (v as EmptyStateActionConfig).label === 'string' &&
    typeof (v as EmptyStateActionConfig).onClick === 'function'
  );
}

function normalizeActionVariant(
  variant: EmptyStateActionConfig['variant'],
): 'primary' | 'secondary' | 'tertiary' | 'outline' | 'ghost' | 'danger' {
  if (variant === 'solid' || variant == null) return 'primary';
  if (variant === 'bordered') return 'secondary';
  if (variant === 'light') return 'tertiary';
  return variant;
}

export function EmptyState({
  icon,
  title,
  description,
  message,
  action,
  actionLabel,
  onAction,
  className = '',
}: EmptyStateProps) {
  const displayMessage = description || message;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex flex-col items-center justify-center py-16 text-center ${className}`}
    >
      {/*
        Icon circle, in the community colour (AWID feedback, Nov 2026: empty
        pages were a grey icon in a grey box). Every caller's icon gets one
        size and the circle's colour: callers pass anything from w-6 to w-12,
        and some add text-theme-subtle, which is unlayered CSS, so the colour
        override must be important.
      */}
      <div
        data-testid="empty-state-icon"
        className="mb-6 inline-flex size-20 items-center justify-center rounded-full bg-accent-soft text-accent-soft-foreground ring-8 ring-accent/5 [&_svg]:size-9 [&_svg]:text-accent-soft-foreground!"
        aria-hidden="true"
      >
        {icon || <Inbox />}
      </div>

      <h3 className="text-xl font-semibold text-foreground mb-2">{title}</h3>

      {displayMessage && (
        <p className="text-theme-secondary text-sm max-w-sm mb-6">{displayMessage}</p>
      )}

      {/* action: ReactNode or config object */}
      {action != null && (
        isActionConfig(action) ? (
          <Button
            variant={normalizeActionVariant(action.variant)}
            onPress={action.onClick}
            className={
              action.variant && action.variant !== 'solid' && action.variant !== 'primary'
                ? undefined
                : 'bg-gradient-to-r from-accent to-accent-gradient-end text-white font-medium'
            }
          >
            {action.label}
          </Button>
        ) : (
          action as ReactNode
        )
      )}

      {/* Legacy actionLabel / onAction */}
      {!action && actionLabel && onAction && (
        <Button
          onPress={onAction}
          className="bg-gradient-to-r from-accent to-accent-gradient-end text-white font-medium"
        >
          {actionLabel}
        </Button>
      )}
    </motion.div>
  );
}

export default EmptyState;
