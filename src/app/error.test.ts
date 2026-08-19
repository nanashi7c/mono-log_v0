import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ErrorBoundary from "@/app/error";

describe("ErrorBoundary", () => {
  it("内部エラーの詳細を画面へ表示しない", () => {
    const markup = renderToStaticMarkup(
      createElement(ErrorBoundary, {
        error: new Error("secret database connection detail"),
        reset: vi.fn(),
      }),
    );

    expect(markup).toContain(
      "処理を完了できませんでした。時間をおいてもう一度お試しください。",
    );
    expect(markup).not.toContain("secret database connection detail");
  });
});
