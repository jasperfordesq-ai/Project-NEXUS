// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { type ReactNode, type HTMLAttributes, type MouseEvent, type Ref } from 'react';

import { motion } from '@/lib/motion';
import { ENTER, fadeUp } from '@/lib/motion/presets';
import { Card } from '@/components/ui/Card';

/** Exclude HTML event props that conflict with Framer Motion's signatures */
type SafeHtmlProps = Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'>;

export interface GlassCardProps extends SafeHtmlProps {
  children: ReactNode;
  /** Enable hover lift effect */
  hoverable?: boolean;
  /** Add glow effect */
  glow?: 'primary' | 'secondary' | 'accent' | 'none';
  /** Use Framer Motion for smooth animations */
  animated?: boolean;
}

/**
 * GlassCard - Glassmorphism card component built on HeroUI Card
 *
 * Uses centralized CSS utilities from styles/glass.css
 */
export function GlassCard(
  {
    children,
    hoverable = false,
    glow = 'none',
    animated = false,
    className = '',
    onClick,
    onKeyDown,
    ref,
    ...rest
  }: GlassCardProps & { ref?: Ref<HTMLDivElement> },
) {
    const baseClass = hoverable ? 'glass-card-hover' : 'glass-card';
    const glowClass = glow !== 'none' ? `glow-${glow}` : '';
    const combinedClassName = [baseClass, glowClass, className].filter(Boolean).join(' ');

    // When the consumer wires up onClick, forward it to HeroUI Card as onPress
    // and mark the card pressable so clicks/keyboard reliably activate it.
    // (HeroUI Card ignores native onClick unless isPressable is set.)
    const isInteractive = typeof onClick === 'function';
    const pressableProps = isInteractive
      ? {
          isPressable: true as const,
          onPress: () => onClick!({} as MouseEvent<HTMLDivElement>),
          onKeyDown,
        }
      : { onKeyDown };

    if (animated) {
      return (
        <motion.div
          ref={ref}
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          transition={ENTER}
          {...(rest as object)}
        >
          <Card
            classNames={{ base: combinedClassName }}
            shadow="none"
            radius="none"
            {...pressableProps}
          >
            {children}
          </Card>
        </motion.div>
      );
    }

    return (
      <Card
        ref={ref}
        classNames={{ base: combinedClassName }}
        shadow="none"
        radius="none"
        {...(rest as object)}
        {...pressableProps}
      >
        {children}
      </Card>
    );
}

GlassCard.displayName = 'GlassCard';

export default GlassCard;
