import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE_NAMES, emptyAppearance, validateAppearance, makeAppearanceCss, isSafeElementSelector } from '../../appearance-config.mjs';
import { getAppearance, saveAppearance } from '../src/appearance.mjs';
import { handleAdmin } from '../src/management.mjs';

const origin='https://restaurantekipeixe.com.br';
const endpoint='https://api.restaurantekipeixe.com.br';
const cookie='kipeixe_session='+'f'.repeat(64);
const validSelector='div:nth-of-type(1) > button:nth-of-type(2)';
function mockDb(role='owner') {
  const storage=new Map();
  return {
    storage,
    prepare(sql) {
      let args=[];
      return {
        bind(...values) {args=values;return this;},
        async first() {
          if (sql.includes('FROM admin_users WHERE role')) return {username:'owner'};
          if (sql.includes('FROM admin_sessions s')) return {username:role==='owner'?'owner':'staff',role};
          if (sql.includes('FROM store_settings WHERE key')) return storage.has(args[0])?{value:storage.get(args[0])}:null;
          throw Error('Unexpected SQL query: '+sql);
        },
        async run() {
          if (sql.startsWith('INSERT INTO store_settings')) storage.set(args[0],args[1]);
          else if (!sql.startsWith('INSERT INTO audit_log')) throw Error('Unexpected SQL: '+sql);
          return {success:true};
        },
      };
    },
  };
}
function req(path,method='GET',authenticated=false,body) {
  return new Request(endpoint+path,{method,headers:{Origin:origin,...(authenticated?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
}
function act(db,request) {return handleAdmin(request,{DB:db},origin,new URL(request.url));}

test('validates 5 independent pages and global palette',()=>{
  const theme=emptyAppearance();
  for(const page of Object.keys(PAGE_NAMES)) theme.pages[page]={accent:'#112233'};
  theme.pages.cardapio.accent='#ff2200';
  theme.global.header='#aabbcc';
  theme.elements.ambiente=[{selector:validSelector,colors:{backgroundColor:'#eeeeee',color:'#222222'}}];
  const normalized=validateAppearance(theme);
  assert.equal(normalized.pages.inicio.accent,'#112233');
  assert.equal(normalized.pages.cardapio.accent,'#ff2200');
  assert.match(makeAppearanceCss(normalized),/\[data-page="cardapio"\]/);
  assert.match(makeAppearanceCss(normalized),/background-color:#eeeeee!important/);
  assert.match(makeAppearanceCss(normalized),/--theme-header:#aabbcc/);
});

test('rejects CSS injection and unknown elements, invalid hex and page overrides',()=>{
  assert.equal(isSafeElementSelector(validSelector),true);
  assert.equal(isSafeElementSelector('body { color:red; }'),false);
  for(const bad of ['red','transparent','#fff','#123456;display:none','url(https://evil)']) {
    assert.throws(()=>validateAppearance({version:1,global:{header:bad}}));
  }
  assert.throws(()=>validateAppearance({version:1,pages:{unknown:{accent:'#ff0000'}}}));
  assert.throws(()=>validateAppearance({version:1,elements:{inicio:[{selector:'div:hover',colors:{color:'#000000'}}]}}));
  assert.throws(()=>validateAppearance({version:1,elements:{inicio:Array.from({length:81},(_,i)=>({selector:`div:nth-of-type(${i+1})`,colors:{color:'#000000'}}))}}));
});

test('public theme storage restores exact saved colors',async()=>{
  const db=mockDb();const input=emptyAppearance();input.pages.pesque={background:'#335577',accent:'#aabbcc'};
  assert.deepEqual(await getAppearance({DB:db}),emptyAppearance());
  await saveAppearance({DB:db},input);
  const loaded=await getAppearance({DB:db});
  assert.equal(loaded.pages.pesque.background,'#335577');
  assert.equal(loaded.pages.pesque.accent,'#aabbcc');
});

test('owner can publish colors, staff forbidden, anonymous rejected',async()=>{
  const theme=emptyAppearance();theme.pages.inicio={text:'#123456'};
  const owner=mockDb();
  const unauthorized=await act(owner,req('/api/admin/appearance','GET'));
  assert.equal(unauthorized.status,401);
  const staff=await act(mockDb('staff'),req('/api/admin/appearance','PUT',true,theme));
  assert.equal(staff.status,403);
  const saved=await act(owner,req('/api/admin/appearance','PUT',true,theme));
  assert.equal(saved.status,200,await saved.text());
  assert.equal(owner.storage.has('appearance_v1'),true);
  const read=await act(owner,req('/api/admin/appearance','GET',true));
  assert.equal(read.status,200);
  assert.equal((await read.json()).pages.inicio.text,'#123456');
});
