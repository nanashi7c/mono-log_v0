with recalculated as (
  select
    listing.id,
    case
      when listing.operating_benefit is null
        or listing.work_time_cost is null
        or item.actual_price is null
      then null
      else listing.operating_benefit - listing.work_time_cost - item.actual_price
    end as ordinary_profit
  from public.listings as listing
  inner join public.items as item on item.id = listing.item_id
)
update public.listings as listing
set
  ordinary_profit = recalculated.ordinary_profit,
  is_listing = case
    when recalculated.ordinary_profit is null then null
    else recalculated.ordinary_profit >= 0
  end
from recalculated
where recalculated.id = listing.id;
