import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { supabase } from './supabase';

/**
 * Photo pipeline: compress, thumbnail, upload, sign.
 *
 * Quality bar 4. A modern iPhone photo is 3-5 MB; a closet of 200 items would
 * be a gigabyte of originals nobody ever looks at full size. Everything is
 * resized and re-encoded before it leaves the device, and a separate thumbnail
 * is generated so the grid never downloads a full-size image.
 *
 * Uses the SDK 54+ contextual ImageManipulator API. manipulateAsync is
 * deprecated.
 */

export const FULL_MAX_EDGE = 1600;
export const THUMB_MAX_EDGE = 400;
export const FULL_QUALITY = 0.8;
export const THUMB_QUALITY = 0.7;

export const MEDIA_BUCKET = 'closet-media';

export interface ProcessedImage {
  readonly uri: string;
  readonly width: number;
  readonly height: number;
}

export interface ImagePair {
  readonly full: ProcessedImage;
  readonly thumb: ProcessedImage;
}

async function resize(uri: string, maxEdge: number, quality: number): Promise<ProcessedImage> {
  const context = ImageManipulator.manipulate(uri);
  // Constrain the longest edge by passing only width; height follows to
  // preserve the aspect ratio. Portrait photos are handled by measuring first.
  const probe = await ImageManipulator.manipulate(uri).renderAsync();
  const isLandscape = probe.width >= probe.height;

  context.resize(isLandscape ? { width: maxEdge } : { height: maxEdge });

  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: quality });

  return { uri: saved.uri, width: saved.width, height: saved.height };
}

/**
 * A smaller, base64 copy for sending to a vision model.
 *
 * Deliberately smaller than the stored image: the model gains nothing from
 * 1600px, and every pixel is latency the user waits through and tokens the
 * project pays for.
 */
export const AI_MAX_EDGE = 1024;

export async function toAnalysisBase64(uri: string): Promise<{
  base64: string;
  mediaType: 'image/jpeg';
}> {
  const context = ImageManipulator.manipulate(uri);
  const probe = await ImageManipulator.manipulate(uri).renderAsync();
  context.resize(
    probe.width >= probe.height ? { width: AI_MAX_EDGE } : { height: AI_MAX_EDGE },
  );
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: 0.7,
    base64: true,
  });
  if (saved.base64 === undefined || saved.base64 === null) {
    throw new Error('Could not encode the photo for analysis.');
  }
  return { base64: saved.base64, mediaType: 'image/jpeg' };
}

/** Produces the display image and its thumbnail from one camera capture. */
export async function processPhoto(uri: string): Promise<ImagePair> {
  const full = await resize(uri, FULL_MAX_EDGE, FULL_QUALITY);
  // Thumbnail derives from the already-shrunk image: faster, and the quality
  // difference at 400px is invisible.
  const thumb = await resize(full.uri, THUMB_MAX_EDGE, THUMB_QUALITY);
  return { full, thumb };
}

/**
 * Storage paths are `{closetId}/{area}/{ownerId}/{filename}`. The first
 * segment is what the Storage RLS policies read, so it must always be the
 * closet id, and `area` must be one of the names those policies allow.
 */
export type MediaArea = 'items' | 'inspiration' | 'chat' | 'wishlist';

export function mediaPath(
  closetId: string,
  area: MediaArea,
  ownerId: string,
  filename: string,
): string {
  return `${closetId}/${area}/${ownerId}/${filename}`;
}

async function uploadOne(path: string, uri: string): Promise<void> {
  // React Native's fetch resolves file:// URIs, and arrayBuffer avoids the
  // base64 round-trip that doubles memory for a multi-megabyte photo.
  const response = await fetch(uri);
  const bytes = await response.arrayBuffer();

  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, bytes, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (error !== null) throw error;
}

export interface UploadedPair {
  readonly storagePath: string;
  readonly thumbPath: string;
  readonly width: number;
  readonly height: number;
}

export async function uploadImagePair(
  pair: ImagePair,
  closetId: string,
  area: MediaArea,
  ownerId: string,
): Promise<UploadedPair> {
  // Shared stem so a thumbnail is always traceable to its original.
  const stem = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const storagePath = mediaPath(closetId, area, ownerId, `${stem}.jpg`);
  const thumbPath = mediaPath(closetId, area, ownerId, `${stem}-thumb.jpg`);

  await uploadOne(storagePath, pair.full.uri);
  try {
    await uploadOne(thumbPath, pair.thumb.uri);
  } catch (error) {
    // Don't leave an orphaned full-size object behind paying for storage.
    await supabase.storage.from(MEDIA_BUCKET).remove([storagePath]);
    throw error;
  }

  return {
    storagePath,
    thumbPath,
    width: pair.full.width,
    height: pair.full.height,
  };
}

/** Signed URLs last an hour; the query cache re-mints them well before that. */
export const SIGNED_URL_TTL_SECONDS = 3600;

export async function signedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error !== null) throw error;
  return data.signedUrl;
}

/**
 * One request for a whole grid of thumbnails instead of one per tile.
 * Returns a map so a partial failure still renders the tiles that worked.
 */
export async function signedUrls(paths: readonly string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (paths.length === 0) return result;

  const unique = [...new Set(paths)];
  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_TTL_SECONDS);
  if (error !== null) throw error;

  for (const entry of data) {
    if (entry.error === null && entry.signedUrl !== null && entry.path !== null) {
      result.set(entry.path, entry.signedUrl);
    }
  }
  return result;
}
