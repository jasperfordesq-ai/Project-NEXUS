// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * @/lib/motion — a small, dependency-free drop-in replacement for the subset
 * of `framer-motion` this project actually used. Backed by CSS transitions
 * (not the Web Animations API) so it is jsdom-safe and degrades gracefully.
 *
 * Supported surface (everything the codebase used as of the framer removal):
 *   - motion.{div,p,h1,button,section,span,img,a,ul,li,...} (any intrinsic element)
 *   - props: initial / animate / exit / transition / variants (object + custom
 *     function variants) / whileHover / whileTap / whileFocus / whileInView +
 *     viewport / style / drag / dragConstraints / dragElastic / onDragStart /
 *     onDragEnd / custom / layout (no-op) / layoutId (no-op)
 *   - AnimatePresence (mode "wait" | "sync" | "popLayout", initial flag, custom)
 *   - MotionConfig (no-op passthrough), useReducedMotion
 *   - types: Variants, Variant, PanInfo, Transition
 *
 * Springs are approximated with eased CSS transitions. Per-property transition
 * objects collapse to a single representative timing. This is intentional —
 * see AGENTS.md ("Framer Motion has been removed").
 */

import * as React from 'react';

/* ------------------------------------------------------------------ types */

export type Variant = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Variants = Record<string, Variant | ((custom?: any) => Variant)>;

export interface Transition {
  duration?: number;
  delay?: number;
  ease?: string | number[];
  type?: 'spring' | 'tween' | 'keyframes' | string;
  stiffness?: number;
  damping?: number;
  bounce?: number;
  staggerChildren?: number;
  delayChildren?: number;
  when?: string;
  repeat?: number;
  repeatType?: string;
  [key: string]: unknown;
}

export interface PanInfo {
  point: { x: number; y: number };
  delta: { x: number; y: number };
  offset: { x: number; y: number };
  velocity: { x: number; y: number };
}

type AnimationDefinition = string | Variant | false | undefined;

interface ViewportOptions {
  once?: boolean;
  amount?: number | 'some' | 'all';
  margin?: string;
}

type DragAxis = boolean | 'x' | 'y';
type DragElastic =
  | number
  | { top?: number; bottom?: number; left?: number; right?: number };
type DragHandler = (
  event: PointerEvent | MouseEvent | TouchEvent,
  info: PanInfo,
) => void;

