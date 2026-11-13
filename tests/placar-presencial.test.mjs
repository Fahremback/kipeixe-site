import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReservation,validateShift,summarize,exportCSV,DATE_START,DATE_END} from '../placar-data.mjs';

const booking=(overrides={})=>({date:'2026-11-14',shift:'almoco',source:'META_PEIXE',partySize:3,status:'CONFIRMADA',revenue:0,...overrides});

test('permite reservas apenas nos dez dias da campanha e valida participantes',()=>{
  assert.equal(validateReservation(booking()).partySize,3);
  assert.equal(DATE_START,'2026-11-13');
  assert.equal(DATE_END,'2026-11-22');
  for(const date of ['2026-11-12','2026-11-23','2026-02-30','texto']) assert.throws(()=>validateReservation(booking({date})),/data/i);
  for(const partySize of [0,21,2.5,'0','1x']) assert.throws(()=>validateReservation(booking({partySize})),/pessoas/i);
  assert.throws(()=>validateReservation(booking({source:'=HYPERLINK("http://x")'})),/origem/i);
  assert.throws(()=>validateReservation(booking({status:'PAGA'})),/situação/i);
  assert.throws(()=>validateReservation(booking({revenue:50})),/consumo/i);
});

test('turno não aceita pico acima de capacidade nem gasto negativo',()=>{
  assert.deepEqual(validateShift({date:'2026-11-14',shift:'jantar',capacity:100,peak:85,spend:15}),{date:'2026-11-14',shift:'jantar',capacity:100,peak:85,spend:15});
  assert.throws(()=>validateShift({date:'2026-11-14',shift:'jantar',capacity:50,peak:51,spend:0}),/ocupação/i);
  assert.throws(()=>validateShift({date:'2026-11-14',shift:'jantar',capacity:50,peak:40,spend:-5}),/mídia/i);
});

test('reserva não é cliente: separa confirmação, falta e comparecimento real',()=>{
  const bookings=[booking({status:'CONSULTA'}),booking(),booking({status:'COMPARECEU',partySize:4,revenue:160}),booking({status:'FALTOU',partySize:2,source:'META_LAGO'}),booking({source:'INSTAGRAM',status:'COMPARECEU',partySize:2,revenue:80})];
  const shifts=[{date:'2026-11-14',shift:'almoco',capacity:20,peak:17,spend:15}];
  const result=summarize(bookings,shifts);
  assert.equal(result.confirmedBookings,4);
  assert.equal(result.attendedBookings,2);
  assert.equal(result.attendedPeople,6);
  assert.equal(result.noShows,1);
  assert.equal(result.revenue,240);
  assert.equal(result.peakOccupancy,0.85);
  assert.equal(result.mediaSpend,15);
  assert.equal(result.mediaCostPerAttendedBooking,15);
  assert.equal(result.bySource.META_PEIXE.attendedBookings,1);
  assert.equal(result.bySource.META_LAGO.attendedBookings,0);
});

test('sem comparecimento não existe custo por mesa e sem fechamento não existe ocupação',()=>{
  const result=summarize([booking()],[]);
  assert.equal(result.peakOccupancy,null);
  assert.equal(result.mediaCostPerAttendedBooking,null);
  assert.equal(result.attendedPeople,0);
});

test('atribui ao Meta também o novo criativo de vídeo real',()=>{
  const result=summarize([booking({source:'META_VIDEO_REAL',status:'COMPARECEU',partySize:5,revenue:200})],[{date:'2026-11-14',shift:'almoco',capacity:30,peak:20,spend:12}]);
  assert.equal(result.bySource.META_VIDEO_REAL.attendedBookings,1);
  assert.equal(result.mediaCostPerAttendedBooking,12);
});

test('contabiliza indicações separadas de parceiros locais com códigos seguros',()=>{
  const entries=[
    validateReservation(booking({source:'PARCEIRO_RHINO',status:'COMPARECEU',revenue:135})),
    validateReservation(booking({source:'PARCEIRO_BRUNABOSCO',status:'CONFIRMADA'})),
    validateReservation(booking({source:'PARCEIRO_BRUNABOSCO',status:'COMPARECEU',partySize:2,revenue:80}))
  ];
  const result=summarize(entries,[]);
  assert.equal(result.bySource.PARCEIRO_RHINO.attendedBookings,1);
  assert.equal(result.bySource.PARCEIRO_RHINO.revenue,135);
  assert.equal(result.bySource.PARCEIRO_BRUNABOSCO.attendedPeople,2);
  assert.equal(result.bySource.PARCEIRO_BRUNABOSCO.confirmedBookings,2);
  assert.match(exportCSV(entries,[]),/PARCEIRO_BRUNABOSCO/);
  for (const source of ['PARCEIRO_', 'PARCEIRO_!', '=HYPERLINK()', 'PARCEIRO_A'.repeat(20)]) {
    assert.throws(()=>validateReservation(booking({source})),/origem/i);
  }
});

test('CSV traz apenas agregados, escapa valores e não inventa clientes',()=>{
  const csv=exportCSV([booking({status:'COMPARECEU',revenue:123.45})],[]);
  assert.match(csv,/data,turno,origem,situacao,pessoas,consumo/);
  assert.match(csv,/META_PEIXE/);
  assert.match(csv,/123\.45/);
  assert.doesNotMatch(csv,/nome|telefone/i);
});
