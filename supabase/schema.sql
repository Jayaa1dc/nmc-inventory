-- NMC Stationery Inventory: Supabase schema. Run once in Supabase > SQL Editor.
create table public.branches(name text primary key);
insert into public.branches values ('Battaramulla'),('Kiribathgoda'),('Panadura'),('Ja-Ela'),('Kirillawala'),('Kurunegala'),('Peliyagoda');
create table public.profiles(user_id uuid primary key references auth.users on delete cascade, full_name text, role text not null default 'center' check (role in ('admin','center')), branch text references public.branches(name));
create table public.items(code text primary key, name text not null unique, category text default 'Stationery', uom text, active boolean default true);
create table public.suppliers(code text primary key, name text not null unique, note text);
create table public.supplier_prices(id bigint generated always as identity primary key, item_code text references public.items(code), supplier_code text references public.suppliers(code), price numeric not null check (price>=0), brand text not null default '', updated_at timestamptz default now(), unique(item_code,supplier_code,brand));
create table public.grns(id uuid primary key default gen_random_uuid(), grn_no text not null, branch text not null references public.branches(name), supplier_code text references public.suppliers(code), invoice_no text, grn_date date not null default current_date, received_by text not null, source_file text, created_by uuid default auth.uid(), created_at timestamptz default now());
create unique index grns_no_unique on public.grns (upper(trim(grn_no)));
create table public.grn_lines(id bigint generated always as identity primary key, grn_id uuid not null references public.grns(id) on delete cascade, item_code text not null references public.items(code), qty numeric not null check (qty>0), unit_price numeric default 0);
create table public.issues(id bigint generated always as identity primary key, branch text not null references public.branches(name), item_code text not null references public.items(code), qty numeric not null check (qty>0), received_by text not null, issued_by text not null, dept text, note text, created_by uuid default auth.uid(), created_at timestamptz default now());
create table public.reorder_levels(branch text references public.branches(name), item_code text references public.items(code), min_qty numeric not null default 0, primary key(branch,item_code));

create view public.stock_levels with (security_invoker=true) as
select b.name as branch, i.code as item_code, i.name as item_name,
 coalesce((select sum(l.qty) from grn_lines l join grns g on g.id=l.grn_id where g.branch=b.name and l.item_code=i.code),0)
 - coalesce((select sum(s.qty) from issues s where s.branch=b.name and s.item_code=i.code),0) as qty,
 coalesce(r.min_qty,0) as min_qty
from branches b cross join items i left join reorder_levels r on r.branch=b.name and r.item_code=i.code
where i.active;

create function public.my_role() returns text language sql stable security definer set search_path=public as $$ select role from profiles where user_id=auth.uid() $$;
create function public.my_branch() returns text language sql stable security definer set search_path=public as $$ select branch from profiles where user_id=auth.uid() $$;
create function public.can_write(b text) returns boolean language sql stable security definer set search_path=public as $$ select my_role()='admin' or (my_role()='center' and my_branch()=b) $$;

-- block issues larger than stock
create function public.check_stock() returns trigger language plpgsql security definer set search_path=public as $$
declare have numeric;
begin
 select qty into have from stock_levels where branch=new.branch and item_code=new.item_code;
 if coalesce(have,0) < new.qty then raise exception 'Only % in stock at %', coalesce(have,0), new.branch; end if;
 return new; end $$;
create trigger issues_check before insert on public.issues for each row execute function public.check_stock();

-- save a GRN and its lines in one step (all or nothing)
create function public.save_grn(p jsonb) returns uuid language plpgsql as $$
declare gid uuid; l jsonb;
begin
 insert into grns(grn_no,branch,supplier_code,invoice_no,grn_date,received_by,source_file)
 values (p->>'grn_no',p->>'branch',nullif(p->>'supplier_code',''),p->>'invoice_no',(p->>'grn_date')::date,p->>'received_by',nullif(p->>'source_file','')) returning id into gid;
 for l in select * from jsonb_array_elements(p->'lines') loop
  insert into grn_lines(grn_id,item_code,qty,unit_price) values (gid,l->>'item_code',(l->>'qty')::numeric,coalesce((l->>'unit_price')::numeric,0));
 end loop;
 return gid; end $$;

