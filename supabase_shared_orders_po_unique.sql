-- Run this once in Supabase SQL editor before deploying the PO-based import fix.
-- The CSV can contain multiple rows with the same Order Nummer / Ritnummer.
-- P.O. is the unique production assignment, so shared_orders must upsert on that.

update public.shared_orders
set production_order = order_num
where production_order is null or btrim(production_order) = '';

do $$
declare
  constraint_name text;
begin
  select con.conname
    into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = con.connamespace
  where nsp.nspname = 'public'
    and rel.relname = 'shared_orders'
    and con.contype = 'u'
    and pg_get_constraintdef(con.oid) = 'UNIQUE (workspace, order_num)'
  limit 1;

  if constraint_name is not null then
    execute format('alter table public.shared_orders drop constraint %I', constraint_name);
  end if;
end $$;

create unique index if not exists ux_shared_orders_workspace_production_order
on public.shared_orders (workspace, production_order);
