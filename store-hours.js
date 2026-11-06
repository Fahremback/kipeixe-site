/* Horários de funcionamento sempre interpretados no fuso de Foz do Iguaçu. */
(function (root, create) {
  const hours = create();
  if (root) root.KIPEIXE_HOURS = hours;
  if (typeof module !== 'undefined' && module.exports) module.exports = hours;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const TIME_ZONE = 'America/Sao_Paulo';
  const DEFAULT_HOURS = Object.fromEntries(Array.from({ length: 7 }, (_, day) => [
    String(day), { open: '09:00', close: '23:40' }
  ]));
  const DAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const clock = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const localDateTime = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const minute = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

  function isOpenAt(hours, when = new Date()) {
    if (!hours || !Number.isFinite(when.getTime())) return false;
    const parts = Object.fromEntries(clock.formatToParts(when).map(part => [part.type, part.value]));
    const interval = hours[String(DAY_INDEX[parts.weekday])];
    if (!interval || !/^\d{2}:\d{2}$/.test(interval.open) ||
        !/^\d{2}:\d{2}$/.test(interval.close)) return false;
    const current = Number(parts.hour) * 60 + Number(parts.minute);
    return current >= minute(interval.open) && current < minute(interval.close);
  }

  function toInputValue(when) {
    return localDateTime.format(when).replace(' ', 'T');
  }

  function scheduledDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value || '')) return null;
    // Paraná não tem horário de verão; o serviço valida novamente o fuso no backend.
    const date = new Date(value + ':00-03:00');
    return Number.isFinite(date.getTime()) && toInputValue(date) === value ? date : null;
  }

  function validateSchedule(hours, value, now = new Date()) {
    const date = scheduledDate(value);
    if (!date) return { valid: false, message: 'Selecione uma data e hora válidas.' };
    const offset = date.getTime() - now.getTime();
    if (offset < 15 * 60_000) {
      return { valid: false, message: 'Agende com pelo menos 15 minutos de antecedência.' };
    }
    if (offset > 7 * 24 * 60 * 60_000) {
      return { valid: false, message: 'Escolha um horário nos próximos 7 dias.' };
    }
    if (!isOpenAt(hours, date)) {
      return { valid: false, message: 'O restaurante estará fechado nesse horário. Escolha outro.' };
    }
    return { valid: true, date };
  }

  return { TIME_ZONE, DEFAULT_HOURS, isOpenAt, toInputValue, validateSchedule };
});