-- row level security
alter table public.profiles enable row level security;alter table public.items enable row level security;alter table public.suppliers enable row level security;
alter table public.supplier_prices enable row level security;alter table public.grns enable row level security;alter table public.grn_lines enable row level security;
alter table public.issues enable row level security;alter table public.reorder_levels enable row level security;alter table public.branches enable row level security;
create policy "read" on public.branches for select to authenticated using (true);
create policy "read own profile" on public.profiles for select to authenticated using (user_id=auth.uid() or my_role()='admin');
create policy "admin profiles" on public.profiles for all to authenticated using (my_role()='admin') with check (my_role()='admin');
create policy "read" on public.items for select to authenticated using (true);
create policy "admin items" on public.items for all to authenticated using (my_role()='admin') with check (my_role()='admin');
create policy "read" on public.suppliers for select to authenticated using (true);
create policy "admin suppliers" on public.suppliers for all to authenticated using (my_role()='admin') with check (my_role()='admin');
create policy "read" on public.supplier_prices for select to authenticated using (true);
create policy "admin prices" on public.supplier_prices for all to authenticated using (my_role()='admin') with check (my_role()='admin');
create policy "read" on public.grns for select to authenticated using (true);
create policy "insert own branch" on public.grns for insert to authenticated with check (can_write(branch));
create policy "read" on public.grn_lines for select to authenticated using (true);
create policy "insert own branch" on public.grn_lines for insert to authenticated with check (exists(select 1 from grns g where g.id=grn_id and can_write(g.branch)));
create policy "read" on public.issues for select to authenticated using (true);
create policy "insert own branch" on public.issues for insert to authenticated with check (can_write(branch));
create policy "read" on public.reorder_levels for select to authenticated using (true);
create policy "write own branch" on public.reorder_levels for all to authenticated using (can_write(branch)) with check (can_write(branch));
-- grns, grn_lines, issues have no update/delete policy: records are permanent.

-- storage bucket for the uploaded HIS report (PDF/scan)
insert into storage.buckets (id,name,public) values ('grn-files','grn-files',false) on conflict do nothing;
create policy "upload" on storage.objects for insert to authenticated with check (bucket_id='grn-files');
create policy "view" on storage.objects for select to authenticated using (bucket_id='grn-files');

-- live updates between users
alter publication supabase_realtime add table public.grns, public.grn_lines, public.issues, public.reorder_levels;

