export const DATE_START = '2026-11-13';
export const DATE_END = '2026-11-22';
export const SHIFTS = Object.freeze(['almoco', 'jantar']);
export const SOURCES = Object.freeze(['META_PEIXE', 'META_LAGO', 'META_VIDEO_REAL', 'META', 'INSTAGRAM', 'SITE', 'BAIRRO', 'PARCEIRO', 'WHATSAPP', 'OUTROS']);
export const STATUSES = Object.freeze(['CONSULTA', 'CONFIRMADA', 'COMPARECEU', 'FALTOU']);

export function validSource(source) {
  return SOURCES.includes(source) || (typeof source === 'string' && /^PARCEIRO_[A-Z0-9][A-Z0-9_-]{0,22}$/.test(source));
}

function validDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(`${date}T00:00:00Z`)) &&
    new Date(Date.parse(`${date}T00:00:00Z`)).toISOString().slice(0, 10) === date &&
    date >= DATE_START && date <= DATE_END;
}

function dateAndShift(value) {
  if (!validDate(value.date)) throw new Error('A data precisa estar entre 13 e 22/11/2026.');
  if (!SHIFTS.includes(value.shift)) throw new Error('Selecione almoço ou jantar.');
}

function money(value) {
  if (value === '' || value === null || value === undefined) return 0;
  const n=Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new Error('Valor monetário inválido.');
  return Math.round(n*100)/100;
}

export function validateReservation(value) {
  dateAndShift(value);
  if (!validSource(value.source)) throw new Error('Origem da reserva inválida.');
  if (!STATUSES.includes(value.status)) throw new Error('Situação inválida.');
  const partySize=Number(value.partySize);
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 20) throw new Error('Informe de 1 a 20 pessoas.');
  const revenue=money(value.revenue);
  if (value.status !== 'COMPARECEU' && revenue !== 0) throw new Error('Consumo só é registrado após o comparecimento.');
  return {date:value.date,shift:value.shift,source:value.source,partySize,status:value.status,revenue};
}

export function validateShift(value) {
  dateAndShift(value);
  const capacity=Number(value.capacity),peak=Number(value.peak);
  if (!Number.isInteger(capacity) || capacity < 0 || capacity > 1000) throw new Error('Capacidade inválida.');
  if (!Number.isInteger(peak) || peak < 0 || peak > capacity) throw new Error('Ocupação de pico deve ser menor ou igual à capacidade.');
  let spend;
  try { spend=money(value.spend); } catch { throw new Error('Gasto de mídia inválido.'); }
  return {date:value.date,shift:value.shift,capacity,peak,spend};
}

export function summarize(bookings,shiftLogs) {
  const sources=[...new Set([...SOURCES,...bookings.map(b=>b.source).filter(validSource)])];
  const bySource=Object.fromEntries(sources.map(x=>[x,{contacts:0,confirmedBookings:0,attendedBookings:0,attendedPeople:0,revenue:0,noShows:0}]));
  let confirmedBookings=0,attendedBookings=0,attendedPeople=0,noShows=0,revenue=0;
  for (const item of bookings) {
    const source=bySource[item.source];
    if (!source) continue;
    source.contacts++;
    if (item.status !== 'CONSULTA') {confirmedBookings++;source.confirmedBookings++;}
    if (item.status === 'COMPARECEU') {
      attendedBookings++;source.attendedBookings++;
      attendedPeople += item.partySize;source.attendedPeople += item.partySize;
      revenue += Number(item.revenue)||0;source.revenue += Number(item.revenue)||0;
    }
    if (item.status === 'FALTOU') {noShows++;source.noShows++;}
  }
  const validShifts=shiftLogs.filter(x=>Number.isFinite(x.capacity)&&x.capacity>=0);
  const totalSeats=validShifts.reduce((a,x)=>a+x.capacity,0);
  const totalPeak=validShifts.reduce((a,x)=>a+x.peak,0);
  const mediaSpend=validShifts.reduce((a,x)=>a+Number(x.spend||0),0);
  const attendedMeta=Object.entries(bySource).filter(([key])=>key==='META'||key.startsWith('META_')).reduce((sum,[,stats])=>sum+stats.attendedBookings,0);
  return {
    confirmedBookings,attendedBookings,attendedPeople,noShows,
    revenue:Math.round(revenue*100)/100,
    mediaSpend:Math.round(mediaSpend*100)/100,
    peakOccupancy:totalSeats>0?totalPeak/totalSeats:null,
    mediaCostPerAttendedBooking:attendedMeta>0?mediaSpend/attendedMeta:null,
    bySource
  };
}

function csvValue(v) {
  const s=String(v??'');
  if (/^[=+@\-\t\r]/.test(s)) return `"'${s.replace(/"/g,'""')}"`;
  return /[,"\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;
}

export function exportCSV(bookings,shifts) {
  const records=[['data','turno','origem','situacao','pessoas','consumo','capacidade','pico','gasto_midia']];
  for(const b of bookings) records.push([b.date,b.shift,b.source,b.status,b.partySize,b.revenue,'','','']);
  for(const s of shifts) records.push([s.date,s.shift,'FECHAMENTO','','','',s.capacity,s.peak,s.spend]);
  return '\ufeff'+records.map(row=>row.map(csvValue).join(',')).join('\r\n')+'\r\n';
}
