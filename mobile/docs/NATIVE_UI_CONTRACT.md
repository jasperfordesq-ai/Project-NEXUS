# Mobile Native UI Contract

Last reviewed: 2026-07-14

This app should feel like a native mobile application first, and a parity layer second.
Feature parity must not override the visual and interaction system.

## HeroUI Native Baseline

Checked against the HeroUI Native docs on 2026-05-31:

- BottomSheet: https://www.heroui.com/en/docs/native/components/bottom-sheet
- Toast: https://www.heroui.com/en/docs/native/components/toast
- Dialog: https://www.heroui.com/en/docs/native/components/dialog
- PressableFeedback: https://www.heroui.com/en/docs/native/components/pressable-feedback
- SearchField: https://www.heroui.com/en/docs/native/components/search-field
- TextArea: https://www.heroui.com/en/docs/native/components/text-area
- ListGroup: https://www.heroui.com/en/docs/native/components/list-group
- Popover: https://www.heroui.com/en/docs/native/components/popover

## Current status

- **`Alert.alert` is fully retired from product code.** Product screens and
  components use branded HeroUI Native feedback. New code
  MUST NOT introduce `Alert.alert` — use the wrappers below.
- Transient feedback → `useAppToast()` from `components/ui/AppToast.tsx`
  (`show({ title, description, variant })`; variant `danger`/`warning`/`success`/`default`).
- Yes/no confirmations → `useConfirm()` from `components/ui/useConfirm.tsx`
  (`confirm({ title, message, confirmLabel, cancelLabel, variant, onConfirm })`
  plus render `{confirmDialog}` once in the screen). See
  `docs/ALERT_MIGRATION_PLAYBOOK.md`.
- Light/dark theming is live: `useTheme()` is reactive (backed by
  `lib/theme/themeStore.ts`); the user picks System/Light/Dark in Settings.

## Rules

- Use `components/ui/BottomSheet.tsx` for mobile drawers and form/action sheets.
- Use `components/ui/AppToast.tsx` for transient success/error feedback instead of `Alert.alert`.
- Use `components/ui/useConfirm.tsx` (built on `ConfirmDialog.tsx`) for destructive or blocking confirmations.
- Use `components/ui/NativePressable.tsx` for card/list row taps instead of raw `Pressable` or button-shaped cards.
- Use `components/ui/SearchInput.tsx` for search boxes, so clear actions and search affordances are native.
- Use `components/ui/TextArea.tsx` for long mobile text entry, especially inside drawers.

## Migration Discipline

### Bottom-sheet form template

Use the shared `BottomSheet` with `scrollable`, a translated `title`, explicit
snap points for multi-field forms, and `headerActions` for Cancel and Submit.
Use the shared `Input` and `TextArea` for fields. This combination provides one
keyboard owner (Gorhom), a constrained flex viewport, focus scrolling after
keyboard/layout changes, and a bounded scrolling note editor. Do not add a second
keyboard-height padding or a percentage-height container around the form.

Keep labels visible and avoid repeating them as placeholders. Preserve drafts on
failed submission and disable duplicate submission while a request is pending.
Do not place essential actions at the end of a long form. Keep custom native
inputs wired to the same focus context when introducing them.

Verify on Android and iOS with a long note, the last field focused, keyboard
toolbar enabled, large text, and landscape. Check that the caret remains visible,
the note can scroll to its end, earlier fields remain reachable, and Cancel and
Submit remain accessible. Component tests alone do not certify these behaviours.

- Migrate by interaction pattern, not by whole page.
- Add a failing test before moving a screen to a new native primitive.
- Preserve the existing polished layout unless the test or visual audit proves it is the problem.
- Do not globally replace `Alert.alert`, `Pressable`, or `TextInput`; each replacement needs context.
- Prefer one shared primitive plus one low-risk consumer per pass.