export interface MotionProps {
  initial?: AnimationDefinition;
  animate?: AnimationDefinition;
  exit?: AnimationDefinition;
  transition?: Transition;
  variants?: Variants;
  custom?: unknown;
  whileHover?: AnimationDefinition;
  whileTap?: AnimationDefinition;
  whileFocus?: AnimationDefinition;
  whileInView?: AnimationDefinition;
  viewport?: ViewportOptions;
  drag?: DragAxis;
  dragConstraints?: unknown;
  dragElastic?: DragElastic;
  onDragStart?: DragHandler;
  onDragEnd?: DragHandler;
  /** Layout animations are not supported by the shim — accepted and ignored. */
  layout?: boolean | string;
  layoutId?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

/* -------------------------------------------------------------- utilities */

const TRANSFORM_KEYS = new Set([
  'x', 'y', 'z', 'scale', 'scaleX', 'scaleY', 'rotate', 'rotateX', 'rotateY',
]);

const TIMING_KEYS = [
  'duration', 'delay', 'ease', 'type', 'stiffness', 'damping', 'bounce',
  'staggerChildren', 'delayChildren', 'when', 'repeat', 'repeatType',
];

function toCssLength(value: unknown): string {
  return typeof value === 'number' ? `${value}px` : String(value);
}

/** Resolve a variant label / target object / false into a plain target. */
function resolveDefinition(
  def: AnimationDefinition,
  variants?: Variants,
  custom?: unknown,
): Variant | undefined {
  if (def == null || def === false) return undefined;
  if (typeof def === 'string') {
    const v = variants?.[def];
    if (typeof v === 'function') return v(custom);
    return v as Variant | undefined;
  }
  return def;
}

/** Build a React style object (with composed transform) from a motion target. */
function buildStyle(target: Variant | undefined): React.CSSProperties {
  const style: Record<string, unknown> = {};
  if (!target) return style;
  const transforms: string[] = [];
  for (const [key, value] of Object.entries(target)) {
    if (key === 'transition') continue;
    if (TRANSFORM_KEYS.has(key)) {
      switch (key) {
        case 'x': transforms.push(`translateX(${toCssLength(value)})`); break;
        case 'y': transforms.push(`translateY(${toCssLength(value)})`); break;
        case 'z': transforms.push(`translateZ(${toCssLength(value)})`); break;
        case 'scale': transforms.push(`scale(${value})`); break;
        case 'scaleX': transforms.push(`scaleX(${value})`); break;
        case 'scaleY': transforms.push(`scaleY(${value})`); break;
        case 'rotate':
          transforms.push(`rotate(${typeof value === 'number' ? `${value}deg` : value})`);
          break;
        case 'rotateX':
          transforms.push(`rotateX(${typeof value === 'number' ? `${value}deg` : value})`);
          break;
        case 'rotateY':
          transforms.push(`rotateY(${typeof value === 'number' ? `${value}deg` : value})`);
          break;
      }
    } else {
      style[key] = value;
    }
  }
  if (transforms.length) style.transform = transforms.join(' ');
  return style as React.CSSProperties;
}

/** Collapse a (possibly per-property) transition into a single timing object. */
function flattenTransition(t?: Transition): Transition {
  if (!t) return {};
  const hasTiming = Object.keys(t).some((k) => TIMING_KEYS.includes(k));
  if (hasTiming) return t;
  const childObjects = Object.values(t).filter(
    (v): v is Transition => !!v && typeof v === 'object',
  );
  if (childObjects.length) {
    // Representative = the longest-running sub-transition.
    const first = childObjects[0] as Transition;
    return childObjects.reduce(
      (longest, cur) =>
        ((cur.duration ?? 0) > (longest.duration ?? 0) ? cur : longest),
      first,
    );
  }
  return t;
}

function easingFor(t: Transition): string {
  if (t.type === 'spring') return 'cubic-bezier(0.22, 1, 0.36, 1)';
  const ease = t.ease;
  if (Array.isArray(ease) && ease.length === 4) return `cubic-bezier(${ease.join(',')})`;
  switch (ease) {
    case 'easeOut': return 'cubic-bezier(0, 0, 0.2, 1)';
    case 'easeIn': return 'cubic-bezier(0.4, 0, 1, 1)';
    case 'easeInOut': return 'cubic-bezier(0.4, 0, 0.2, 1)';
    case 'linear': return 'linear';
    case 'circOut': return 'cubic-bezier(0, 0.55, 0.45, 1)';
    case 'anticipate': return 'cubic-bezier(0.34, 1.56, 0.64, 1)';
    default: return 'cubic-bezier(0, 0, 0.2, 1)';
  }
}

function durationMs(t: Transition): number {
  const ft = flattenTransition(t);
  const seconds = ft.duration != null ? ft.duration : ft.type === 'spring' ? 0.45 : 0.3;
  return Math.max(0, seconds * 1000);
}

function delayMs(t: Transition): number {
  const ft = flattenTransition(t);
  return Math.max(0, (ft.delay ?? 0) * 1000);
}

const TRANSITION_PROPS =
  'transform, opacity, height, width, max-height, filter, background-color, border-color, color, box-shadow';

/* ------------------------------------------------------------ context(s) */

interface PresenceCtx {
  isPresent: boolean;
  onExitComplete?: () => void;
  custom?: unknown;
  skipInitial?: boolean;
}
const PresenceContext = React.createContext<PresenceCtx | null>(null);

interface VariantCtx {
  initial?: AnimationDefinition;
  animate?: AnimationDefinition;
  custom?: unknown;
  staggerChildren?: number;
  delayChildren?: number;
  nextIndex: () => number;
}
const VariantContext = React.createContext<VariantCtx | null>(null);

/* --------------------------------------------------------- reduced motion */

/**
 * True when movement should be left out: the device asks for reduced motion,
 * or the member switched it on in the app (Settings → Accessibility, which
 * ThemeContext writes to `data-reduced-motion` on <html>). Until Nov 2026
 * only the device setting was read, so a member who chose it in the app still
 * got components that decide for themselves whether to move (warmth plan P6).
 */
const get = () => {
  if (typeof window === 'undefined') return false;
  if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-reduced-motion') === 'true') {
    return true;
  }
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState<boolean>(get);
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => setReduced(get());
    handler();
    const mql = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    mql?.addEventListener?.('change', handler);
    const observer = typeof MutationObserver === 'function' ? new MutationObserver(handler) : null;
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduced-motion'] });
    return () => {
      mql?.removeEventListener?.('change', handler);
      observer?.disconnect();
    };
  }, []);
  return reduced;
}

