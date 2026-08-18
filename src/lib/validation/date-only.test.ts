import { describe, expect, it } from "vitest";
import { parseOptionalDateOnly } from "@/lib/validation/date-only";

const options = { label: "purchased_at" } as const;
const errorResult = {
  ok: false,
  error: "purchased_at must be YYYY-MM-DD or null",
} as const;

describe("parseOptionalDateOnly", () => {
  it.each([
    [undefined, null],
    [null, null],
    ["", null],
    ["  ", null],
    [" 2026-06-01 ", "2026-06-01"],
    ["2024-02-29", "2024-02-29"],
    ["2000-02-29", "2000-02-29"],
    ["0001-01-01", "0001-01-01"],
    ["9999-12-31", "9999-12-31"],
  ])("%jを日付またはnullへ変換する", (value, expected) => {
    expect(parseOptionalDateOnly(value, options)).toEqual({
      ok: true,
      value: expected,
    });
  });

  it.each([
    "2023-02-29",
    "1900-02-29",
    "2024-02-30",
    "2026-04-31",
    "2026-00-01",
    "2026-13-01",
    "0000-01-01",
    "2026-6-1",
    "2026/06/01",
    "2026-06-01T00:00:00Z",
    20260601,
    {},
  ])("不正な日付%jを拒否する", (value) => {
    expect(parseOptionalDateOnly(value, options)).toEqual(errorResult);
  });
});
