import type { ItemStatus } from "@/features/items/domain/status";

export type { ItemStatus } from "@/features/items/domain/status";

export type Category = {
  id: number;
  user_id: string | null;
  name: string;
  color: string;
  is_preset: boolean;
  created_at: string;
  updated_at: string;
};

export type Item = {
  id: number;
  user_id: string;
  status: ItemStatus;
  name: string;
  image_url: string | null;
  jan_code: string | null;
  quantity: number;
  notes: string | null;
  // Non-spec column retained from prototype (was `price_yen`).
  actual_price: number | null;
  // Non-spec column retained from prototype (was `purchase_date`).
  purchased_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ItemCategory = {
  item_id: number;
  category_id: number;
  created_at: string;
};

export type Plan = {
  id: number;
  item_id: number;
  planned_purchase_year: number | null;
  planned_purchase_month: number | null;
  list_price: number | null;
  purchase_price: number | null;
  product_url: string | null;
  deal_period: string | null;
  created_at: string;
  updated_at: string;
};

export type Platform = {
  id: number;
  name: string;
  fee_rate: number;
  created_at: string;
  updated_at: string;
};

export type Service = {
  id: number;
  shipping_service: string;
  created_at: string;
  updated_at: string;
};

export type Size = {
  id: number;
  shipping_size: string;
  created_at: string;
  updated_at: string;
};

export type Shipping = {
  id: number;
  shipping_service_id: number;
  shipping_size_id: number;
  created_at: string;
  updated_at: string;
};

export type ShippingFee = {
  id: number;
  shipping_service_id: number;
  shipping_size_id: number;
  fee: number;
  created_at: string;
  updated_at: string;
};

export type Listing = {
  id: number;
  item_id: number;
  shipping_id: number | null;
  platform_id: number | null;
  quantity: number | null;
  selling_price: number | null;
  packaging_cost: number | null;
  work_time_hours: number | null;
  labor_rate: number | null;
  // The five fields below are computed by the application before write.
  selling_fee: number | null;
  work_time_cost: number | null;
  operating_benefit: number | null;
  ordinary_profit: number | null;
  is_listing: boolean | null;
  created_at: string;
  updated_at: string;
};

export type Profile = {
  id: number;
  user_id: string;
  username: string;
  created_at: string;
  updated_at: string;
};

// Composite shapes used by the UI.
export type ItemWithCategories = Item & {
  categories: readonly Readonly<Pick<Category, "id" | "name" | "color">>[];
};

export type PlannedItem = ItemWithCategories & { plan: Plan | null };
export type ListedItem = ItemWithCategories & { listing: Listing | null };
