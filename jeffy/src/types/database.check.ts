import type { Tables } from './database.generated';
import type {
  BudgetRow,
  ClosetMemberRow,
  ClosetRow,
  InviteRow,
  ItemPhotoRow,
  ItemRow,
  OutfitItemRow,
  OutfitRow,
  ProfileRow,
  StyleRuleRow,
  WearLogRow,
} from './database';

/**
 * Compile-time drift guard between the hand-written row types in database.ts
 * and the types Supabase generates from the live schema.
 *
 * The hand-written ones are deliberately STRICTER (e.g. formality is 1..5,
 * not number), so the check is one-directional on values: every hand-written
 * row must be assignable to the generated row. Column sets must match exactly
 * in both directions, so an added or dropped column fails `npm run typecheck`
 * rather than surfacing as an undefined at runtime.
 *
 * This file exports nothing and is never imported; tsc picks it up via the
 * project's `include`.
 */

type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : never
  : never;

type Refines<Hand, Generated> = Hand extends Generated ? SameKeys<Hand, Generated> : never;

type Checks = [
  Refines<ProfileRow, Tables<'profiles'>>,
  Refines<BudgetRow, Tables<'budgets'>>,
  Refines<ClosetRow, Tables<'closets'>>,
  Refines<ClosetMemberRow, Tables<'closet_members'>>,
  Refines<InviteRow, Tables<'invites'>>,
  Refines<ItemRow, Tables<'items'>>,
  Refines<ItemPhotoRow, Tables<'item_photos'>>,
  Refines<WearLogRow, Tables<'wear_log'>>,
  Refines<OutfitRow, Tables<'outfits'>>,
  Refines<OutfitItemRow, Tables<'outfit_items'>>,
  Refines<StyleRuleRow, Tables<'style_rules'>>,
];

// If any entry above resolves to `never`, this line stops compiling.
const _schemaInStep: Checks = [true, true, true, true, true, true, true, true, true, true, true];
void _schemaInStep;
