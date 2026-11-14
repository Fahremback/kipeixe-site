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

export function brazilTimeMinutes(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const part = (type) => Number(parts.find((p) => p.type === type)?.value);
  return part('hour') * 60 + part('minute');
}

export function addCalendarDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function nextReservationChoice(now = new Date()) {
  const date = todayInBrazil(now);
  const currentMinutes = brazilTimeMinutes(now);
  const firstFutureSlot = RESERVATION_SLOTS.find((slot) => Number(slot.slice(0, 2)) * 60 + Number(slot.slice(3)) > currentMinutes);
  return firstFutureSlot ? {date, time: firstFutureSlot} : {date: addCalendarDays(date, 1), time: RESERVATION_SLOTS[0]};
}

export function normalizeOrigin(raw) {
  const origin = String(raw ?? '').trim();
  return /^[a-z0-9_-]{1,32}$/i.test(origin) ? origin.toUpperCase() : 'SITE';
}

export function getCampaignVariant(origin) {
  const code = normalizeOrigin(origin);
  if (['META_VIDEO_PEIXE', 'META_PEIXE', 'IG_STORY_PEIXE', 'IG_REEL_PEIXE', 'FB_STORY_PEIXE', 'IG_FEED_PEIXE'].includes(code)) return 'peixe';
  if (['META_VIDEO_AMBIENTE', 'META_LAGO', 'IG_STORY_LAGO', 'IG_REEL_AMBIENTE', 'FB_STORY_LAGO', 'IG_FEED_LAGO'].includes(code)) return 'ambiente';
  return 'geral';
}

export function campaignHero(variant) {
  if (variant === 'peixe') return {
    headline: 'Peixe bem servido',
    emphasis: 'e boa companhia.',
    description: 'Tilápia, porções e pratos completos no Kipeixe. Escolha o dia e consulte uma mesa para seu almoço em Três Lagoas.',
    image: 'assets/produtos/tilapia-milanesa.webp',
    alt: 'Prato de tilápia à milanesa com acompanhamentos',
  };
  return {
    headline: 'Uma boa mesa',
    emphasis: 'merece companhia.',
    description: 'Tilápia, porções, pratos completos e o nosso lago para aproveitar com a família ou os amigos.',
    image: 'assets/ambiente/lago-mesas.webp',
    alt: 'Mesas do Kipeixe junto ao lago',
  };
}

// Evento de clique/abertura do WhatsApp. Não representa reserva confirmada.
export function trackContactClick(fbq) {
  if (typeof fbq !== 'function') return false;
  fbq('track', 'Contact', {content_name: 'consulta_mesa_presencial'});
  return true;
}

export function buildReservationLink({ date, time, partySize, origin = 'SITE', today = todayInBrazil(), now = new Date() }) {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? Date.parse(`${date}T00:00:00.000Z`) : NaN;
  const todayMs = Date.parse(`${today}T00:00:00.000Z`);
  const validDate = Number.isFinite(iso) && new Date(iso).toISOString().slice(0, 10) === date;
  if (!validDate || !Number.isFinite(todayMs) || iso < todayMs || iso > todayMs + MAX_DAYS_AHEAD * 86_400_000) {
    throw new Error('Escolha uma data válida nos próximos 30 dias.');
  }
  if (!RESERVATION_SLOTS.includes(time)) {
    throw new Error('Escolha um horário disponível para consulta.');
  }
  if (date === today && today === todayInBrazil(now) &&
      Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) <= brazilTimeMinutes(now)) {
    throw new Error('Este horário já passou. Escolha um horário futuro.');
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
  const pageParams = new URLSearchParams(window.location.search);
  const pageOrigin = pageParams.get('origem') ?? pageParams.get('utm_source') ?? 'SITE';
  const variant = getCampaignVariant(pageOrigin);
  const hero = campaignHero(variant);
  document.documentElement.dataset.campaignVariant = variant;
  const heroImage = document.querySelector('[data-hero-image]');
  const heroHeadline = document.querySelector('[data-hero-headline]');
  const heroEmphasis = document.querySelector('[data-hero-emphasis]');
  const heroDescription = document.querySelector('[data-hero-description]');
  if (heroImage && heroHeadline && heroEmphasis && heroDescription) {
    heroHeadline.textContent = hero.headline;
    heroEmphasis.textContent = hero.emphasis;
    heroDescription.textContent = hero.description;
    heroImage.src = hero.image;
    heroImage.alt = hero.alt;
  }
  const form = document.querySelector('[data-reserva-form]');
  if (form) {
    if (typeof window.fbq === 'function') {
      window.fbq('track', 'ViewContent', {content_name: 'visita_presencial'});
    }
    const dateInput = form.querySelector('[name="data"]');
    const feedback = form.querySelector('[data-reserva-feedback]');
    const today = todayInBrazil();
    const until = addCalendarDays(today, MAX_DAYS_AHEAD);
    dateInput.min = today;
    dateInput.max = until;
    const timeInput = form.querySelector('[name="horario"]');
    const shortcuts = [...form.querySelectorAll('[data-date-offset]')];

    const syncDates = () => {
      const current = todayInBrazil();
      const currentMinutes = brazilTimeMinutes();
      const hasTodaySlot = RESERVATION_SLOTS.some((slot) => Number(slot.slice(0, 2)) * 60 + Number(slot.slice(3)) > currentMinutes);
      dateInput.min = current;
      dateInput.max = addCalendarDays(current, MAX_DAYS_AHEAD);
      if (dateInput.value === current && !hasTodaySlot) dateInput.value = addCalendarDays(current, 1);
      shortcuts.forEach((button) => {
        const date = addCalendarDays(current, Number(button.dataset.dateOffset));
        button.disabled = date === current && !hasTodaySlot;
        button.setAttribute('aria-pressed', String(dateInput.value === date));
      });
      [...timeInput.options].forEach((option) => {
        const slotMinutes = Number(option.value.slice(0, 2)) * 60 + Number(option.value.slice(3));
        option.disabled = dateInput.value === current && slotMinutes <= currentMinutes;
      });
      if (timeInput.selectedOptions[0]?.disabled) {
        timeInput.value = [...timeInput.options].find((option) => !option.disabled)?.value || '';
      }
    };

    const next = nextReservationChoice();
    dateInput.value = next.date;
    timeInput.value = next.time;
    syncDates();
    shortcuts.forEach((button) => button.addEventListener('click', () => {
      const offset = Number(button.dataset.dateOffset);
      dateInput.value = addCalendarDays(todayInBrazil(), offset);
      timeInput.value = offset === 0 ? nextReservationChoice().time : '12:00';
      syncDates();
    }));
    dateInput.addEventListener('change', syncDates);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        const url = buildReservationLink({
          date: dateInput.value,
          time: form.querySelector('[name="horario"]').value,
          partySize: form.querySelector('[name="pessoas"]').value,
          origin: pageOrigin,
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
