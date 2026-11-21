import { formatArs } from "@franzebi/domain";
import { requireStaff } from "@/lib/auth";
import { adminClient } from "@/lib/supabase";
import { actionSetPublished, actionSetSaleMode } from "../actions";

/**
 * Productos: sólo lectura de datos sincronizados (nombre, precio, stock vienen de Alegra; no se editan acá
 * para no desligar la ficha del SKU). Se permite el modo de venta (comprable / a pedido / oculto) como override.
 */
export default async function Products({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string; page?: string }> }) {
  await requireStaff();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  let q = adminClient()
    .from("products")
    .select("id, sku, name, status, published, sale_mode, sale_mode_locked, stock_qty, has_placeholder_image, last_synced_at, missing_in_source_since, product_prices(amount_cents, price_lists(code))", { count: "exact" })
    .order("name")
    .range((page - 1) * 50, page * 50 - 1);
  if (sp.q) q = q.or(`sku.ilike.%${sp.q.replace(/[%,()]/g, "")}%,name.ilike.%${sp.q.replace(/[%,()]/g, "")}%`);
  if (sp.filter === "no_stock") q = q.eq("stock_qty", 0);
  if (sp.filter === "placeholder") q = q.eq("has_placeholder_image", true);
  if (sp.filter === "unpublished") q = q.eq("published", false);
  if (sp.filter === "missing") q = q.not("missing_in_source_since", "is", null);
  const { data, count, error } = await q;
  if (error) throw error;
  const price = (rows: unknown, code: string) => (rows as Array<{ amount_cents: number; price_lists: { code: string } }>).find((r) => r.price_lists.code === code)?.amount_cents;
  return (
    <>
      <h1>Productos y stock <small>({count})</small></h1>
      <form style={{ display: "flex", gap: ".5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <input name="q" placeholder="SKU o nombre" defaultValue={sp.q ?? ""} />
        <select name="filter" defaultValue={sp.filter ?? ""}>
          <option value="">Todos</option><option value="no_stock">Sin stock</option><option value="placeholder">Imagen placeholder</option><option value="missing">Ausentes en Alegra</option><option value="unpublished">No publicados</option>
        </select>
        <button className="btn">Buscar</button>
      </form>
      <table>
        <thead><tr><th>SKU</th><th>Nombre</th><th>Minorista</th><th>Mayorista</th><th>Stock</th><th>Sync</th><th>Modo de venta</th><th>Publicado</th></tr></thead>
        <tbody>
          {data?.map((p) => {
            const r = price(p.product_prices, "retail");
            const w = price(p.product_prices, "wholesale");
            return (
              <tr key={p.id}>
                <td><code>{p.sku}</code></td>
                <td>{p.name}{p.has_placeholder_image && <><br /><small className="badge out">placeholder</small></>}{p.missing_in_source_since && <><br /><small className="badge out">no está en Alegra</small></>}</td>
                <td>{r ? formatArs(r) : "—"}</td>
                <td>{w ? formatArs(w) : "—"}</td>
                <td>{p.stock_qty}</td>
                <td><small>{p.last_synced_at ? new Date(p.last_synced_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }) : "—"}</small></td>
                <td>
                  <form action={actionSetSaleMode} style={{ display: "flex", gap: ".25rem" }}>
                    <input type="hidden" name="productId" value={p.id} />
                    <select name="saleMode" defaultValue={p.sale_mode}><option value="purchasable">Comprable</option><option value="on_request">A pedido</option><option value="hidden">Oculto</option></select>
                    <button className="btn btn-outline" style={{ minHeight: 32, padding: ".2rem .6rem" }}>OK</button>
                  </form>
                  {p.sale_mode_locked && <small>override manual</small>}
                </td>
                <td>
                  <form action={actionSetPublished}>
                    <input type="hidden" name="productId" value={p.id} />
                    <input type="hidden" name="published" value={p.published ? "false" : "true"} />
                    <button className={`btn ${p.published ? "btn-outline" : ""}`} style={{ minHeight: 32, padding: ".2rem .6rem" }}>{p.published ? "Despublicar" : "Publicar"}</button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p>{page > 1 && <a href={`?page=${page - 1}&q=${sp.q ?? ""}&filter=${sp.filter ?? ""}`}>← Anterior</a>} {(count ?? 0) > page * 50 && <a href={`?page=${page + 1}&q=${sp.q ?? ""}&filter=${sp.filter ?? ""}`}>Siguiente →</a>}</p>
    </>
  );
}
