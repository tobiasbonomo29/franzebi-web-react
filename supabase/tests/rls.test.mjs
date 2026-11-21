// Suite SQL/RLS sobre PGlite (Postgres WASM) con stubs mínimos de Supabase. Uso: npm run test:db
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const REPO = process.argv[2] ?? ".";
const db = new PGlite({ extensions: { pg_trgm, unaccent, pgcrypto } });
const stub = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage; create schema extensions;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true),'') $$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
grant usage on schema public, auth, storage to anon, authenticated;
`;
const run = async (label, sql) => {
  try { await db.exec(sql); console.log("OK  ", label); }
  catch (e) { console.log("FAIL", label, "\n   ", e.message); process.exitCode = 1; throw e; }
};
await run("stubs", stub);
for (const f of fs.readdirSync(`${REPO}/supabase/migrations`).sort()) await run(f, fs.readFileSync(`${REPO}/supabase/migrations/${f}`, "utf8"));
await run("grants", `grant select on all tables in schema public to anon, authenticated; grant update (full_name, phone, dni, default_shipping_address, marketing_opt_in) on public.profiles to authenticated; grant update (status, paid_at, customer_note, estimated_delivery) on public.orders to authenticated; grant usage on all sequences in schema public to authenticated;`);
await run("seed.sql", fs.readFileSync(`${REPO}/supabase/seed.sql`, "utf8"));

const one = async (sql) => (await db.query(sql)).rows;
const expectErr = async (label, sql, re) => {
  try { await db.exec(sql); console.log("FAIL", label, "(no lanzó error)"); process.exitCode = 1; }
  catch (e) { const ok = re.test(e.message); console.log(ok ? "OK  " : "FAIL", label, ok ? "" : e.message); if (!ok) process.exitCode = 1; }
};
const as = (role, uid) => `set role ${role}; select set_config('request.jwt.claim.sub','${uid ?? ""}',false), set_config('request.jwt.claim.role','${role}',false);`;
const reset = `reset role; select set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claim.role','',false);`;

const U = { admin: "00000000-0000-0000-0000-00000000000a", cust: "00000000-0000-0000-0000-00000000000c", other: "00000000-0000-0000-0000-00000000000d" };
await run("datos de prueba", `
insert into auth.users (id,email) values ('${U.admin}','a@x'),('${U.cust}','c@x'),('${U.other}','d@x');
update public.profiles set role='admin' where id='${U.admin}';
insert into public.products (sku,slug,name,primary_category_id,wholesale_group,stock_qty) values
 ('PER_ARB_M_LAT_ASAD_100ML','lattafa-asad-100ml','Lattafa Asad EDP 100ML',(select id from public.categories where slug='lattafa-arabe-masc'),'arabes',5),
 ('ELEC_CEL_X','celular-x','Celular X',(select id from public.categories where slug='electronica'),null,3),
 ('PER_DIS_F_YSL_MON_PARIS_EDP_90ML','ysl-mon-paris-edp-90ml','YSL Mon Paris EDP 90ML',(select id from public.categories where slug='ysl-dis-fem'),'disenador',0);
update public.products set published=true;
update public.products set sale_mode='on_request', hide_price=true where sku like 'PER_DIS%';
insert into public.products (sku,slug,name,primary_category_id,stock_qty) values ('TESTER_DIOR_SAUVAGE','tester-sauvage','Tester Sauvage',(select id from public.categories where slug='dior-dis-masc'),4);
insert into public.product_categories select id, primary_category_id from public.products where primary_category_id is not null;
insert into public.product_prices select p.id, l.id, case l.code when 'retail' then 4500000 else 3800000 end from public.products p, public.price_lists l;
insert into public.orders (user_id,email,status,payment_method,delivery_kind,delivery_option_id,delivery_label,billing,subtotal_cents,total_cents,pricing_snapshot)
 values ('${U.cust}','c@x','on_hold','bank_transfer','local_pickup','local_pickup','Retiro','{}',4500000,4500000,'{}');
`);

console.log("\n--- aserciones ---");
const chk = (label, cond, extra = "") => { console.log(cond ? "OK  " : "FAIL", label, cond ? "" : extra); if (!cond) process.exitCode = 1; };
let r = await one(`select count(*)::int n, count(*) filter (where is_visible=false)::int hidden from public.categories`);
chk(`categorías cargadas (${r[0].n}), electrónica oculta (${r[0].hidden})`, r[0].n === 214 && r[0].hidden === 55);
r = await one(`select string_agg(name, ' | ' order by sort_name) n from (select name, sort_name from public.categories where parent_id=(select id from public.categories where slug='disenador-masculinas') order by sort_name limit 4) s`);
chk("orden alfabético subcategorías: " + r[0].n, /^Antonio Banderas/.test(r[0].n));

