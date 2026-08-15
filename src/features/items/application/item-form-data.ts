import type {
  Category,
  Item,
  Listing,
  Plan,
  Platform,
  Service,
  Size,
} from "@/types/item";

export type ItemFormOptions = Readonly<{
  categories: readonly Readonly<Pick<Category, "id" | "name" | "color">>[];
  platforms: readonly Readonly<Pick<Platform, "id" | "name">>[];
  services: readonly Readonly<Pick<Service, "id" | "shipping_service">>[];
  sizes: readonly Readonly<Pick<Size, "id" | "shipping_size">>[];
}>;

export type ItemEditFormData = ItemFormOptions &
  Readonly<{
    item: Readonly<Item>;
    plan: Readonly<Plan> | null;
    listing: Readonly<Listing> | null;
    selectedCategoryIds: readonly number[];
    initialServiceId: number | null;
    initialSizeId: number | null;
  }>;
