import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemTransitionAction } from "@/features/items/domain/item-transition";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string): never => {
    throw new Error(`redirect:${path}`);
  }),
  transitionItemUseCase: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/features/items/application/item-transition-use-cases", () => ({
  transitionItemUseCase: mocks.transitionItemUseCase,
}));

vi.mock(
  "@/features/items/infrastructure/prisma-item-transition-repository",
  () => ({
    prismaItemTransitionRepository: {},
  }),
);

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

import {
  listItem,
  markAsPurchased,
  markAsSold,
  restoreToPlanned,
  unlistItem,
} from "@/app/items/transitions";

const transitions: readonly Readonly<{
  name: string;
  action: ItemTransitionAction;
  invoke: (itemId: number) => Promise<void>;
}>[] = [
  { name: "購入済み", action: "mark_purchased", invoke: markAsPurchased },
  { name: "出品", action: "start_listing", invoke: listItem },
  { name: "購入予定へ戻す", action: "restore_planned", invoke: restoreToPlanned },
  { name: "売却済み", action: "mark_sold", invoke: markAsSold },
  { name: "出品取り下げ", action: "cancel_listing", invoke: unlistItem },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentUser.mockResolvedValue({ sub: "user-1" });
  mocks.transitionItemUseCase.mockResolvedValue({ type: "transitioned" });
});

describe("アイテム状態遷移Server Actions", () => {
  it.each(transitions)("$nameをユースケースへ委譲する", async ({ action, invoke }) => {
    await invoke(10);

    expect(mocks.transitionItemUseCase).toHaveBeenCalledWith(expect.anything(), {
      userId: "user-1",
      itemId: 10,
      action,
    });
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/",
      "/items",
      "/items/planned",
      "/items/selling",
      "/dashboard",
    ]);
  });

  it("未認証の場合はログイン画面へ遷移し、状態を変更しない", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    await expect(markAsPurchased(10)).rejects.toThrow("redirect:/login");

    expect(mocks.transitionItemUseCase).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
