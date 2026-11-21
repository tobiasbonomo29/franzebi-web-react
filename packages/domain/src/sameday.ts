/**
 * Same day: pago acreditado antes del corte + zona de moto elegible => entrega estimada mismo día.
 * Parametrizable. Corte vigente 11:30 (D-03, confirmado por el dueño); ventana 16 a 22 hs.
 */
export interface SameDayConfig {
  enabled: boolean;
  timeZone: string; // "America/Argentina/Buenos_Aires"
  cutoff: string; // "HH:MM"
  windowLabel: string; // "16 a 22 hs"
  /** 0=domingo … 6=sábado */
  operatingWeekdays: number[];
}

export interface DeliveryEstimate {
  sameDay: boolean;
  label: string;
}

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { weekday, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export function estimateMotoDelivery(paidAt: Date, zoneSameDayEligible: boolean, cfg: SameDayConfig): DeliveryEstimate {
  if (!cfg.enabled || !zoneSameDayEligible) return { sameDay: false, label: "Entrega a coordinar" };
  const [h, m] = cfg.cutoff.split(":").map(Number);
  const cutoffMin = (h ?? 0) * 60 + (m ?? 0);
  const { weekday, minutes } = localParts(paidAt, cfg.timeZone);
  if (cfg.operatingWeekdays.includes(weekday) && minutes < cutoffMin) {
    return { sameDay: true, label: `Llega hoy de ${cfg.windowLabel}` };
  }
  return { sameDay: false, label: `Próximo día hábil de ${cfg.windowLabel}` };
}
