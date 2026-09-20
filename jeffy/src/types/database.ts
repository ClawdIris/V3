/**
 * Database types.
 *
 * Hand-maintained to mirror supabase/migrations exactly. Once the Supabase
 * project exists this file is regenerated with:
 *
 *   npm run gen:types
 *
 * which runs `supabase gen types typescript`. Until then this is the single
 * source of truth for the app, and `npm run verify:schema` diffs the enum
 * members here against the migrations so the two cannot silently drift.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// --- enums (must match 0001_types.sql) --------------------------------------

export const ITEM_CATEGORIES = ['top', 'bottom', 'outerwear', 'shoes', 'accessory'] as const;
export const SEASONS = ['spring', 'summer', 'fall', 'winter'] as const;
export const CLOSET_ROLES = ['owner', 'stylist'] as const;
export const MEMBER_STATUSES = ['pending', 'accepted', 'revoked'] as const;
export const ITEM_STATUSES = ['active', 'donated'] as const;
export const OUTFIT_SOURCES = ['ai', 'stylist', 'owner'] as const;
export const OUTFIT_STATUSES = ['suggested', 'saved', 'worn', 'archived'] as const;
export const FEEDBACK_VERDICTS = ['approved', 'rejected', 'edited', 'comment'] as const;
export const RULE_STRENGTHS = ['hard', 'soft'] as const;
export const WISHLIST_SOURCES = ['owner', 'stylist', 'ai', 'inspiration'] as const;
export const WISHLIST_STATUSES = ['open', 'purchased', 'dismissed'] as const;
export const PIECE_MATCHES = ['have', 'close', 'missing'] as const;
export const LOOK_STATUSES = ['pending', 'analyzing', 'analyzed', 'failed', 'saved'] as const;
export const ATTACHMENT_KINDS = ['item', 'outfit', 'wishlist', 'inspiration', 'photo'] as const;
export const PRICE_TIERS = ['budget', 'mid', 'premium'] as const;
export const ITEM_SOURCES = ['manual', 'ai_single', 'ai_rack', 'scan'] as const;

export type ItemCategory = (typeof ITEM_CATEGORIES)[number];
export type Season = (typeof SEASONS)[number];
export type ClosetRole = (typeof CLOSET_ROLES)[number];
export type MemberStatus = (typeof MEMBER_STATUSES)[number];
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export type OutfitSource = (typeof OUTFIT_SOURCES)[number];
export type OutfitStatus = (typeof OUTFIT_STATUSES)[number];
export type FeedbackVerdict = (typeof FEEDBACK_VERDICTS)[number];
export type RuleStrength = (typeof RULE_STRENGTHS)[number];
export type WishlistSource = (typeof WISHLIST_SOURCES)[number];
export type WishlistStatus = (typeof WISHLIST_STATUSES)[number];
export type PieceMatch = (typeof PIECE_MATCHES)[number];
export type LookStatus = (typeof LOOK_STATUSES)[number];
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];
export type PriceTier = (typeof PRICE_TIERS)[number];
export type ItemSource = (typeof ITEM_SOURCES)[number];

/** Formality runs 1 (gym/lounge) to 5 (black tie). */
export type Formality = 1 | 2 | 3 | 4 | 5;

// --- rows -------------------------------------------------------------------

export interface ProfileRow {
  id: string;
  display_name: string | null;
  avatar_path: string | null;
  shirt_size: string | null;
  pants_waist: number | null;
  pants_length: number | null;
  shoe_size: number | null;
  jacket_size: string | null;
  monthly_budget_cents: number | null;
  home_lat: number | null;
  home_lon: number | null;
  onboarded_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BudgetRow {
  id: string;
  profile_id: string;
  category: ItemCategory;
  min_cents: number;
  max_cents: number;
  created_at: string;
  updated_at: string;
}

export interface ClosetRow {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface ClosetMemberRow {
  id: string;
  closet_id: string;
  user_id: string;
  role: ClosetRole;
  status: MemberStatus;
  invited_by: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InviteRow {
  id: string;
  closet_id: string;
  code_hash: string;
  code_hint: string;
  role: ClosetRole;
  created_by: string;
  expires_at: string;
  redeemed_at: string | null;
  redeemed_by: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface ItemRow {
  id: string;
  closet_id: string;
  created_by: string;
  name: string;
  category: ItemCategory;
  subcategory: string | null;
  colors: string[];
  pattern: string | null;
  material: string | null;
  formality: Formality;
  seasons: Season[];
  brand: string | null;
  size: string | null;
  barcode: string | null;
  style_number: string | null;
  purchase_price_cents: number | null;
  tags: string[];
  notes: string | null;
  is_favorite: boolean;
  is_dirty: boolean;
  status: ItemStatus;
  last_worn_at: string | null;
  wear_count: number;
  source: ItemSource;
  ai_confidence: number | null;
  ai_raw: Json | null;
  primary_photo_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItemPhotoRow {
  id: string;
  item_id: string;
  closet_id: string;
  storage_path: string;
  thumb_path: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  position: number;
  created_at: string;
}

export interface WearLogRow {
  id: string;
  closet_id: string;
  item_id: string;
  outfit_id: string | null;
  worn_on: string;
  created_at: string;
}

export interface OutfitRow {
  id: string;
  closet_id: string;
  created_by: string;
  name: string | null;
  occasion: string | null;
  source: OutfitSource;
  status: OutfitStatus;
  reason: string | null;
  note: string | null;
  weather_summary: string | null;
  temp_c: number | null;
  generated_for: string | null;
  flagged_for_review: boolean;
  worn_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutfitItemRow {
  outfit_id: string;
  item_id: string;
  closet_id: string;
  slot: ItemCategory;
  position: number;
  created_at: string;
}

export interface StyleRuleRow {
  id: string;
  closet_id: string;
  author_id: string;
  rule_text: string;
  strength: RuleStrength;
  machine_rule: Json | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// --- RPC shapes -------------------------------------------------------------

export interface CreateInviteResult {
  code: string;
  invite_id: string;
  expires_at: string;
}

export const REDEEM_STATUSES = [
  'accepted',
  'invalid',
  'expired',
  'already_used',
  'revoked',
  'own_closet',
  'already_member',
] as const;

export type RedeemStatus = (typeof REDEEM_STATUSES)[number];

export interface RedeemInviteResult {
  status: RedeemStatus;
  closet_id: string | null;
  closet_name: string | null;
  owner_name: string | null;
}

// --- write shapes for the paths Milestone 1 actually uses -------------------

export type ProfileUpdate = Partial<
  Omit<ProfileRow, 'id' | 'created_at' | 'updated_at'>
>;

export type BudgetUpsert = Pick<BudgetRow, 'profile_id' | 'category' | 'min_cents' | 'max_cents'>;

export type ItemInsert = Pick<ItemRow, 'closet_id' | 'created_by' | 'name' | 'category'> &
  Partial<
    Omit<
      ItemRow,
      | 'id'
      | 'closet_id'
      | 'created_by'
      | 'name'
      | 'category'
      | 'created_at'
      | 'updated_at'
      | 'wear_count'
      | 'last_worn_at'
    >
  >;

export type ItemUpdate = Partial<
  Omit<ItemRow, 'id' | 'closet_id' | 'created_by' | 'created_at' | 'updated_at'>
>;

export type ItemPhotoInsert = Pick<
  ItemPhotoRow,
  'item_id' | 'closet_id' | 'storage_path' | 'thumb_path'
> &
  Partial<Pick<ItemPhotoRow, 'width' | 'height' | 'bytes' | 'position'>>;
