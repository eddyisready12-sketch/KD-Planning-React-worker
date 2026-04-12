-- Run this once in Supabase SQL editor before importing the new CSV.
-- The CSV can contain multiple rows with the same Order Nummer / Ritnummer.
-- P.O. is the unique production assignment, so shared_orders must upsert on that.

update public.shared_orders
set production_order = order_num
where production_order is null or btrim(production_order) = '';

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = con.connamespace
    where nsp.nspname = 'public'
      and rel.relname = 'shared_orders'
      and con.contype = 'u'
      and pg_get_constraintdef(con.oid) = 'UNIQUE (workspace, order_num)'
  loop
    execute format('alter table public.shared_orders drop constraint %I', constraint_name);
  end loop;
end $$;

drop index if exists public.ux_shared_orders_workspace_order_num;
drop index if exists public.ux_shared_orders_workspace_production_order;

alter table public.shared_orders
drop constraint if exists ux_shared_orders_workspace_production_order;

alter table public.shared_orders
add constraint ux_shared_orders_workspace_production_order
unique (workspace, production_order);

-- Force PostgREST/Supabase to refresh its schema cache.
notify pgrst, 'reload schema';