await db.exec(as("anon"));
r = await one(`select sku, retail_price_cents from public.catalog_products order by sku`);
chk("anon: catálogo sin electrónica " + JSON.stringify(r), r.length === 2 && !r.some((x) => x.sku.startsWith("ELEC")));
chk("anon: diseñador sin precio", r.find((x) => x.sku.startsWith("PER_DIS")).retail_price_cents === null);
r = await one(`select count(*)::int n from public.product_prices`);
chk(`anon: sólo precio minorista visible y no de diseñador (filas=${r[0].n})`, r[0].n === 1);
r = await one(`select count(*)::int n from public.products where sku='TESTER_DIOR_SAUVAGE'`);
chk("anon: producto NO publicado (nuevo de Alegra) invisible", r[0].n === 0); // sólo árabe: diseñador oculto, electrónica oculta
r = await one(`select count(*)::int n from public.price_lists where code='wholesale'`);
chk("anon: lista MAYORISTA invisible", r[0].n === 0);
r = await one(`select count(*)::int n from public.orders`);
chk("anon: no ve pedidos", r[0].n === 0);
r = await one(`select key from public.settings order by key`);
chk("anon: sólo settings públicos " + r.map((x) => x.key), !r.some((x) => ["payments", "shipping", "notifications"].includes(x.key)));
r = await one(`select name from public.search_products('lattfa asad')`);
chk("búsqueda 'lattfa asad' encuentra Lattafa (vía trigram) " + JSON.stringify(r), r.length >= 1);
r = await one(`select name from public.search_products('ASÁD')`);
chk("búsqueda con tilde/mayúscula", r.length === 1);
await db.exec(reset);

await db.exec(as("authenticated", U.cust));
r = await one(`select count(*)::int n from public.orders`);
chk("cliente ve su pedido", r[0].n === 1);
await expectErr("cliente NO puede auto-asignarse mayorista", `update public.profiles set role='wholesale' where id='${U.cust}'`, /permission denied|privilege/);
await expectErr("cliente NO puede insertar pedidos", `insert into public.orders (email,status,payment_method,delivery_kind,delivery_option_id,delivery_label,billing,subtotal_cents,total_cents,pricing_snapshot) values ('c','on_hold','bank_transfer','local_pickup','x','x','{}',1,1,'{}')`, /permission denied|row-level security/);
await db.exec(`update public.profiles set full_name='Cliente' where id='${U.cust}'`);
r = await one(`select full_name from public.profiles where id='${U.cust}'`);
chk("cliente edita su nombre", r[0]?.full_name === "Cliente");
r = await one(`select count(*)::int n from public.audit_logs`);
chk("cliente no ve auditoría", r[0].n === 0);
await db.exec(reset);

await db.exec(as("authenticated", U.other));
r = await one(`select count(*)::int n from public.orders`);
chk("otro cliente NO ve pedidos ajenos", r[0].n === 0);
await db.exec(reset);

await expectErr("SKU inmutable", `update public.products set sku='OTRO' where sku='PER_ARB_M_LAT_ASAD_100ML'`, /inmutable/);
await expectErr("SKU debe venir normalizado", `insert into public.products (sku,slug,name) values (' per_x','x','x')`, /check/);
await expectErr("efectivo + Correo bloqueado en la base", `insert into public.orders (email,status,payment_method,delivery_kind,delivery_option_id,delivery_label,billing,subtotal_cents,total_cents,pricing_snapshot) values ('c','on_hold','cash','correo_argentino','x','x','{}',1,1,'{}')`, /check/);
await expectErr("total incoherente bloqueado", `insert into public.orders (email,status,payment_method,delivery_kind,delivery_option_id,delivery_label,billing,subtotal_cents,shipping_cents,total_cents,pricing_snapshot) values ('c','on_hold','bank_transfer','moto','x','x','{}',100,10,100,'{}')`, /check/);
r = await one(`select count(*)::int n from public.audit_logs where entity in ('products','orders','product_prices')`);
chk(`auditoría registra cambios (${r[0].n})`, r[0].n > 0);
await db.exec(`update public.categories set is_visible=true where path='electronica'; update public.categories set is_visible=false where path='electronica';`);
r = await one(`select count(*)::int n from public.categories where path like 'electronica/%' and is_visible`);
chk("ocultar raíz propaga a subcategorías", r[0].n === 0);

