import { describe, expect, it } from "vitest";
import { computeListingMetrics, type CalcInput } from "@/lib/listing-calc";

const completeInput: CalcInput = {
  selling_price: 1_000,
  packaging_cost: 100,
  work_time_hours: 2,
  labor_rate: 1_000,
  shipping_fee: 200,
  platform_fee_rate: 0.1,
};

describe("出品利益計算", () => {
  it("販売手数料・作業費・営業利益・経常利益を計算する", () => {
    expect(computeListingMetrics(completeInput)).toEqual({
      selling_fee: 100,
      work_time_cost: 2_000,
      operating_benefit: 600,
      ordinary_profit: -1_400,
      is_listing: false,
    });
  });

  it("利益が0以上なら出品可能と判定する", () => {
    expect(
      computeListingMetrics({
        ...completeInput,
        work_time_hours: 1,
        labor_rate: 100,
      }),
    ).toMatchObject({
      ordinary_profit: 500,
      is_listing: true,
    });
  });

  it("必要な入力がなければ依存する計算結果をnullにする", () => {
    expect(
      computeListingMetrics({
        ...completeInput,
        selling_price: null,
      }),
    ).toEqual({
      selling_fee: null,
      work_time_cost: 2_000,
      operating_benefit: null,
      ordinary_profit: null,
      is_listing: null,
    });
  });

  it("販売手数料を整数へ四捨五入する", () => {
    expect(
      computeListingMetrics({
        ...completeInput,
        selling_price: 999,
      }).selling_fee,
    ).toBe(100);
  });
});
