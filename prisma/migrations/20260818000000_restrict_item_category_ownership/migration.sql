drop policy items_categories_insert on public.items_categories;

create policy items_categories_insert on public.items_categories
for insert
with check (
  exists (
    select 1
    from public.items i
    where i.id = item_id
      and i.user_id = app.current_user_id()
  )
  and exists (
    select 1
    from public.categories c
    where c.id = category_id
      and (c.is_preset or c.user_id = app.current_user_id())
  )
);