// --- place_order: transacción atómica con reserva de stock ---
const pid = (await one(`select id from public.products where sku='PER_ARB_M_LAT_ASAD_100ML'`))[0].id;
const payload = (qty) =>
  JSON.stringify({
    user_id: U.cust, email: "c@x", status: "on_hold", payment_method: "bank_transfer", delivery_kind: "local_pickup",
    delivery_option_id: "local_pickup", delivery_label: "Retiro", billing: {}, subtotal_cents: 4500000 * qty, shipping_cents: 0,
    cash_discount_cents: 0, total_cents: 4500000 * qty, wholesale_applied: false, wholesale_points: qty, wholesale_threshold: 10, pricing_snapshot: {},
    items: [{ product_id: pid, sku: "PER_ARB_M_LAT_ASAD_100ML", name: "Asad", quantity: qty, unit_price_cents: 4500000, retail_unit_price_cents: 4500000, line_total_cents: 4500000 * qty, wholesale_applied: false, wholesale_group: "arabes" }],
  });
r = await one(`select * from public.place_order('${payload(2)}'::jsonb)`);
let st = (await one(`select stock_qty from public.products where id='${pid}'`))[0].stock_qty;
chk(`place_order crea pedido #${r[0].order_number} y descuenta stock (5→${st})`, st === 3);
await expectErr("place_order rechaza sobreventa (pide 4, hay 3)", `select * from public.place_order('${payload(4)}'::jsonb)`, /STOCK_INSUFICIENTE/);
r = await one(`select count(*)::int n from public.orders where email='c@x'`);
chk("la sobreventa no dejó un pedido a medias", r[0].n === 2);
const last = `(select id from public.orders order by number desc limit 1)`;
await db.exec(`select public.release_order_stock(${last}); select public.release_order_stock(${last});`);
st = (await one(`select stock_qty from public.products where id='${pid}'`))[0].stock_qty;
chk(`cancelar devuelve stock una sola vez (idempotente) → ${st}`, st === 5);
await db.exec(as("authenticated", U.cust));
await expectErr("cliente NO puede ejecutar place_order", `select * from public.place_order('{}'::jsonb)`, /permission denied/);
await expectErr("cliente NO puede ejecutar release_order_stock", `select public.release_order_stock(gen_random_uuid())`, /permission denied/);
await expectErr("cliente NO puede reclamar eventos del outbox", `select * from public.claim_order_events(10)`, /permission denied/);
r = await one(`select count(*)::int n from public.order_events`);
chk(`cliente no ve el outbox (${r[0].n})`, r[0].n === 0);
await db.exec(reset);

// --- outbox de pedidos (D-18: AstroSelling) ---
await db.exec(`delete from public.order_events;`);
const oid = (await one(`select id from public.orders order by number limit 1`))[0].id;
await db.exec(`update public.orders set status='processing' where id='${oid}'; update public.orders set status='processing' where id='${oid}'; update public.orders set status='completed' where id='${oid}';`);
r = await one(`select event, order_status, sink from public.order_events where order_id='${oid}' order by id`);
chk(`cambio de estado encola eventos para astroselling, sin duplicar no-cambios (${r.map((x) => x.order_status).join(",")})`, r.length === 2 && r.every((x) => x.sink === "astroselling"));
await db.exec(`insert into public.order_events (order_id,sink,event,order_status,dedupe_key) values ('${oid}','astroselling','order.created','on_hold','manual-created'); update public.order_events set id = 0 where dedupe_key='manual-created';`);
r = await one(`select id, event from public.claim_order_events(10)`);
chk(`claim respeta el orden por pedido: sólo el más viejo (${JSON.stringify(r)})`, r.length === 1 && r[0].event === "order.created");
await db.exec(`update public.order_events set status='sent' where id=0;`);
r = await one(`select id from public.claim_order_events(10)`);
chk(`después de enviar el created, sale el siguiente (${r.length})`, r.length === 1);
await db.exec(`update public.order_events set claimed_at = now() - interval '1 hour' where status='sending';`);
r = await one(`select public.requeue_stuck_order_events() n`);
chk(`eventos colgados vuelven a la cola (${r[0].n})`, r[0].n === 1);

console.log(process.exitCode ? "\nHAY FALLAS" : "\nTODO OK");
