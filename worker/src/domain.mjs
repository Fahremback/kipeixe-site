export const TZ = 'America/Sao_Paulo';
export const ORDER_TYPES = new Set(['Retirada no Kipeixe', 'Consumir no local', 'Entrega']);
export const PENDING_DECISION = new Set(['AWAITING_ACCEPTANCE', 'SCHEDULED']);
export const DEFAULT_HOURS = Object.fromEntries(Array.from({ length: 7 }, (_, day) => [
  String(day), { open: '09:00', close: '23:40' },
]));

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localSlot(date = new Date()) {
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return {
    day: weekdays[parts.weekday],
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

const toMinute = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

export function validateHours(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Horários inválidos.');
  const result = {};
  for (let day = 0; day < 7; day++) {
    const slot = value[String(day)];
    if (slot === null) { result[String(day)] = null; continue; }
    if (!slot || !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.open) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.close) ||
      toMinute(slot.close) <= toMinute(slot.open)) throw new Error('Informe abertura e fechamento válidos.');
    result[String(day)] = { open: slot.open, close: slot.close };
  }
  return result;
}

export function openAt(date, hours) {
  const local = localSlot(date);
  const slot = hours[String(local.day)];
  if (!slot) return false;
  return local.minute >= toMinute(slot.open) && local.minute < toMinute(slot.close);
}

export function validateFulfillment(mode, scheduledAt, hours, now = new Date()) {
  if (mode === 'immediate') {
    if (scheduledAt) throw new Error('Pedido imediato não aceita agendamento.');
    if (!openAt(now, hours)) throw new Error('Restaurante fechado. Escolha um horário agendado.');
    return null;
  }
  if (mode !== 'scheduled' || typeof scheduledAt !== 'string') throw new Error('Escolha quando receber o pedido.');
  const date = new Date(scheduledAt);
  if (!Number.isFinite(date.getTime()) || !/Z$|[+-]\d{2}:\d{2}$/.test(scheduledAt)) {
    throw new Error('Horário agendado inválido.');
  }
  const delta = date.getTime() - now.getTime();
  if (delta < 15 * 60_000 || delta > 7 * 24 * 60 * 60_000) {
    throw new Error('Agende entre 15 minutos e 7 dias de antecedência.');
  }
  if (!openAt(date, hours)) throw new Error('O horário escolhido está fora do funcionamento.');
  return date.toISOString();
}

export function acceptanceDeadline(paidAt, scheduledFor = null) {
  if (scheduledFor) return scheduledFor;
  return new Date(new Date(paidAt).getTime() + 30 * 60_000).toISOString();
}

export function nextStatus(from, action) {
  if (action === 'ACCEPT' && PENDING_DECISION.has(from)) return 'PREPARING';
  if (action === 'REJECT' && PENDING_DECISION.has(from)) return 'REJECTED';
  if (action === 'READY' && from === 'PREPARING') return 'READY';
  if (action === 'COMPLETE' && from === 'READY') return 'COMPLETED';
  throw new Error('Transição de pedido não permitida.');
}
