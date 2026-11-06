const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_HOURS, isOpenAt, toInputValue, validateSchedule } = require('../store-hours.js');

test('opção Agora só funciona entre abertura e fechamento, horário de Foz', () => {
  assert.equal(isOpenAt(DEFAULT_HOURS, new Date('2026-11-06T11:59:00Z')), false); // 08:59
  assert.equal(isOpenAt(DEFAULT_HOURS, new Date('2026-11-06T12:00:00Z')), true); // 09:00
  assert.equal(isOpenAt(DEFAULT_HOURS, new Date('2026-11-07T02:39:00Z')), true); // 23:39
  assert.equal(isOpenAt(DEFAULT_HOURS, new Date('2026-11-07T02:40:00Z')), false); // 23:40
});

test('dia fechado no painel bloqueia o pedido imediato', () => {
  const hours = { ...DEFAULT_HOURS, '0': null };
  assert.equal(isOpenAt(hours, new Date('2026-11-08T15:00:00Z')), false);
  assert.equal(isOpenAt(hours, new Date('2026-11-09T15:00:00Z')), true);
});

test('hora agendada é verificada antes do envio', () => {
  const now = new Date('2026-11-06T11:00:00Z'); // 08:00 Foz
  assert.equal(validateSchedule(DEFAULT_HOURS, '2026-11-06T12:00', now).valid, true);
  assert.match(validateSchedule(DEFAULT_HOURS, '2026-11-06T08:05', now).message, /15 minutos/);
  assert.match(validateSchedule(DEFAULT_HOURS, '2026-11-06T08:45', now).message, /fechado/);
  assert.match(validateSchedule(DEFAULT_HOURS, '2026-11-06T23:40', now).message, /fechado/);
  assert.match(validateSchedule(DEFAULT_HOURS, '2026-11-30T12:00', now).message, /7 dias/);
  assert.equal(toInputValue(new Date('2026-11-06T15:30:00Z')), '2026-11-06T12:30');
});
