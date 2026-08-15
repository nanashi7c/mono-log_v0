import type {
  ItemImportCategory,
  ItemImportInput,
  ItemImportRecord,
} from "@/features/items/application/item-import-input";
import { itemStatusOrDefault } from "@/features/items/domain/status";
import { parseActualPrice } from "@/lib/validation/actual-price";
import { INTEGER_MAX, parseOptionalInteger } from "@/lib/validation/numeric";

type RawBackupCategory = Readonly<{
  id?: unknown;
  name?: unknown;
  color?: unknown;
}>;

type RawBackupItem = Readonly<{
  name?: unknown;
  status?: unknown;
  jan_code?: unknown;
  quantity?: unknown;
  notes?: unknown;
  actual_price?: unknown;
  purchased_at?: unknown;
  category_ids?: unknown;
}>;

type ParseFailure = Readonly<{ ok: false; error: string }>;

export type ParseItemBackupResult =
  | Readonly<{ ok: true; value: ItemImportInput }>
  | ParseFailure;

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parsePurchasedAt(value: unknown): ParseFailure | string | null {
  const purchasedAt = asString(value);
  if (!purchasedAt) return null;
  if (Number.isNaN(Date.parse(purchasedAt))) {
    return { ok: false, error: `購入日「${purchasedAt}」は有効な日付ではありません。` };
  }
  return purchasedAt;
}

function parseCategory(rawValue: unknown): ItemImportCategory | null {
  if (!isRecord(rawValue)) return null;
  const raw = rawValue as RawBackupCategory;
  const name = asString(raw.name);
  if (!name) return null;
  return Object.freeze({
    sourceId: raw.id == null ? null : String(raw.id),
    name,
    color: asString(raw.color) ?? "#94a3b8",
  });
}

function parseItem(rawValue: unknown): ParseFailure | ItemImportRecord | null {
  if (!isRecord(rawValue)) return null;
  const raw = rawValue as RawBackupItem;
  const name = asString(raw.name);
  if (!name) return null;

  const actualPrice = parseActualPrice(raw.actual_price);
  if (!actualPrice.ok) {
    return { ok: false, error: `「${name}」: ${actualPrice.error}` };
  }
  const quantity = parseOptionalInteger(raw.quantity, {
    label: "数量",
    min: 1,
    max: INTEGER_MAX,
  });
  if (!quantity.ok) {
    return { ok: false, error: `「${name}」: ${quantity.error}` };
  }
  const purchasedAt = parsePurchasedAt(raw.purchased_at);
  if (typeof purchasedAt === "object" && purchasedAt !== null) {
    return { ok: false, error: `「${name}」: ${purchasedAt.error}` };
  }
  const categorySourceIds = Array.isArray(raw.category_ids)
    ? Object.freeze([...new Set(raw.category_ids.map(String))])
    : Object.freeze([]);

  return Object.freeze({
    name,
    status: itemStatusOrDefault(raw.status),
    janCode: asString(raw.jan_code),
    quantity: quantity.value ?? 1,
    notes: asString(raw.notes),
    actualPrice: actualPrice.value,
    purchasedAt,
    categorySourceIds,
  });
}

function parseJson(text: string): Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false; error: string }> {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `JSONとして解析できません: ${message}` };
  }
}

export function parseItemBackup(text: string): ParseItemBackupResult {
  const parsed = parseJson(text);
  if (!parsed.ok) return parsed;
  if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return { ok: false, error: "invalid-format" };
  }

  const root = parsed.value as Readonly<{ categories?: unknown; items?: unknown }>;
  const rawCategories = Array.isArray(root.categories) ? root.categories : [];
  const rawItems = Array.isArray(root.items) ? root.items : [];
  const categories = rawCategories
    .map(parseCategory)
    .filter((category): category is ItemImportCategory => category !== null);
  const items: ItemImportRecord[] = [];
  for (const raw of rawItems) {
    const item = parseItem(raw);
    if (!item) continue;
    if ("error" in item) return item;
    items.push(item);
  }

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      categories: Object.freeze(categories),
      items: Object.freeze(items),
    }),
  });
}
