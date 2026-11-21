import type { PaymentsConfig } from "./payments.js";
import type { SameDayConfig } from "./sameday.js";
import type { ShippingConfig } from "./shipping.js";
import type { WholesaleRules } from "./wholesale.js";

/**
 * Valores por defecto = lo que hace PRODUCCIÓN HOY (relevado 2026-11-21 en snippets de Code Snippets).
 * En runtime se leen de la tabla `settings`; estos valores sólo siembran la base (supabase/seed.sql)
 * y sirven para tests. Donde el brief contradice al código activo se marca con D-xx (docs/03-decisiones-pendientes.md).
 */

export const DEFAULT_SHIPPING: ShippingConfig = {
  pickup: { label: "Retiro por el local" },
  // D-07 resuelto (2026-11-21): $12.000.
  scheduledCaba: { enabled: true, label: "Horario específico CABA (coordinar horario)", priceCents: 1200000 },
  correoFallbackPackage: { weightKg: 1, lengthCm: 20, widthCm: 15, heightCm: 10 },
  // D-06 resuelto (2026-11-21): Burzaco se excluye.
  excludedCities: ["general rodriguez", "san vicente", "canuelas", "marcos paz", "mariano acosta", "burzaco"],
  excludedPostcodes: [1723, 1727, 1748, 1814, 1852, 1865],
  motoZones: [
    { id: "verde", label: "Moto CABA (entrega 16 a 22 hs)", priceCents: 400000, caba: true, sameDayEligible: true },
    {
      id: "negra",
      label: "Moto primer cordón",
      priceCents: 600000,
      sameDayEligible: true,
      postcodeRanges: [[1500, 1893]],
      cities: [
        "vicente lopez", "olivos", "florida", "florida oeste", "munro", "villa martelli", "carapachay", "la lucila",
        "san isidro", "acassuso", "beccar", "boulogne sur mer", "martinez", "villa adelina",
        "general san martin", "san martin", "villa ballester", "jose leon suarez", "san andres", "billinghurst", "villa lynch", "villa maipu",
        "tres de febrero", "caseros", "ciudadela", "santos lugares", "saenz pena", "villa bosch", "martin coronado", "ciudad jardin", "villa raffo", "pablo podesta", "loma hermosa",
        "moron", "castelar", "haedo", "el palomar", "villa sarmiento",
        "hurlingham", "villa tesei", "william c morris", "william morris",
        "ituzaingo", "villa gobernador udaondo", "parque leloir",
        "avellaneda", "wilde", "sarandi", "dock sud", "gerli", "villa dominico", "pineyro",
        "lanus", "remedios de escalada", "monte chingolo", "valentin alsina",
        "lomas de zamora", "banfield", "temperley", "lavallol", "llavallol", "turdera", "villa centenario", "villa fiorito", "ingeniero budge",
        "quilmes", "bernal", "don bosco", "ezpeleta", "san francisco solano", "villa la florida",
      ],
    },
    {
      id: "azul",
      label: "Moto zona azul",
      priceCents: 800000,
      sameDayEligible: true,
      postcodeRanges: [[1500, 1893]],
      cities: [
        "escobar", "belen de escobar", "ingeniero maschwitz", "garin", "matheu", "maquinista savio", "loma verde",
        "pilar", "del viso", "manuel alberti", "presidente derqui", "villa rosa", "zelaya", "fatima", "manzanares", "la lonja", "lagomarsino",
        "tigre", "general pacheco", "don torcuato", "el talar", "benavidez", "nordelta", "rincon de milberg", "delfin gallo", "ricardo rojas", "troncos del talar",
        "moreno", "paso del rey", "francisco alvarez", "la reja", "cuartel v", "trujui",
        "merlo", "parque san martin", "libertad", "pontevedra",
        "la matanza", "san justo", "ramos mejia", "lomas del mirador", "la tablada", "tapiales", "villa madero", "ciudad evita", "isidro casanova", "gregorio de laferrere", "gonzalez catan", "virrey del pino", "rafael castillo", "20 de junio", "villa luzuriaga",
        "ezeiza", "tristan suarez", "la union", "carlos spegazzini", "spegazzini",
        "esteban echeverria", "monte grande", "9 de abril", "el jaguel", "luis guillon", "canning",
        "almirante brown", "adrogue", "claypole", "don orione", "glew", "jose marmol", "longchamps", "malvinas argentinas", "ministro rivadavia", "rafael calzada",
        "florencio varela", "bosques", "gobernador costa", "ingeniero allan", "villa vatteone", "zeballos", "la capilla",
        "berazategui", "hudson", "ranelagh", "sourigues", "platanos", "gutierrez", "pereyra", "el pato",
      ],
    },
    {
      id: "roja",
      label: "Moto zona roja",
      priceCents: 950000,
      sameDayEligible: true,
      postcodeRanges: [[1894, 1930], [2790, 2820], [6600, 6750]],
      cities: [
        "zarate", "lima", "campana", "otamendi", "rio lujan",
        "lujan", "jauregui", "open door", "torres", "cortinez", "lezarica",
        "la plata", "city bell", "gonnet", "manuel b gonnet", "ringuelet", "tolosa", "villa elisa", "los hornos", "lisandro olmos", "abasto", "arturo segui", "melchor romero", "villa elvira", "san carlos",
        "berisso", "ensenada", "punta lara",
      ],
    },
  ],
};

export const DEFAULT_PAYMENTS: PaymentsConfig = {
  bankTransfer: {
    enabled: true,
    label: "Transferencia bancaria",
    instructions: "Realizá el pago a nuestra cuenta usando el número de pedido como referencia. El pedido queda En espera hasta validar el pago.",
  },
  cash: {
    enabled: true,
    label: "Efectivo (5% de descuento)",
    discountPercent: 5,
    // D-01 resuelto (2026-11-21): efectivo sólo con retiro por el local.
    allowedDeliveryKinds: ["local_pickup"],
    // D-02 resuelto (2026-11-21): retiro+efectivo queda En espera hasta que el operador lo confirme.
    initialOrderStatus: "on_hold",
  },
  mercadopago: { enabled: false },
  card: { enabled: false },
};

export const DEFAULT_WHOLESALE: WholesaleRules = {
  enabled: true,
  firstPurchaseThreshold: 10,
  restockThreshold: 3,
  groups: {
    arabes: { label: "Árabes", firstPoints: 1, restockPoints: 1 },
    disenador: { label: "Diseñador", firstPoints: 2, restockPoints: 1.5 }, // D-04 resuelto (2026-11-21): pesos vigentes; 2 cosmética + 1 diseñador = 2,5 no califica
    cosmetica: { label: "Cosmética", firstPoints: 0.5, restockPoints: 0.5 },
  },
};

export const DEFAULT_SAMEDAY: SameDayConfig = {
  enabled: true,
  timeZone: "America/Argentina/Buenos_Aires",
  cutoff: "11:30", // D-03 resuelto por el dueño (2026-11-21)
  windowLabel: "16 a 22 hs",
  operatingWeekdays: [1, 2, 3, 4, 5], // lunes a viernes (confirmado 2026-11-21)
};
