import type { ItemStatus } from "@/features/items/domain/status";

export type DemoSeedCategory = Readonly<{
  name: string;
  color: string;
}>;

export type DemoSeedItem = Readonly<{
  name: string;
  status: ItemStatus;
  categoryName: string;
  quantity: number;
  actualPrice: number | null;
  purchasedAt: string | null;
  notes: string;
  plan?: Readonly<{
    plannedPurchaseYear: number;
    plannedPurchaseMonth: number;
    listPrice: number;
    purchasePrice: number;
    productUrl: string;
    dealPeriod: string;
  }>;
  listing?: Readonly<{
    quantity: number;
    sellingPrice: number;
    packagingCost: number;
    workTimeHours: number;
    laborRate: number;
    workTimeCost: number;
    operatingBenefit: number;
    ordinaryProfit: number;
  }>;
}>;

export type DemoSeedData = Readonly<{
  username: string;
  categories: readonly DemoSeedCategory[];
  items: readonly DemoSeedItem[];
}>;

export const DEMO_INITIAL_DATA: DemoSeedData = Object.freeze({
  username: "デモユーザー",
  categories: Object.freeze([
    Object.freeze({ name: "デモ家電", color: "#3b82f6" }),
    Object.freeze({ name: "デモ書籍", color: "#f59e0b" }),
  ]),
  items: Object.freeze([
    Object.freeze({
      name: "ワイヤレスイヤホン",
      status: "owned",
      categoryName: "デモ家電",
      quantity: 1,
      actualPrice: 12_800,
      purchasedAt: "2026-07-01",
      notes: "所有物のサンプルです。自由に編集できます。",
    }),
    Object.freeze({
      name: "Clean Architecture",
      status: "planned",
      categoryName: "デモ書籍",
      quantity: 1,
      actualPrice: null,
      purchasedAt: null,
      notes: "購入予定のサンプルです。",
      plan: Object.freeze({
        plannedPurchaseYear: 2026,
        plannedPurchaseMonth: 9,
        listPrice: 3_520,
        purchasePrice: 3_200,
        productUrl: "https://example.com/demo-book",
        dealPeriod: "次のセール期間",
      }),
    }),
    Object.freeze({
      name: "メカニカルキーボード",
      status: "listed",
      categoryName: "デモ家電",
      quantity: 1,
      actualPrice: 9_800,
      purchasedAt: "2025-12-15",
      notes: "出品中のサンプルです。",
      listing: Object.freeze({
        quantity: 1,
        sellingPrice: 7_500,
        packagingCost: 200,
        workTimeHours: 0.5,
        laborRate: 1_200,
        workTimeCost: 600,
        operatingBenefit: 7_300,
        ordinaryProfit: 6_700,
      }),
    }),
  ]),
});
