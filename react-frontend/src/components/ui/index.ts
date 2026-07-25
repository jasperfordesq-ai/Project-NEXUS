// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Glass UI Components - Centralized exports
export { GlassCard, type GlassCardProps } from './GlassCard';
export { GlassInput, type GlassInputProps } from './GlassInput';
export { Surface, type SurfaceProps } from './Surface';
export { Typography, type TypographyProps } from './Typography';

// UX Components
export { BottomSheet, type BottomSheetProps } from './BottomSheet';
// Shared phone filter primitives (sticky bar + sheet + chip groups)
export {
  MobileFilterBar,
  type MobileFilterBarProps,
  type MobileFilterBarChip,
  type MobileFilterBarLabels,
} from './MobileFilterBar';
export { FilterSheet, type FilterSheetProps, type FilterSheetLabels } from './FilterSheet';
export { FilterChipGroup, type FilterChipGroupProps, type FilterChipOption } from './FilterChipGroup';
export {
  FILTER_ACCENT_CLASSES,
  filterAccentClasses,
  type FilterAccent,
  type FilterAccentClasses,
} from './filterAccent';
export { BackToTop } from './BackToTop';
export { AlgorithmLabel, useAlgorithmInfo } from './AlgorithmLabel';
export { ImagePlaceholder } from './ImagePlaceholder';
export { DynamicIcon, ICON_MAP, ICON_NAMES } from './DynamicIcon';
export { ConfettiCelebration } from './ConfettiCelebration';
export { Alert, type AlertProps } from './Alert';
export { AlertDialog, type AlertDialogProps } from './AlertDialog';
export { Link, type LinkProps } from './Link';
export { Breadcrumbs, type BreadcrumbsProps } from './Breadcrumbs';
export { Separator, type SeparatorProps } from './Separator';
export { Code, type CodeProps } from './Code';
export { Snippet, type SnippetProps } from './Snippet';
export { Progress, type ProgressProps } from './Progress';
export {
  Meter,
  MeterOutput,
  MeterTrack,
  MeterFill,
  type MeterProps,
  type MeterOutputProps,
  type MeterTrackProps,
  type MeterFillProps,
} from './Meter';
export { TimeInput, type TimeInputProps, type TimeInputValue } from './TimeInput';
export { DatePicker, type DatePickerProps, type DateInputValue } from './DatePicker';
export { DateField, type DateFieldProps } from './DateField';
export { DateRangePicker, type DateRangePickerProps } from './DateRangePicker';
export { Calendar, type CalendarProps } from './Calendar';
export { RangeCalendar, type RangeCalendarProps } from './RangeCalendar';
export { ColorPicker, type ColorPickerProps } from './ColorPicker';
export { ColorSwatchPicker, type ColorSwatchPickerProps } from './ColorSwatchPicker';
export { InputOTP, type InputOTPProps } from './InputOTP';
export { Button, type ButtonProps } from './Button';
export { ButtonGroup, type ButtonGroupProps } from './ButtonGroup';
export { CloseButton, type CloseButtonProps } from './CloseButton';
export { ToggleButtonGroup, ToggleButton, type ToggleButtonGroupProps, type ToggleButtonProps } from './ToggleButtonGroup';
export { Badge, type BadgeProps } from './Badge';
export { Chip, type ChipProps } from './Chip';
export { AlphaBadge } from './AlphaBadge';
export { TagGroup, Tag, type TagGroupProps, type TagProps } from './TagGroup';
export { Spinner, type SpinnerProps } from './Spinner';
export { Skeleton, type SkeletonProps } from './Skeleton';
export { Kbd, type KbdProps } from './Kbd';
export { ScrollShadow, type ScrollShadowProps } from './ScrollShadow';
export { Checkbox, CheckboxGroup, type CheckboxProps, type CheckboxGroupProps } from './Checkbox';
export { Radio, RadioGroup, type RadioProps, type RadioGroupProps } from './Radio';
export { StarRating, type StarRatingProps } from './StarRating';
export { Input, type InputProps } from './Input';
export { InputGroup, type InputGroupProps } from './InputGroup';
export { TextField, type TextFieldProps } from './TextField';
export { Textarea as TextArea, type TextareaProps as TextAreaProps } from './Textarea';
export { NumberField, type NumberFieldProps } from './NumberField';
export { SearchField, type SearchFieldProps } from './SearchField';
export { FieldError, type FieldErrorProps } from './FieldError';
export { Label, type LabelProps } from './Label';
export { Description, type DescriptionProps } from './Description';
export { Form, type FormProps } from './Form';
export {
  Fieldset,
  FieldsetLegend,
  FieldGroup,
  FieldsetActions,
  type FieldsetProps,
  type FieldsetLegendProps,
  type FieldGroupProps,
  type FieldsetActionsProps,
} from './Fieldset';
export { Textarea, type TextareaProps } from './Textarea';
export { Switch, type SwitchProps } from './Switch';
export { Slider, type SliderProps } from './Slider';
export { Tabs, Tab, type TabsProps, type TabProps } from './Tabs';
export { Tooltip, type TooltipProps } from './Tooltip';
export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverDialog,
  PopoverHeading,
  PopoverArrow,
  type PopoverProps,
  type PopoverTriggerProps,
  type PopoverContentProps,
  type PopoverDialogProps,
} from './Popover';
export { Pagination, type PaginationProps } from './Pagination';
export {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  type TableProps,
  type TableHeaderProps,
  type TableColumnProps,
  type TableBodyProps,
  type TableRowProps,
  type TableCellProps,
  type Selection,
  type SortDescriptor,
} from './Table';
export {
  Card,
  CardHeader,
  CardBody,
  CardFooter,
  type CardProps,
  type CardHeaderProps,
  type CardBodyProps,
  type CardFooterProps,
} from './Card';
export {
  Avatar,
  AvatarGroup,
  type AvatarProps,
  type AvatarGroupProps,
} from './Avatar';
export {
  Modal,
  ModalContent,
  ModalHeader,
  ModalHeading,
  ModalBody,
  ModalFooter,
  type ModalProps,
  type ModalContentProps,
  type ModalHeadingProps,
  type ModalSectionProps,
} from './Modal';
export {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  type DrawerProps,
  type DrawerContentProps,
  type DrawerSectionProps,
} from './Drawer';
export {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  DropdownSection,
  type DropdownProps,
  type DropdownTriggerProps,
  type DropdownMenuProps,
  type DropdownItemProps,
  type DropdownSectionProps,
} from './Dropdown';
export {
  Accordion,
  AccordionItem,
  type AccordionProps,
  type AccordionItemProps,
} from './Accordion';
export {
  Disclosure,
  DisclosureHeading,
  DisclosureTrigger,
  DisclosureContent,
  DisclosureBody,
  DisclosureIndicator,
  type DisclosureProps,
  type DisclosureHeadingProps,
  type DisclosureTriggerProps,
  type DisclosureContentProps,
  type DisclosureBodyProps,
  type DisclosureIndicatorProps,
} from './Disclosure';
export { Toolbar, type ToolbarProps } from './Toolbar';
export {
  Select,
  SelectItem,
  SelectSection,
  type SelectProps,
  type SelectItemProps,
  type SelectSectionProps,
} from './Select';
export {
  ListBox,
  ListBoxItem,
  ListBoxSection,
  type ListBoxProps,
  type ListBoxItemProps,
  type ListBoxSectionProps,
  type Selection as ListBoxSelection,
} from './ListBox';
export { Autocomplete, type AutocompleteProps } from './Autocomplete';
export { ComboBox, type ComboBoxProps } from './ComboBox';
// Ergonomic aliases — the same collection parts compose inside Autocomplete & ComboBox.
export {
  ListBoxItem as AutocompleteItem,
  ListBoxSection as AutocompleteSection,
  ListBoxItem as ComboBoxItem,
  ListBoxSection as ComboBoxSection,
} from './ListBox';
export { useDisclosure, type UseDisclosureProps } from './useDisclosure';
export { ConfirmDialogProvider, useConfirm, type ConfirmOptions } from './ConfirmDialog';

// Skeleton Components
export {
  ListingSkeleton,
  MemberCardSkeleton,
  StatCardSkeleton,
  EventCardSkeleton,
  GroupCardSkeleton,
  ConversationSkeleton,
  ExchangeCardSkeleton,
  NotificationSkeleton,
  ProfileHeaderSkeleton,
  MessageListSkeleton,
  ProfileCardSkeleton,
  CardRowsSkeleton,
  MediaRowsSkeleton,
  SkeletonList,
} from './Skeletons';
