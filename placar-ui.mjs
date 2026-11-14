import {SOURCES,STATUSES,validateReservation,validateShift,summarize,exportCSV,DATE_START,DATE_END} from './placar-data.mjs?v=20261113-instant-reply';

const KEY='kipeixe.placar-presencial.2026-11.v1';
const sourceNames={META_PEIXE:'Meta • anúncio peixe',META_LAGO:'Meta • anúncio lago',META_VIDEO_REAL:'Meta • vídeo real',META_VIDEO_PEIXE:'Meta • Reel pago peixe',META_VIDEO_AMBIENTE:'Meta • Reel pago lago',META:'Meta • outros',IG_REEL_PEIXE:'Reel orgânico • peixe',IG_REEL_AMBIENTE:'Reel orgânico • lago',FB_STORY_PEIXE:'Story Facebook • peixe',FB_STORY_LAGO:'Story Facebook • lago',IG_FEED_PEIXE:'Feed orgânico • peixe',IG_FEED_LAGO:'Feed orgânico • lago',SOCIAL_DIRECT:'Direct • palavras-chave',SOCIAL_INSTANTANEA:'Direct • primeira mensagem',INSTAGRAM:'Instagram • outros',SITE:'Site do Kipeixe',BAIRRO:'Cartaz/QR bairro',PARCEIRO:'Parceiro local',WHATSAPP:'WhatsApp direto',OUTROS:'Outros'};
const sourceLabel=(source)=>sourceNames[source]??(source.startsWith('PARCEIRO_')?'Parceiro • '+source.slice(9):source);
const statusNames={CONSULTA:'Consulta',CONFIRMADA:'Confirmada',COMPARECEU:'Compareceu',FALTOU:'Não compareceu'};

const $=(id)=>document.getElementById(id);
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n||0);
const rate=n=>n===null?'—':`${(n*100).toFixed(1).replace('.',',')}%`;
const day=d=>d.slice(8)+'/'+d.slice(5,7);

function readState(){
  try {
    const value=JSON.parse(localStorage.getItem(KEY)||'{}');
    return {
      bookings:Array.isArray(value.bookings)?value.bookings.filter(b=>{try{validateReservation(b);return true}catch{return false}}):[],
      shifts:Array.isArray(value.shifts)?value.shifts.filter(s=>{try{validateShift(s);return true}catch{return false}}):[]
    };
  }catch{return {bookings:[],shifts:[]}}
}
const state=readState();
function save(){localStorage.setItem(KEY,JSON.stringify(state));render()}
function status(msg){$('app-status').textContent=msg}

function cell(row,text,tag='td'){
  const el=document.createElement(tag);el.textContent=String(text);row.append(el);return el;
}
function render(){
  const s=summarize(state.bookings,state.shifts);
  $('confirmed-count').textContent=s.confirmedBookings;
  $('attended-count').textContent=s.attendedBookings;
  $('people-count').textContent=s.attendedPeople;
  $('occupancy-count').textContent=rate(s.peakOccupancy);
  $('revenue-count').textContent=money(s.revenue);
  $('cost-count').textContent=s.mediaCostPerAttendedBooking===null?'—':money(s.mediaCostPerAttendedBooking);

  const sources=$('sources-body');sources.replaceChildren();
  for(const key of Object.keys(s.bySource)){
    const row=document.createElement('tr'),data=s.bySource[key];
    [sourceLabel(key),data.contacts,data.confirmedBookings,data.attendedBookings,data.attendedPeople,money(data.revenue)].forEach(val=>cell(row,val));
    sources.append(row);
  }

  const rows=$('bookings-body');rows.replaceChildren();
  $('empty-records').hidden=state.bookings.length>0;
  for(const entry of [...state.bookings].sort((a,b)=>b.date.localeCompare(a.date))){
    const row=document.createElement('tr');
    [day(entry.date),entry.shift==='almoco'?'Almoço':'Jantar',sourceLabel(entry.source),entry.partySize].forEach(x=>cell(row,x));
    const select=document.createElement('select');select.setAttribute('aria-label','Situação');
    for(const k of STATUSES){const opt=new Option(statusNames[k],k);select.add(opt)}select.value=entry.status;
    cell(row,'').append(select);
    const revenue=document.createElement('input');revenue.type='number';revenue.min='0';revenue.step='.01';revenue.value=entry.revenue;
    revenue.setAttribute('aria-label','Consumo em reais');cell(row,'').append(revenue);
    const buttons=cell(row,'');
    const update=document.createElement('button');update.textContent='Salvar';update.className='secondary';
    update.addEventListener('click',()=>{
      try{const next=validateReservation({...entry,status:select.value,revenue:revenue.value});Object.assign(entry,next);save();status('Mesa atualizada.');}
      catch(e){status(e.message)}
    });buttons.append(update);
    const remove=document.createElement('button');remove.textContent='Excluir';remove.className='danger';
    remove.addEventListener('click',()=>{if(!window.confirm('Excluir este lançamento?'))return;state.bookings.splice(state.bookings.indexOf(entry),1);save();status('Lançamento excluído.')});buttons.append(remove);
    rows.append(row);
  }

  const shifts=$('shifts-body');shifts.replaceChildren();
  for(const x of [...state.shifts].sort((a,b)=>b.date.localeCompare(a.date))){
    const row=document.createElement('tr'),r=x.capacity>0?x.peak/x.capacity:null;
    [day(x.date),x.shift==='almoco'?'Almoço':'Jantar',`${x.peak} / ${x.capacity}`,rate(r),money(x.spend)].forEach(y=>cell(row,y));
    shifts.append(row);
  }
}

const today='2026-11-13';
for(const form of [$('booking-form'),$('shift-form')])form.elements.date.value=today;

$('booking-form').addEventListener('submit',(ev)=>{
  ev.preventDefault();
  const data=Object.fromEntries(new FormData(ev.currentTarget));
  if(data.source==='PARCEIRO' && data.partnerCode?.trim()){
    const code=data.partnerCode.trim().toUpperCase();
    data.source=code.startsWith('PARCEIRO_')?code:'PARCEIRO_'+code;
  }
  try{const entry=validateReservation(data);state.bookings.push({...entry,id:crypto.randomUUID()});save();status('Mesa registrada.');}
  catch(e){status(e.message)}
});

$('shift-form').addEventListener('submit',(ev)=>{
  ev.preventDefault();
  const data=Object.fromEntries(new FormData(ev.currentTarget));
  try{
    const log=validateShift(data);
    const previous=state.shifts.findIndex(x=>x.date===log.date&&x.shift===log.shift);
    if(previous>=0)state.shifts[previous]=log;else state.shifts.push(log);
    save();status('Fechamento do turno salvo.');
  }catch(e){status(e.message)}
});

$('clear-button').addEventListener('click',()=>{
  if(!window.confirm('APAGAR todos os registros deste navegador? Faça a exportação CSV antes.'))return;
  state.bookings.length=0;state.shifts.length=0;save();status('Registros apagados deste navegador.');
});

$('export-button').addEventListener('click',()=>{
  const blob=new Blob([exportCSV(state.bookings,state.shifts)],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='kipeixe-placar-13-a-22-nov-2026.csv';document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);status('CSV exportado. Guarde o arquivo com a equipe.');
});

render();
