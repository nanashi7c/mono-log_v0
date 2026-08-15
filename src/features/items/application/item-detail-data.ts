import type {
  Category,
  Item,
  Listing,
  Plan,
  Platform,
  Service,
  Size,
} from "@/types/item";

export type ItemDetailData = Readonly<{
  item: Readonly<Item>;
  plan: Readonly<Plan> | null;
  listing: Readonly<Listing> | null;
  categories: readonly Readonly<Pick<Category, "id" | "name" | "color">>[];
  platform: Readonly<Pick<Platform, "id" | "name">> | null;
  service: Readonly<Pick<Service, "id" | "shipping_service">> | null;
  size: Readonly<Pick<Size, "id" | "shipping_size">> | null;
  shippingFee: number | null;
}>;
