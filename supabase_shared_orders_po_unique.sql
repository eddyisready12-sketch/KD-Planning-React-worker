-- Run this in Supabase SQL editor.
-- The app now handles updates/inserts itself and no longer needs ON CONFLICT.
-- Therefore shared_orders must NOT be unique on workspace + order_num, because
-- one CSV order number can contain multiple P.O. production assignments.

alter table public.shared_orders
drop constraint if exists ux_shared_orders_workspace_order;

alter table public.shared_orders
drop constraint if exists ux_shared_orders_workspace_order_num;

alter table public.shared_orders
drop constraint if exists shared_orders_workspace_order_num_key;

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

drop index if exists public.ux_shared_orders_workspace_order;
drop index if exists public.ux_shared_orders_workspace_order_num;

notify pgrst, 'reload schema';

-- Check: this should return no rows for workspace/order_num uniqueness.
select
  con.conname,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = con.connamespace
where nsp.nspname = 'public'
  and rel.relname = 'shared_orders'
  and con.contype = 'u'
  and pg_get_constraintdef(con.oid) like '%order_num%';