-- seed: items, suppliers, quotation prices (Oct-2026)
insert into public.items(code,name,uom) values
('STN-001','CR Book 200pg','nos'),
('STN-002','CR Book 160pg','nos'),
('STN-003','Exercise Book 200pg','nos'),
('STN-004','Varnish Paper Blue','roll'),
('STN-005','Varnish Paper Green','roll'),
('STN-006','Ball Pen Blue Atlas Chooty T (box of 50)','box'),
('STN-007','Ball Pen Red Atlas Chooty T (box of 50)','box'),
('STN-008','Ball Pen Black Atlas Chooty T (box of 50)','box'),
('STN-009','Cello Tape 1 inch','nos'),
('STN-010','Cello Tape 2 inch','nos'),
('STN-011','Glue Bottle 750ml','nos'),
('STN-012','OHP Pen Black','pcs'),
('STN-013','A4 Paper 80gsm','ream'),
('STN-014','Stapler Pin 24/6','pkt'),
('STN-015','Polythene Roll','roll'),
('STN-016','Permanent Marker Black','nos'),
('STN-017','Permanent Marker Blue','nos'),
('STN-018','Cardboard File Cover Brown (100 sheet pack)','pack'),
('STN-019','Eraser Medium','nos'),
('STN-020','Pencil (pack of 12)','pack'),
('STN-021','Rubber Band','pkt'),
('STN-022','Highlighter Yellow','pcs'),
('STN-023','Highlighter Blue','pcs'),
('STN-024','Scissor Large','nos'),
('STN-025','Stapler Machine HD-45','nos'),
('STN-026','Steel Ruler 12 inch','nos'),
('STN-027','Correction Bottle','nos'),
('STN-028','Box File Blue F4','nos');
insert into public.suppliers(code,name,note) values
('SUP-001','Senarath Distributors','Invoice 90229575, 18-Sep-2026 (16 lines)'),
('SUP-002','Liyanage Stationers','Handwritten quote, 24-Sep-2026'),
('SUP-003','Eco Stationery','Quote 05-Oct-2026, valid to 19-Oct'),
('SUP-004','Premium Stationers','Quote expired 30-Sep-2026; advance payment'),
('SUP-005','Narah Computer Forms','Quote 02-Oct-2026; prices ex-VAT');
insert into public.supplier_prices(item_code,supplier_code,price,brand) values
('STN-001','SUP-001',330,''),
('STN-001','SUP-002',390,''),
('STN-001','SUP-003',340,''),
('STN-001','SUP-004',410,''),
('STN-001','SUP-005',219,''),
('STN-002','SUP-001',262.5,''),
('STN-002','SUP-002',320,''),
('STN-002','SUP-003',280,''),
('STN-002','SUP-004',333,''),
('STN-002','SUP-005',178,''),
('STN-003','SUP-001',161.25,''),
('STN-003','SUP-002',195,''),
('STN-003','SUP-003',170,''),
('STN-003','SUP-004',200,''),
('STN-003','SUP-005',107,''),
('STN-004','SUP-002',500,''),
('STN-004','SUP-004',130,''),
('STN-004','SUP-005',140,''),
('STN-005','SUP-002',500,''),
('STN-005','SUP-004',130,''),
('STN-005','SUP-005',140,''),
('STN-006','SUP-001',937.5,''),
('STN-006','SUP-002',1200,''),
('STN-006','SUP-003',1050,''),
('STN-006','SUP-004',1175,''),
('STN-006','SUP-005',700,''),
('STN-007','SUP-001',937.5,''),
('STN-007','SUP-002',1200,''),
('STN-007','SUP-003',1050,''),
('STN-007','SUP-004',1175,''),
('STN-007','SUP-005',700,''),
('STN-008','SUP-001',937.5,''),
('STN-008','SUP-002',1200,''),
('STN-008','SUP-003',1050,''),
('STN-008','SUP-004',1175,''),
('STN-008','SUP-005',700,''),
('STN-009','SUP-001',60,''),
('STN-009','SUP-002',45,''),
('STN-009','SUP-003',85,''),
('STN-009','SUP-004',85,''),
('STN-009','SUP-005',20,''),
('STN-010','SUP-001',97.5,''),
('STN-010','SUP-002',80,''),
('STN-010','SUP-003',167.5,''),
('STN-010','SUP-004',145,''),
('STN-010','SUP-005',40,''),
('STN-011','SUP-002',375,''),
('STN-011','SUP-003',212.5,''),
('STN-011','SUP-004',390,''),
('STN-012','SUP-002',216.67,''),
('STN-012','SUP-003',87.5,''),
('STN-012','SUP-004',153,''),
('STN-012','SUP-005',57,''),
('STN-013','SUP-001',1133,''),
('STN-013','SUP-002',1250,''),
('STN-013','SUP-003',1360,''),
('STN-013','SUP-004',1500,''),
('STN-013','SUP-005',870,''),
('STN-014','SUP-003',90,''),
('STN-014','SUP-004',120,''),
('STN-014','SUP-005',61.5,''),
('STN-015','SUP-002',750,''),
('STN-015','SUP-004',240,''),
('STN-015','SUP-005',112,''),
('STN-016','SUP-001',93.75,''),
('STN-016','SUP-002',110,''),
('STN-016','SUP-003',100,''),
('STN-016','SUP-004',145,''),
('STN-016','SUP-005',75,''),
('STN-017','SUP-001',93.75,''),
('STN-017','SUP-002',110,''),
('STN-017','SUP-003',100,''),
('STN-017','SUP-004',145,''),
('STN-017','SUP-005',75,''),
('STN-018','SUP-002',1550,''),
('STN-018','SUP-003',1400,''),
('STN-018','SUP-004',2125,''),
('STN-018','SUP-005',1600,''),
('STN-019','SUP-002',15,''),
('STN-019','SUP-003',22.5,''),
('STN-019','SUP-004',130,''),
('STN-019','SUP-005',12.7,''),
('STN-020','SUP-001',360,''),
('STN-020','SUP-002',276,''),
('STN-020','SUP-003',360,''),
('STN-020','SUP-004',1020,''),
('STN-020','SUP-005',312,''),
('STN-021','SUP-002',70,''),
('STN-021','SUP-003',65,''),
('STN-021','SUP-004',300,''),
('STN-021','SUP-005',55,''),
('STN-022','SUP-001',112.5,''),
('STN-022','SUP-002',110,''),
('STN-022','SUP-003',112.5,''),
('STN-022','SUP-004',135,''),
('STN-022','SUP-005',65,''),
('STN-023','SUP-002',110,''),
('STN-023','SUP-003',112.5,''),
('STN-023','SUP-004',135,''),
('STN-023','SUP-005',65,''),
('STN-024','SUP-001',315,''),
('STN-024','SUP-002',390,''),
('STN-024','SUP-003',750,''),
('STN-024','SUP-004',680,''),
('STN-024','SUP-005',255,''),
('STN-025','SUP-001',172.5,''),
('STN-025','SUP-002',700,''),
('STN-025','SUP-003',520,''),
('STN-025','SUP-004',700,''),
('STN-025','SUP-005',405,''),
('STN-026','SUP-002',230,''),
('STN-026','SUP-003',115,''),
('STN-026','SUP-004',300,''),
('STN-026','SUP-005',70,''),
('STN-027','SUP-001',112.5,''),
('STN-027','SUP-002',175,''),
('STN-027','SUP-003',130,''),
('STN-027','SUP-004',160,''),
('STN-027','SUP-005',90,''),
('STN-028','SUP-002',790,''),
('STN-028','SUP-003',387,''),
('STN-028','SUP-004',1150,''),
('STN-028','SUP-005',320,''),
('STN-001','SUP-003',320,'Penmark'),
('STN-002','SUP-003',260,'Penmark'),
('STN-003','SUP-003',157.5,'Penmark'),
('STN-013','SUP-003',1690,'Double A');

-- AFTER creating users in Supabase > Authentication > Users, run (replace the emails):
-- insert into public.profiles(user_id,full_name,role) select id,'Achira','admin' from auth.users where email='YOUR@EMAIL';
-- insert into public.profiles(user_id,full_name,role,branch) select id,'Kiribathgoda store','center','Kiribathgoda' from auth.users where email='CENTER@EMAIL';
