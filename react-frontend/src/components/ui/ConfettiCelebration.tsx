// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ConfettiCelebration — Particle burst animation for milestone celebrations.
 *
 * Renders 20 confetti particles with a center icon burst.
 * Uses Framer Motion. Must be inside a `position: relative` container.
 */

import { motion, AnimatePresence } from '@/lib/motion';
import PartyPopper from 'lucide-react/icons/party-popper';
import { useConfettiColours } from '@/lib/confettiColours';

/**
 * `colors` is optional: without it the burst is in the colours of the site as
 * the member sees it (the community's colour, a lighter shade and three warm
 * companions), so every celebration matches the community by default.
 */
export function ConfettiCelebration({ show, colors }: { show: boolean; colors?: readonly string[] }) {
  const siteColours = useConfettiColours();
  if (!show) return null;

  const palette = colors && colors.length > 0 ? colors : siteColours;
  const particles = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    x: Math.random() * 200 - 100,
    y: -(Math.random() * 200 + 50),
    rotation: Math.random() * 360,
    scale: Math.random() * 0.5 + 0.5,
    color: palette[Math.floor(Math.random() * palette.length)],
  }));

  return (
    <AnimatePresence>
      {show && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-10">
          {particles.map((p) => (
            <motion.div
              key={p.id}
              initial={{ x: '50%', y: '50%', opacity: 1, scale: p.scale, rotate: 0 }}
              animate={{
                x: `calc(50% + ${p.x}px)`,
                y: `calc(50% + ${p.y}px)`,
                opacity: 0,
                rotate: p.rotation,
              }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.2, ease: 'easeOut' }}
              className="absolute w-3 h-3 rounded-sm"
              style={{ backgroundColor: p.color }}
            />
          ))}
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 1.2, 1], opacity: [0, 1, 0] }}
            transition={{ duration: 1.5, times: [0, 0.3, 1] }}
            className="absolute inset-0 flex items-center justify-center"
          >
            <PartyPopper className="w-16 h-16 text-amber-400" />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
