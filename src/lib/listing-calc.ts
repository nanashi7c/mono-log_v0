// Listing profit/loss calculation per spec section 6.
// Each output is null when any of its required inputs is null (per the spec:
// 「入力値が未入力の場合は計算結果を非表示にします」).

export type CalcInput = {
  actual_price: number | null;
  selling_price: number | null;
  packaging_cost: number | null;
  work_time_hours: number | null;
  labor_rate: number | null;
  // Looked up master values, not stored in `listings`.
  shipping_fee: number | null;
  platform_fee_rate: number | null;
};

export type CalcResult = {
  selling_fee: number | null;
  work_time_cost: number | null;
  operating_benefit: number | null;
  ordinary_profit: number | null;
  is_listing: boolean | null;
};

type OrdinaryProfitInput = Readonly<{
  net_proceeds: number | null;
  work_time_cost: number | null;
  actual_price: number | null;
}>;

function r(n: number): number {
  return Math.round(n);
}

export function computeOrdinaryProfit({
  net_proceeds,
  work_time_cost,
  actual_price,
}: OrdinaryProfitInput): number | null {
  return net_proceeds != null && work_time_cost != null && actual_price != null
    ? net_proceeds - work_time_cost - actual_price
    : null;
}

export function computeListingMetrics(input: CalcInput): CalcResult {
  const {
    actual_price,
    selling_price,
    packaging_cost,
    work_time_hours,
    labor_rate,
    shipping_fee,
    platform_fee_rate,
  } = input;

  const selling_fee =
    selling_price != null && platform_fee_rate != null ? r(selling_price * platform_fee_rate) : null;

  const work_time_cost =
    work_time_hours != null && labor_rate != null ? r(work_time_hours * labor_rate) : null;

  const net_proceeds =
    selling_price != null && shipping_fee != null && packaging_cost != null && selling_fee != null
      ? selling_price - shipping_fee - packaging_cost - selling_fee
      : null;

  const ordinary_profit = computeOrdinaryProfit({
    net_proceeds,
    work_time_cost,
    actual_price,
  });

  const is_listing = ordinary_profit != null ? ordinary_profit >= 0 : null;

  return {
    selling_fee,
    work_time_cost,
    // DB列名との互換性を保ちつつ、画面上では「売却手取り」として扱う。
    operating_benefit: net_proceeds,
    ordinary_profit,
    is_listing,
  };
}
