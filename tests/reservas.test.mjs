import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReservationLink, normalizeOrigin, todayInBrazil, trackContactClick } from '../reservas.mjs';

test('gera link de consulta de mesa com data, pessoas e origem rastreável', () => {
  const link = buildReservationLink({
    date: '2026-11-15', time: '12:00', partySize: 4, origin: 'META', today: '2026-11-13'
  });
  const url = new URL(link);
  assert.equal(url.host, 'wa.me');
  assert.equal(url.pathname, '/554535772363');
  assert.match(url.searchParams.get('text'), /15\/11\/2026/);
  assert.match(url.searchParams.get('text'), /12h/);
  assert.match(url.searchParams.get('text'), /4 pessoas/);
  assert.match(url.searchParams.get('text'), /Origem: META/);
  assert.match(url.searchParams.get('text'), /confirmar disponibilidade/i);
});

test('não permite solicitação de data passada ou inválida', () => {
  for (const date of ['2026-11-12', '2026-02-30', '2026-12-20', 'invalid']) {
    assert.throws(() => buildReservationLink({date, time:'12:00', partySize: 2, today:'2026-11-13'}), /data/i);
  }
});

test('não permite horário desconhecido ou quantidade de lugares inválida', () => {
  for (const partySize of [0, -1, 21, 1.5, '1x']) {
    assert.throws(() => buildReservationLink({date:'2026-11-14', time:'12:00', partySize, today:'2026-11-13'}), /pessoas/i);
  }
  assert.throws(() => buildReservationLink({date:'2026-11-14', time:'01:00', partySize: 2, today:'2026-11-13'}), /horário/i);
});

test('normaliza origem e impede inclusão de texto arbitrário no rastreamento', () => {
  assert.equal(normalizeOrigin('Parceiro_bairro-1'), 'PARCEIRO_BAIRRO-1');
  assert.equal(normalizeOrigin('PROMO\nMe marque'), 'SITE');
  assert.equal(normalizeOrigin(''), 'SITE');
  assert.equal(normalizeOrigin('a'.repeat(80)), 'SITE');
});

test('usa calendário de São Paulo sem depender da timezone do navegador', () => {
  assert.equal(todayInBrazil(new Date('2026-11-14T01:30:00Z')), '2026-11-13');
});

test('mede somente clique para consultar mesa, sem afirmar que houve reserva', () => {
  const events = [];
  const fbq = (...args) => events.push(args);
  assert.equal(trackContactClick(fbq), true);
  assert.deepEqual(events, [['track', 'Contact', {content_name: 'consulta_mesa_presencial'}]]);
  assert.equal(trackContactClick(undefined), false);
});
