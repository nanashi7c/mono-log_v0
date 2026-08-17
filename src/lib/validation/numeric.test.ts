import { describe, expect, it } from "vitest";
import {
  DECIMAL_10_0_MAX,
  fitsSignedDecimal10,
  parseOptionalDecimal,
  parseOptionalInteger,
  parseRequiredInteger,
} from "@/lib/validation/numeric";

const integerOptions = {
  label: "数量",
  min: 1,
  max: 10,
} as const;

describe("数値検証", () => {
  it("空文字をnullへ変換する", () => {
    expect(parseOptionalInteger("  ", integerOptions)).toEqual({
      ok: true,
      value: null,
    });
  });

  it.each([1, 10])("境界値%dを整数として受け付ける", (value) => {
    expect(parseOptionalInteger(value, integerOptions)).toEqual({
      ok: true,
      value,
    });
  });

  it.each([0, 11, 1.5, "abc", {}])("不正な整数%jを拒否する", (value) => {
    expect(parseOptionalInteger(value, integerOptions).ok).toBe(false);
  });

  it("必須項目の空入力を拒否する", () => {
    expect(parseRequiredInteger("", integerOptions)).toEqual({
      ok: false,
      error: "数量を入力してください。",
    });
  });

  it("指定した刻みの小数を受け付ける", () => {
    expect(
      parseOptionalDecimal("1.25", {
        label: "作業時間",
        min: 0,
        max: 10,
        decimalPlaces: 2,
        step: 0.25,
      }),
    ).toEqual({ ok: true, value: 1.25 });
  });

  it("指定した刻みに合わない小数を拒否する", () => {
    expect(
      parseOptionalDecimal("1.1", {
        label: "作業時間",
        min: 0,
        max: 10,
        decimalPlaces: 2,
        step: 0.25,
      }),
    ).toEqual({
      ok: false,
      error: "作業時間は0.25刻みで入力してください。",
    });
  });

  it.each([
    null,
    0,
    DECIMAL_10_0_MAX,
    -DECIMAL_10_0_MAX,
  ])("%jを符号付き10桁として受け付ける", (value) => {
    expect(fitsSignedDecimal10(value)).toBe(true);
  });

  it.each([DECIMAL_10_0_MAX + 1, -DECIMAL_10_0_MAX - 1, 1.5])(
    "%dを符号付き10桁として拒否する",
    (value) => {
      expect(fitsSignedDecimal10(value)).toBe(false);
    },
  );
});
