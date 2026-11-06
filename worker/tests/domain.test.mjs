import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_HOURS, openAt, validateFulfillment, acceptanceDeadline, nextStatus, validateHours,
} from '../src/domain.mjs';

test('horários respeitam Foz do Iguaçu', () => {
  assert.equal(openAt(new Date('2026-11-06T13:00:00Z'), DEFAULT_HOURS), true); // 10h
  assert.equal(openAt(new Date('2026-11-06T11:00:00Z'), DEFAULT_HOURS), false); // 08h
  assert.equal(openAt(new Date('2026-11-07T02:41:00Z'), DEFAULT_HOURS), false); // 23h41
});

test('pedido imediato apenas quando aberto', () => {
  assert.equal(validateFulfillment('immediate', null, DEFAULT_HOURS, new Date('2026-11-06T13:00:00Z')), null);
  assert.throws(() => validateFulfillment('immediate', null, DEFAULT_HOURS, new Date('2026-11-06T11:00:00Z')), /fechado/);
});

test('agendamento aceita futuro aberto, recusa passado e fechado', () => {
  const now = new Date('2026-11-06T11:00:00Z'); // 08h em Foz
  assert.equal(validateFulfillment('scheduled', '2026-11-06T15:00:00.000Z', DEFAULT_HOURS, now),
    '2026-11-06T15:00:00.000Z');
  assert.throws(() => validateFulfillment('scheduled', '2026-11-06T11:10:00Z', DEFAULT_HOURS, now), /15 minutos/);
  assert.throws(() => validateFulfillment('scheduled', '2026-11-06T11:30:00Z', DEFAULT_HOURS, now), /fora do funcionamento/);
});

test('prazo é 30 minutos apenas nos imediatos', () => {
  assert.equal(acceptanceDeadline('2026-11-06T13:00:00.000Z'), '2026-11-06T13:30:00.000Z');
  assert.equal(acceptanceDeadline('2026-11-06T13:00:00.000Z', '2026-11-07T16:00:00.000Z'),
    '2026-11-07T16:00:00.000Z');
});

test('estado não permite pular etapas', () => {
  assert.equal(nextStatus('AWAITING_ACCEPTANCE', 'ACCEPT'), 'PREPARING');
  assert.equal(nextStatus('SCHEDULED', 'REJECT'), 'REJECTED');
  assert.equal(nextStatus('PREPARING', 'READY'), 'READY');
  assert.equal(nextStatus('READY', 'COMPLETE'), 'COMPLETED');
  assert.throws(() => nextStatus('COMPLETED', 'REJECT'), /não permitida/);
  assert.throws(() => nextStatus('AWAITING_PAYMENT', 'ACCEPT'), /não permitida/);
});

test('fechamento semanal pode desabilitar dias', () => {
  const hours = { ...DEFAULT_HOURS, '0': null };
  const result = validateHours(hours);
  assert.equal(openAt(new Date('2026-11-08T15:00:00Z'), result), false);
  assert.throws(() => validateHours({ ...hours, '1': { open: '20:00', close: '09:00' } }), /válidos/);
});
