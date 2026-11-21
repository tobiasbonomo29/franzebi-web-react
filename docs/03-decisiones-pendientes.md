# 03 · Decisiones pendientes y contradicciones

**Estado al 2026-11-21.** Resueltas: D-01 a D-08 (D-08 provisoria), D-10, D-11, D-12, D-13 y D-18. Abiertas: D-09, D-14 a D-17, D-19 a D-21 y las nuevas D-22 a D-26 (salieron de la conciliación con Alegra).

Ninguna de estas reglas se decidió por cuenta propia. Todas quedaron **configurables**. El valor actual es el **comportamiento de producción hoy** o la opción más conservadora, y cada caso dice cuál. El dueño tiene que confirmar cada una antes del cutover.

| ID | Tema | Fuentes en conflicto | Default implementado | Dónde se cambia |
|---|---|---|---|---|
| **D-01** ✅ | ¿En qué entregas se acepta efectivo? | **Resuelto 2026-11-21 (dueño):** sólo retiro por el local | Sólo **retiro** | `settings.payments.cash.allowedDeliveryKinds` |
| **D-02** ✅ | Estado final de retiro + efectivo | **Resuelto 2026-11-21 (dueño):** queda En espera hasta que el operador lo confirma | `on_hold` | `settings.payments.cash.initialOrderStatus` |
| **D-03** ✅ | Corte para entrega en el día | **Resuelto 2026-11-21 (dueño):** corte **11:30**, entrega de 16 a 22 hs, **lunes a viernes** | 11:30, L-V | `settings.sameday` |
| **D-04** ✅ | Pesos mayoristas y ejemplo "2 cosmética + 1 diseñador" | **Resuelto 2026-11-21 (dueño):** se mantienen los pesos y umbrales actuales (árabe 1; diseñador 2 / 1,5; cosmética 0,5; umbrales 10 / 3). El ejemplo suma 2,5 y no califica | Pesos vigentes | `wholesale_rules` v1 |
| **D-05** ✅ | ¿Los decants suman puntos mayoristas? | **Resuelto 2026-11-21 (dueño):** no suman | 0 | `wholesale_rules.groups` |
| **D-06** ✅ | Exclusiones de moto | **Resuelto 2026-11-21 (dueño):** Burzaco se excluye. Se mantiene la lista completa del código activo | Lista del código | `settings.shipping.excludedCities/Postcodes` |
| **D-07** ✅ | Precio de "Horario específico CABA" | **Resuelto 2026-11-21 (dueño):** $12.000 | $12.000 | `settings.shipping.scheduledCaba` |
| **D-08** ✅ provisorio | ¿Siguen ocultos los precios de diseñador? | **Resuelto 2026-11-21 (dueño):** ocultos *por el momento*; revisar antes del cutover | Ocultos, sin `Offer` en el JSON-LD | `products.hide_price` / `settings.catalog.hideDesignerPrices` |
| **D-09** | Mapeo de categorías Alegra ⇄ tienda | El árbol de la tienda (214 categorías, "Marca – Arabe Masc") no sale de Alegra 1:1. ¿Cuál es la fuente de verdad? | La categoría se conserva desde Woo. El sync sólo asigna si el nombre coincide | `sync-runner.ts › resolveCategory` |
| **D-10** ✅ | Nombre de la lista minorista en Alegra | **Resuelto 2026-11-21 (dueño):** `ARABES MINORISTA (pesos)` (es la lista principal en Alegra). Existe además una lista `MINORISTA` activa con los mismos precios en la muestra | `ARABES MINORISTA (pesos)` | `ALEGRA_RETAIL_PRICE_LIST` |
| **D-11** ✅ | Alta de mayorista | **Resuelto 2026-11-21 (dueño):** automática al confirmarse una primera compra de ≥10 puntos. El admin igual puede asignar a mano | Automática | `changeOrderStatus` / `/admin/clientes` |
| **D-12** ✅ | Páginas demo | **Resuelto 2026-11-21 (dueño):** las ~30 URLs demo del theme responden 410. Términos y devoluciones → 301 a FAQ hasta tener páginas propias | 410 | Tabla `redirects` |
| **D-13** ✅ | Contenido del FAQ | **Aprobado 2026-11-21 (dueño):** el FAQ viejo no se migra; se cargó un texto nuevo coherente con las reglas confirmadas (sin crypto ni tecnología, corte 11:30, mayorista por puntos) | FAQ nuevo en el seed | `settings.faq` (editable en el admin) |
| **D-14** | `woo-extra-product-options` | Activo. No se sabe si algún producto usa opciones | No se migra | Revisar export |
| **D-15** | Píxel de Meta / catálogo de Facebook | Plugin activo con verificación de dominio | No se migra (pendiente) | — |
| **D-16** | ¿Electrónica se oculta o se borra? | Brief: oculta. Producción: 293 productos **vendibles** y en el menú | Oculta (categoría `is_visible=false` → 404 + fuera del sitemap). **No se borra nada** | `categories.is_visible` |
| **D-17** | Diseñador "a pedido" con stock | 211 productos de diseñador figuran con stock > 0, pero se venden a pedido | Todo el diseñador va a pedido | `products.sale_mode` (override por producto) |
| **D-18** ✅ | ¿Quién baja el pedido a Alegra? | **Resuelto 2026-11-21 (dueño):** AstroSelling por ahora; reemplazable si se deja de usar. Implementado como outbox (`order_events`) + `OrderSink`. **Falta confirmar con AstroSelling** que su canal acepte pedidos de la app nueva (ver docs/04 Fase 5) | Sink `astroselling` | `settings.integrations.orderSinks` |
| **D-19** | Fichas duplicadas con SKU numérico (637, 642, 661, 725) | Desligadas de Alegra | No se migran: quedan listadas para revisión. **No se borran en Woo sin autorización** | — |
| **D-20** | Productos utilitarios `534 ENVIO` / `535 RESERVAS` ($0) | Publicados | No se publican (sale_mode `hidden`) | `/admin/productos` |
| **D-21** | Base del 5% de efectivo | No se sabe si se calcula sobre productos o productos + envío (hoy sólo se usa con retiro, donde da igual) | Sobre **productos** | `cashDiscount()` |
| **D-22** | SKU canónico: Alegra renombró los decants | En Alegra los decants tienen sufijo `_ARB` / `_DIS` (688 casos) y Woo guardó SKUs con entidades HTML (`&#8217;`, `&amp;`, 34 casos) | El SKU de **Alegra** es el canónico. La ficha de Woo (slug/URL, fotos, categorías, descripción) se engancha con `mapWooToAlegra` (1.720 de 1.726 mapeadas, 0 ambiguas). Las URLs no cambian | `packages/sync/src/legacy-map.ts` |
| **D-23** | ¿Qué se publica de lo que está en Alegra y no en Woo? | Alegra tiene 1.121 ítems sin ficha en Woo (106 activos con stock): ~200 **testers**, 37 **Victoria's Secret body**, 18 **Karseell**, sprays, ~780 decants extra y algunos "FALSO" | **Nada se publica solo**: el sync crea esos productos como *no publicados*; se publican desde `/admin/productos`. Falta que el dueño diga qué familias se venden online | `products.published` |
| **D-24** | ¿De dónde salen las fotos de productos nuevos? | Alegra **no tiene imágenes** de ítems; hoy las fotos están sólo en Woo (las sube AstroSelling o a mano) | Migración única de las fotos de Woo. Para productos nuevos falta definir: ¿subida en el admin? ¿AstroSelling? | — |
| **D-25** | 30 ítems de Alegra **sin SKU** | Entre ellos `ENVIO`, `RESERVAS`, "FALSO 70" y 4 decants (Lattafa Qimmah/Wajood/Victoria 5ML, Yeah! Man 5ML) que en Woo son las fichas duplicadas con SKU numérico 637/642/661/725 | Se rechazan en el sync (no hay ficha sin SKU). Hay que cargarles referencia en Alegra o confirmar que no se venden | Alegra |
| **D-26** | Precios y stock de Woo desactualizados | 25 árabes tienen precio **más alto en Alegra** que en Woo (Woo quedó viejo). 9 árabes difieren en stock. El resto de las diferencias de stock son electrónica y diseñador (ocultos / a pedido) | Al migrar, manda Alegra: esos 25 productos **suben de precio** en la tienda nueva respecto de hoy | Informativo |

## Cómo se resuelve cada una

1. El dueño responde en este documento con la regla definitiva y la fuente (por ejemplo, "WhatsApp del 2026-11-25").
2. Se carga el valor en `/admin/configuracion`. Queda auditado.
3. Si cambia el dominio (por ejemplo, D-04), se crea una nueva versión de `wholesale_rules` y se agrega el test correspondiente en `packages/domain/test`.