/* ---------------------------------------------------------- motion factory */

function createMotionComponent(tag: string) {
  const Component = React.forwardRef<HTMLElement, MotionProps & Record<string, unknown>>(
    function MotionComponent(props, forwardedRef) {
      const {
        initial,
        animate,
        exit,
        transition,
        variants,
        custom,
        whileHover,
        whileTap,
        whileFocus,
        whileInView,
        viewport,
        drag,
        dragConstraints: _dragConstraints,
        dragElastic,
        onDragStart,
        onDragEnd,
        layout: _layout,
        layoutId: _layoutId,
        style: userStyle,
        children,
        onPointerDown: userPointerDown,
        ...rest
      } = props as MotionProps & Record<string, unknown>;

      const presence = React.use(PresenceContext);
      const parentVariants = React.use(VariantContext);
      const reduced = useReducedMotion();

      const localRef = React.useRef<HTMLElement | null>(null);
      const setRef = React.useCallback(
        (node: HTMLElement | null) => {
          localRef.current = node;
          if (typeof forwardedRef === 'function') forwardedRef(node);
          else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLElement | null>).current = node;
        },
        [forwardedRef],
      );

      // Inherit animation labels from a parent variant container when unset.
      const effInitial = initial !== undefined ? initial : parentVariants?.initial;
      const effAnimate = animate !== undefined ? animate : parentVariants?.animate;
      const effCustom = custom !== undefined ? custom : (presence?.custom ?? parentVariants?.custom);

      const isPresent = presence ? presence.isPresent : true;
      const skipInitial = presence?.skipInitial ?? false;

      // Stagger index (claimed once) when inheriting from a stagger container.
      const indexRef = React.useRef<number | null>(null);
      if (indexRef.current === null && parentVariants && initial === undefined && animate === undefined) {
        indexRef.current = parentVariants.nextIndex();
      }

      const [hovered, setHovered] = React.useState(false);
      const [tapped, setTapped] = React.useState(false);
      const [focused, setFocused] = React.useState(false);
      const [inView, setInView] = React.useState(false);
      // `ready` gates the transition so the first paint (initial state) is instant.
      const [ready, setReady] = React.useState(false);
      const [dragVisual, setDragVisual] = React.useState<{ x: number; y: number } | null>(null);

      React.useEffect(() => {
        const id = requestAnimationFrame(() => setReady(true));
        return () => cancelAnimationFrame(id);
      }, []);

      // whileInView via IntersectionObserver.
      React.useEffect(() => {
        if (whileInView === undefined) return;
        const node = localRef.current;
        if (!node || typeof IntersectionObserver === 'undefined') {
          setInView(true); // no observer support → just show
          return;
        }
        const amount = viewport?.amount;
        const threshold = amount === 'all' ? 0.99 : amount === 'some' ? 0 : typeof amount === 'number' ? amount : 0.15;
        const observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) {
                setInView(true);
                if (viewport?.once) observer.disconnect();
              } else if (!viewport?.once) {
                setInView(false);
              }
            }
          },
          { threshold, rootMargin: viewport?.margin },
        );
        observer.observe(node);
        return () => observer.disconnect();
      }, [whileInView, viewport?.amount, viewport?.once, viewport?.margin]);

      // Resolve the base target for the current phase.
      const resolvedAnimate = resolveDefinition(effAnimate, variants, effCustom);
      const resolvedInitial = resolveDefinition(effInitial, variants, effCustom);
      const resolvedExit = resolveDefinition(exit, variants, effCustom);

      let baseTarget: Variant | undefined;
      let activeTransition: Transition | undefined;

      if (!isPresent) {
        baseTarget = resolvedExit;
        activeTransition = (resolvedExit?.transition as Transition) ?? transition;
      } else if (whileInView !== undefined) {
        const shown = resolveDefinition(whileInView, variants, effCustom) ?? resolvedAnimate;
        baseTarget = inView ? shown : resolvedInitial;
        activeTransition = (shown?.transition as Transition) ?? transition;
      } else {
        const showAnimate = ready || skipInitial || effInitial === false;
        baseTarget = showAnimate ? resolvedAnimate : resolvedInitial;
        activeTransition = (resolvedAnimate?.transition as Transition) ?? transition;
      }

      // Overlay interaction states (merged on top of base).
      let merged: Variant = { ...(baseTarget ?? {}) };
      if (isPresent && hovered && whileHover !== undefined) {
        merged = { ...merged, ...resolveDefinition(whileHover, variants, effCustom) };
      }
      if (isPresent && focused && whileFocus !== undefined) {
        merged = { ...merged, ...resolveDefinition(whileFocus, variants, effCustom) };
      }
      if (isPresent && tapped && whileTap !== undefined) {
        merged = { ...merged, ...resolveDefinition(whileTap, variants, effCustom) };
      }

      const animatedStyle = buildStyle(merged);

      // Stagger / inherited delay.
      const inheritedDelaySec =
        parentVariants && indexRef.current !== null
          ? (parentVariants.delayChildren ?? 0) + indexRef.current * (parentVariants.staggerChildren ?? 0)
          : 0;

      // Transition styling (skipped while dragging or before first paint).
      const transitionStyle: React.CSSProperties = {};
      const dragging = dragVisual !== null;
      if (ready && !dragging) {
        const ft = flattenTransition(activeTransition);
        const ms = reduced ? 0 : durationMs(activeTransition ?? {});
        const dms = reduced ? 0 : delayMs(activeTransition ?? {}) + inheritedDelaySec * 1000;
        transitionStyle.transitionProperty = TRANSITION_PROPS;
        transitionStyle.transitionDuration = `${ms}ms`;
        transitionStyle.transitionTimingFunction = easingFor(ft);
        transitionStyle.transitionDelay = `${dms}ms`;
      } else {
        transitionStyle.transition = 'none';
      }

      // Compose drag visual transform on top of the base transform.
      let composedStyle: React.CSSProperties = { ...animatedStyle, ...transitionStyle };
      if (dragVisual) {
        const baseTransform = (animatedStyle.transform as string) ?? '';
        composedStyle.transform = `${baseTransform} translate(${dragVisual.x}px, ${dragVisual.y}px)`.trim();
      }
      composedStyle = { ...composedStyle, ...userStyle };

      // ---- exit lifecycle: when removed by AnimatePresence, time the unmount.
      React.useEffect(() => {
        if (!presence || presence.isPresent) return;
        if (resolvedExit === undefined || reduced) {
          presence.onExitComplete?.();
          return;
        }
        const total = durationMs((resolvedExit.transition as Transition) ?? transition ?? {})
          + delayMs((resolvedExit.transition as Transition) ?? transition ?? {});
        const id = setTimeout(() => presence.onExitComplete?.(), total + 30);
        return () => clearTimeout(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [presence?.isPresent]);

      // ---- drag handling -------------------------------------------------
      const dragData = React.useRef<{
        startX: number; startY: number;
        lastX: number; lastY: number; lastT: number;
        pointerId: number;
      } | null>(null);

      const elasticFactor = React.useCallback(
        (axis: 'x' | 'y', delta: number): number => {
          if (dragElastic == null) return delta; // default: free move within drag
          if (typeof dragElastic === 'number') return delta * dragElastic;
          const side =
            axis === 'y' ? (delta >= 0 ? dragElastic.bottom : dragElastic.top)
              : (delta >= 0 ? dragElastic.right : dragElastic.left);
          return delta * (side ?? 0);
        },
        [dragElastic],
      );

      const handlePointerDown = React.useCallback(
        (e: React.PointerEvent) => {
          (userPointerDown as React.PointerEventHandler | undefined)?.(e);
          if (!drag) return;
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
          dragData.current = {
            startX: e.clientX, startY: e.clientY,
            lastX: e.clientX, lastY: e.clientY, lastT: performance.now(),
            pointerId: e.pointerId,
          };
          setDragVisual({ x: 0, y: 0 });
          onDragStart?.(e.nativeEvent, {
            point: { x: e.clientX, y: e.clientY },
            delta: { x: 0, y: 0 }, offset: { x: 0, y: 0 }, velocity: { x: 0, y: 0 },
          });
        },
        [drag, onDragStart, userPointerDown],
      );

      // Keyed on the null↔non-null transition (not dragVisual itself) so the
      // window listeners attach once per drag instead of on every pointermove.
      const dragActive = dragVisual !== null;
      React.useEffect(() => {
        if (!drag || !dragActive) return;
        const onMove = (e: PointerEvent) => {
          const d = dragData.current;
          if (!d || e.pointerId !== d.pointerId) return;
          const dx = drag === 'y' ? 0 : e.clientX - d.startX;
          const dy = drag === 'x' ? 0 : e.clientY - d.startY;
          d.lastX = e.clientX; d.lastY = e.clientY; d.lastT = performance.now();
          setDragVisual({ x: elasticFactor('x', dx), y: elasticFactor('y', dy) });
        };
        const onUp = (e: PointerEvent) => {
          const d = dragData.current;
          if (!d || e.pointerId !== d.pointerId) return;
          const dx = drag === 'y' ? 0 : e.clientX - d.startX;
          const dy = drag === 'x' ? 0 : e.clientY - d.startY;
          const dt = Math.max(performance.now() - d.lastT, 1) / 1000;
          const vx = (e.clientX - d.lastX) / dt;
          const vy = (e.clientY - d.lastY) / dt;
          dragData.current = null;
          setDragVisual(null); // springs back to base via transition
          onDragEnd?.(e, {
            point: { x: e.clientX, y: e.clientY },
            delta: { x: vx * dt, y: vy * dt },
            offset: { x: dx, y: dy },
            velocity: { x: vx, y: vy },
          });
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        return () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
        };
      }, [drag, dragActive, elasticFactor, onDragEnd]);

      // ---- interaction handlers (only wired when the prop is present) ----
      const handlers: Record<string, unknown> = {};
      if (whileHover !== undefined) {
        const prevEnter = rest.onPointerEnter; const prevLeave = rest.onPointerLeave;
        handlers.onPointerEnter = (e: React.PointerEvent) => { setHovered(true); (prevEnter as React.PointerEventHandler)?.(e); };
        handlers.onPointerLeave = (e: React.PointerEvent) => { setHovered(false); setTapped(false); (prevLeave as React.PointerEventHandler)?.(e); };
      }
      if (whileTap !== undefined) {
        const prevDown = rest.onPointerDown; const prevUp = rest.onPointerUp;
        handlers.onPointerDown = (e: React.PointerEvent) => { setTapped(true); (prevDown as React.PointerEventHandler)?.(e); };
        handlers.onPointerUp = (e: React.PointerEvent) => { setTapped(false); (prevUp as React.PointerEventHandler)?.(e); };
      }
      if (whileFocus !== undefined) {
        handlers.onFocus = (e: React.FocusEvent) => { setFocused(true); (rest.onFocus as React.FocusEventHandler)?.(e); };
        handlers.onBlur = (e: React.FocusEvent) => { setFocused(false); (rest.onBlur as React.FocusEventHandler)?.(e); };
      }

      // Provide a variant context to descendants when acting as a stagger container.
      const staggerTransition = flattenTransition(
        (resolvedAnimate?.transition as Transition) ?? transition,
      );
      const providesVariants =
        variants !== undefined &&
        (typeof effAnimate === 'string' || typeof effInitial === 'string');
      const indexCounter = React.useRef(0);
      const childContext = React.useMemo<VariantCtx | null>(() => {
        if (!providesVariants) return null;
        return {
          initial: typeof effInitial === 'string' ? effInitial : undefined,
          animate: typeof effAnimate === 'string' ? effAnimate : undefined,
          custom: effCustom,
          staggerChildren: staggerTransition.staggerChildren,
          delayChildren: staggerTransition.delayChildren,
          nextIndex: () => indexCounter.current++,
        };
      }, [providesVariants, effInitial, effAnimate, effCustom, staggerTransition.staggerChildren, staggerTransition.delayChildren]);

      const finalDragProps = drag ? { onPointerDown: handlePointerDown } : {};

      const element = React.createElement(
        tag,
        {
          ...rest,
          ...handlers,
          ...finalDragProps,
          ref: setRef,
          style: composedStyle,
        },
        children,
      );

      return childContext
        ? React.createElement(VariantContext.Provider, { value: childContext }, element)
        : element;
    },
  );
  (Component as unknown as { __isMotion: boolean }).__isMotion = true;
  Component.displayName = `motion.${tag}`;
  return Component;
}

