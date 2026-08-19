import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dbErrorResponse } from "@/lib/auth/api";

const consoleError = vi
  .spyOn(console, "error")
  .mockImplementation(() => undefined);

beforeEach(() => {
  consoleError.mockClear();
});

afterAll(() => {
  consoleError.mockRestore();
});

describe("dbErrorResponse", () => {
  it("入力起因のDB制約エラーは詳細を隠して400にする", async () => {
    const error = Object.assign(new Error("secret Prisma constraint detail"), {
      code: "P2002",
    });

    const response = dbErrorResponse(error);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid request" });
    expect(consoleError).toHaveBeenCalledWith(
      "REST APIのデータ処理に失敗しました。",
      error,
    );
  });

  it("接続タイムアウトは入力エラー扱いにせず500にする", async () => {
    const error = Object.assign(new Error("secret connection pool detail"), {
      code: "P2024",
    });

    const response = dbErrorResponse(error);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "internal error" });
  });

  it.each([new Error("secret internal detail"), null])(
    "コードを持たない例外%jも詳細を隠して500にする",
    async (error) => {
      const response = dbErrorResponse(error);

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "internal error",
      });
    },
  );
});
