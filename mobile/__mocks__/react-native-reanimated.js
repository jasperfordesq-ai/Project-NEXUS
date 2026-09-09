// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
//
// Self-contained Jest mock for react-native-reanimated.
// Avoids the native react-native-worklets initialisation that fails in Jest.
// Provides enough stubs for all components in this codebase.

'use strict';

const React = require('react');

const NOOP = () => {};
const ID = (v) => v;

// Shared value — holds .value, no actual animation.
// Includes .get()/.set() for reanimated v4 compatibility.
const makeSharedValue = (init) => {
  const sv = {
    value: init,
    _isSharedValue: true,
    get: () => sv.value,
    set: (v) => { sv.value = typeof v === 'function' ? v(sv.value) : v; },
    addListener: () => () => {},
    removeListener: () => {},
  };
  return sv;
};

// useSharedValue
const useSharedValue = (init) => makeSharedValue(init);

// useDerivedValue
const useDerivedValue = (fn) => {
  try { return makeSharedValue(fn()); } catch { return makeSharedValue(undefined); }
};

// useAnimatedStyle — just return the plain style object
const useAnimatedStyle = (fn) => fn();

// useAnimatedScrollHandler
const useAnimatedScrollHandler = () => NOOP;

// useAnimatedRef
const useAnimatedRef = () => ({ current: null });

// Spring / timing / decay — return the target value immediately (no animation)
const withSpring = (value) => value;
const withTiming = (value) => value;
const withDecay = () => 0;
const withDelay = (_delay, animation) => animation;
const withSequence = (...animations) => animations[animations.length - 1];
const withRepeat = (animation) => animation;

// cancelAnimation / stopClock
const cancelAnimation = NOOP;

// interpolate
const interpolate = (value, inputRange, outputRange) => {
  const index = inputRange.findIndex((v, i) => v >= value || i === inputRange.length - 1);
  return outputRange[Math.max(0, index)];
};

// Extrapolation enum
const Extrapolation = { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' };

// scrollTo
const scrollTo = NOOP;

// runOnUI / runOnJS
const runOnUI = (fn) => fn;
const runOnJS = (fn) => fn;

// measure
const measure = () => null;

// Easing
const Easing = {
  linear: ID,
  ease: ID,
  quad: ID,
  cubic: ID,
  poly: () => ID,
  sin: ID,
  circle: ID,
  exp: ID,
  elastic: () => ID,
  back: () => ID,
  bounce: ID,
  bezier: () => ID,
  bezierFn: () => ID,
  steps: () => ID,
  in: ID,
  out: ID,
  inOut: ID,
};

// FadeIn / FadeOut layout animations (noop)
// Layout animation stubs — each returns itself so chains like .duration(300) work
const layoutStub = () => {
  const stub = {
    duration: () => stub, delay: () => stub, springify: () => stub,
    damping: () => stub, stiffness: () => stub, mass: () => stub,
    overshootClamping: () => stub, restDisplacementThreshold: () => stub,
    restSpeedThreshold: () => stub, withInitialValues: () => stub,
    randomDelay: () => stub, easing: () => stub, rotate: () => stub,
    build: () => NOOP,
  };
  return stub;
};
const FadeIn = layoutStub();
const FadeInUp = layoutStub();
const FadeInDown = layoutStub();
const FadeOut = layoutStub();
const FadeOutUp = layoutStub();
const FadeOutDown = layoutStub();
const SlideInRight = layoutStub();
const SlideInLeft = layoutStub();
const SlideInUp = layoutStub();
const SlideInDown = layoutStub();
const SlideOutLeft = layoutStub();
const SlideOutRight = layoutStub();
const SlideOutUp = layoutStub();
const SlideOutDown = layoutStub();
const Layout = layoutStub();
const ZoomIn = layoutStub();
const ZoomOut = layoutStub();
const LinearTransition = layoutStub();
const StretchInX = layoutStub();
const StretchInY = layoutStub();
const StretchOutX = layoutStub();
const StretchOutY = layoutStub();

// Keyframe — constructor stub; heroui-native creates instances with `new Keyframe({...})`
class Keyframe {
  constructor(_def) {}
  duration() { return this; }
  delay() { return this; }
}

// EntryExitAnimationBuilder stubs used by heroui-native animation types
const BounceIn = layoutStub();
const BounceOut = layoutStub();
const FlipInEasyX = layoutStub();
const FlipOutEasyX = layoutStub();

// Animated object — wrap React Native's Animated but add Reanimated specifics
const RNAnimated = require('react-native').Animated;

const Animated = {
  ...RNAnimated,
  createAnimatedComponent: (Component) => {
    const AnimatedComponent = React.forwardRef((props, ref) =>
      React.createElement(Component, { ...props, ref })
    );
    AnimatedComponent.displayName = `Animated(${Component.displayName || Component.name || 'Component'})`;
    return AnimatedComponent;
  },
  View: require('react-native').View,
  Text: require('react-native').Text,
  Image: require('react-native').Image,
  ScrollView: require('react-native').ScrollView,
  FlatList: require('react-native').FlatList,
  // `@gorhom/bottom-sheet`'s scrollables call these on the DEFAULT export
  // (`Animated.addWhitelistedUIProps(...)`) at module load, so a test that renders
  // the shared BottomSheet wrapper (which imports BottomSheetScrollView) needs them here,
  // not only on module.exports below.
  addWhitelistedNativeProps: NOOP,
  addWhitelistedUIProps: NOOP,
};

// useAnimatedGestureHandler
const useAnimatedGestureHandler = NOOP;

// useAnimatedProps
const useAnimatedProps = (fn) => fn();

// useReducedMotion
const useReducedMotion = () => false;

// useComposedEventHandler
const useComposedEventHandler = (...handlers) => handlers[0] || NOOP;

// clamp
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

module.exports = {
  // Tell babel interop this is already ESM-shaped so `import Animated from '...'`
  // gets Animated (not the whole module.exports object).
  __esModule: true,
  default: Animated,
  Animated,
  useSharedValue,
  useDerivedValue,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  useAnimatedRef,
  useAnimatedGestureHandler,
  useAnimatedProps,
  useAnimatedReaction: NOOP,
  withSpring,
  withTiming,
  withDecay,
  withDelay,
  withSequence,
  withRepeat,
  cancelAnimation,
  interpolate,
  interpolateColor: (value, inputRange, outputRange) => outputRange[0],
  Extrapolation,
  Easing,
  runOnUI,
  runOnJS,
  scrollTo,
  measure,
  clamp,
  Keyframe,
  FadeIn, FadeInUp, FadeInDown,
  FadeOut, FadeOutUp, FadeOutDown,
  SlideInRight, SlideInLeft, SlideInUp, SlideInDown,
  SlideOutLeft, SlideOutRight, SlideOutUp, SlideOutDown,
  Layout,
  ZoomIn, ZoomOut,
  LinearTransition,
  StretchInX, StretchInY, StretchOutX, StretchOutY,
  BounceIn, BounceOut,
  FlipInEasyX, FlipOutEasyX,
  useReducedMotion,
  useComposedEventHandler,
  createAnimatedComponent: Animated.createAnimatedComponent,
  addWhitelistedNativeProps: NOOP,
  addWhitelistedUIProps: NOOP,
  setGestureState: NOOP,
  enableLayoutAnimations: NOOP,
  ReduceMotion: { System: 'system', Always: 'always', Never: 'never' },
};