/* ------------------------------------------------------------ motion proxy */

type MotionProxy = {
  [K in keyof React.JSX.IntrinsicElements]: React.ForwardRefExoticComponent<
    Omit<React.JSX.IntrinsicElements[K], 'style' | 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'> &
    MotionProps &
    React.RefAttributes<Element>
  >;
};

const motionCache = new Map<string, ReturnType<typeof createMotionComponent>>();

export const motion = new Proxy({} as MotionProxy, {
  get(target, prop: string | symbol, receiver) {
    if (typeof prop === 'symbol') {
      return Reflect.get(target, prop, receiver);
    }
    if (prop in Object.prototype) {
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    }
    if (!motionCache.has(prop)) motionCache.set(prop, createMotionComponent(prop));
    return motionCache.get(prop);
  },
}) as MotionProxy;

/* --------------------------------------------------------- AnimatePresence */

export interface AnimatePresenceProps {
  children?: React.ReactNode;
  mode?: 'wait' | 'sync' | 'popLayout';
  initial?: boolean;
  custom?: unknown;
  onExitComplete?: () => void;
}

function isMotionElement(el: React.ReactElement | undefined): boolean {
  return !!el && !!(el.type as { __isMotion?: boolean })?.__isMotion;
}

export function AnimatePresence({
  children,
  initial = true,
  custom,
  onExitComplete,
}: AnimatePresenceProps) {
  const present = React.Children.toArray(children).filter(
    React.isValidElement,
  ) as React.ReactElement[];
  const presentKeys = present.map((c) => String(c.key));
  const presentMap = new Map(present.map((c) => [String(c.key), c]));

  const elementCache = React.useRef(new Map<string, React.ReactElement>());
  present.forEach((c) => elementCache.current.set(String(c.key), c));

  const [displayedKeys, setDisplayedKeys] = React.useState<string[]>(presentKeys);
  const firstMount = React.useRef(true);

  React.useEffect(() => {
    setDisplayedKeys((prev) => {
      const merged: string[] = [];
      for (const key of prev) {
        if (presentKeys.includes(key)) merged.push(key);
        else if (isMotionElement(elementCache.current.get(key))) merged.push(key); // keep to animate out
        // non-motion removed children drop immediately
      }
      for (const key of presentKeys) if (!merged.includes(key)) merged.push(key);
      const changed =
        merged.length !== prev.length || merged.some((k, i) => k !== prev[i]);
      return changed ? merged : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentKeys.join('|')]);

  React.useEffect(() => {
    firstMount.current = false;
  }, []);

  const removeKey = React.useCallback(
    (key: string) => {
      setDisplayedKeys((prev) => {
        const next = prev.filter((k) => k !== key);
        if (next.length === 0) onExitComplete?.();
        return next;
      });
      elementCache.current.delete(key);
    },
    [onExitComplete],
  );

  const skipInitial = firstMount.current && !initial;

  return React.createElement(
    React.Fragment,
    null,
    ...displayedKeys.map((key) => {
      const isPresent = presentMap.has(key);
      const element = presentMap.get(key) ?? elementCache.current.get(key);
      if (!element) return null;
      return React.createElement(
        PresenceContext.Provider,
        {
          key,
          value: {
            isPresent,
            onExitComplete: () => removeKey(key),
            custom,
            skipInitial,
          },
        },
        element,
      );
    }),
  );
}

/* ------------------------------------------------------------ MotionConfig */

export interface MotionConfigProps {
  children?: React.ReactNode;
  reducedMotion?: 'always' | 'never' | 'user';
  transition?: Transition;
}

/** No-op passthrough — reduced-motion is handled per-component via media query. */
export function MotionConfig({ children }: MotionConfigProps) {
  return React.createElement(React.Fragment, null, children);
}

export default motion;
