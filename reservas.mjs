const WHATSAPP_PHONE = '554535772363';
const MAX_DAYS_AHEAD = 30;
export const RESERVATION_SLOTS = ['11:00', '12:00', '13:00', '18:00', '19:00', '20:00', '21:00'];

export function todayInBrazil(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const pick = (type) => parts.find((p) => p.type === type)?.value;
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

export function normalizeOrigin(raw) {
  const origin = String(raw ?? '').trim();
  return /^[a-z0-9_-]{1,32}$/i.test(origin) ? origin.toUpperCase() : 'SITE';
}

// Evento de clique/abertura do WhatsApp. Não representa reserva confirmada.
export function trackContactClick(fbq) {
  if (typeof fbq !== 'function') return false;
  fbq('track', 'Contact', {content_name: 'consulta_mesa_presencial'});
  return true;
}

export function buildReservationLink({ date, time, partySize, origin = 'SITE', today = todayInBrazil() }) {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? Date.parse(`${date}T00:00:00.000Z`) : NaN;
  const todayMs = Date.parse(`${today}T00:00:00.000Z`);
  const validDate = Number.isFinite(iso) && new Date(iso).toISOString().slice(0, 10) === date;
  if (!validDate || !Number.isFinite(todayMs) || iso < todayMs || iso > todayMs + MAX_DAYS_AHEAD * 86_400_000) {
    throw new Error('Escolha uma data válida nos próximos 30 dias.');
  }
  if (!RESERVATION_SLOTS.includes(time)) {
    throw new Error('Escolha um horário disponível para consulta.');
  }
  const party = Number(partySize);
  if (!Number.isInteger(party) || party < 1 || party > 20) {
    throw new Error('Informe de 1 a 20 pessoas.');
  }
  const [year, month, day] = date.split('-');
  const dateBR = `${day}/${month}/${year}`;
  const timeBR = `${Number(time.slice(0, 2))}h`;
  const number = party === 1 ? '1 pessoa' : `${party} pessoas`;
  const message = `Olá! Quero consultar uma mesa no Kipeixe para ${dateBR} às ${timeBR}, ${number}. Origem: ${normalizeOrigin(origin)}. Podem confirmar disponibilidade e reserva?`;
  return `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`;
}

if (typeof document !== 'undefined') {
  const form = document.querySelector('[data-reserva-form]');
  if (form) {
    if (typeof window.fbq === 'function') {
      window.fbq('track', 'ViewContent', {content_name: 'visita_presencial'});
    }
    const dateInput = form.querySelector('[name="data"]');
    const feedback = form.querySelector('[data-reserva-feedback]');
    const today = todayInBrazil();
    const until = new Date(Date.parse(`${today}T00:00:00Z`) + MAX_DAYS_AHEAD * 86_400_000).toISOString().slice(0, 10);
    dateInput.min = today;
    dateInput.max = until;
    dateInput.value = today;

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        const params = new URLSearchParams(window.location.search);
        const origin = params.get('origem') ?? params.get('utm_source') ?? 'SITE';
        const url = buildReservationLink({
          date: dateInput.value,
          time: form.querySelector('[name="horario"]').value,
          partySize: form.querySelector('[name="pessoas"]').value,
          origin,
          today: todayInBrazil()
        });
        trackContactClick(window.fbq);
        feedback.textContent = 'Abrindo o WhatsApp. Sua reserva será confirmada pela equipe.';
        window.location.assign(url);
      } catch (error) {
        feedback.textContent = error.message;
        feedback.focus();
      }
    });
  }
}
