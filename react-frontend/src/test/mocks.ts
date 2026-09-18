// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Shared test mocks for common dependencies
 */
import React from 'react';

/**
 * Framer Motion mock - creates a Proxy that handles all motion.* components
 */
const motionProps = [
  'variants', 'initial', 'animate', 'exit', 'transition',
  'whileHover', 'whileTap', 'whileInView', 'whileFocus', 'whileDrag',
  'layout', 'layoutId', 'viewport', 'drag', 'dragConstraints',
  'dragElastic', 'dragMomentum', 'onDragStart', 'onDragEnd',
  'onAnimationStart', 'onAnimationComplete', 'style',
];

/** Mirrors the tag-keyed shape of the real `@/lib/motion` proxy. */
type MotionProxy = {
  [K in keyof React.JSX.IntrinsicElements]: React.ComponentType<any>;
};

/**
 * One component per tag, created once and reused.
 *
 * The Proxy MUST return a stable identity for a given tag. `<motion.div>` is
 * evaluated on every render of its parent, so if each access produced a fresh
 * function React would treat it as a different component type and unmount and
 * remount the entire subtree beneath it on every single render. Queries then
 * resolve to a node that is detached microseconds later, which surfaces as an
 * intermittent "element could not be found in the document" in whichever suite
 * loses the race. The real shim caches for the same reason — see `motionCache`
 * in `src/lib/motion/index.tsx`.
 */
const motionComponentCache = new Map<string, React.ComponentType<any>>();

function getMotionComponent(tag: string): React.ComponentType<any> {
  const cached = motionComponentCache.get(tag);
  if (cached) return cached;
  const Component = ({ children, ref, ...props }: any) => {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      if (!motionProps.includes(k)) clean[k] = v;
    }
    return React.createElement(tag, { ...clean, ref }, children);
  };
  Component.displayName = `motion.${tag}`;
  motionComponentCache.set(tag, Component);
  return Component;
}

export const framerMotionMock = {
  motion: new Proxy({} as MotionProxy, {
    get: (_target: MotionProxy, prop: string | symbol) =>
      getMotionComponent(typeof prop === 'string' ? prop : 'div'),
  }) as MotionProxy,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useAnimation: () => ({ start: () => Promise.resolve() }),
  useInView: () => true,
  useMotionValue: (initial: number) => ({ get: () => initial, set: () => {} }),
  useTransform: () => ({ get: () => 0 }),
  useSpring: () => ({ get: () => 0 }),
};
