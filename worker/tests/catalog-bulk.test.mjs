import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { handleAdmin } from '../src/management.mjs';

const ORIGIN='https://restaurantekipeixe.com.br';
const TOKEN='b'.repeat(64);
function fixture() {
 const sql=new DatabaseSync(':memory:');
 sql.exec([
  'CREATE TABLE admin_users(username TEXT PRIMARY KEY, role TEXT, active INTEGER);',
  'CREATE TABLE admin_sessions(token_hash TEXT PRIMARY KEY, username TEXT, expires_at INTEGER, created_at INTEGER);',
  'CREATE TABLE audit_log(id INTEGER PRIMARY KEY, actor TEXT, action TEXT, subject TEXT, details TEXT);',
  'CREATE TABLE categories(id TEXT PRIMARY KEY,title TEXT);',
  'CREATE TABLE products(id TEXT PRIMARY KEY,category_id TEXT,name TEXT,description TEXT DEFAULT "",price_cents INTEGER,variants_json TEXT DEFAULT "[]",active INTEGER DEFAULT 1,archived INTEGER DEFAULT 0,sort_order INTEGER DEFAULT 0,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);',
 ].join('\n'));
 sql.prepare('INSERT INTO admin_users VALUES (?,?,?)').run('operator','staff',1);
 sql.prepare('INSERT INTO admin_sessions VALUES (?,?,?,?)').run(createHash('sha256').update(TOKEN).digest('hex'),'operator',Date.now()+100000,Date.now());
 for(const category of ['peixes','porcoes']) sql.prepare('INSERT INTO categories VALUES (?,?)').run(category,category);
 const add=(id,price,variants=[])=>sql.prepare('INSERT INTO products(id,category_id,name,price_cents,variants_json) VALUES (?,?,?,?,?)')
  .run(id,'peixes',id,price,JSON.stringify(variants));
 add('fish-1',10000); add('fish-2',null,[{label:'Grande',priceCents:15000},{label:'Pequena',priceCents:8000}]);
 add('fish-3',null); add('fish-4',500);
 function statement(query, params=[]) {
  return {
   bind(...values){return statement(query,values);},
   first:async()=>sql.prepare(query).get(...params)||null,
   all:async()=>({results:sql.prepare(query).all(...params)}),
   run:async()=>({meta:{changes:sql.prepare(query).run(...params).changes}}),
  };
 }
 const env={DB:{
  prepare:statement,
  async batch(items){
   sql.exec('BEGIN');
   try {const result=[];for(const i of items)result.push(await i.run());sql.exec('COMMIT');return result;}
   catch(e){sql.exec('ROLLBACK');throw e;}
  },
 }};
 async function call(action,ids,extra={},auth=true){
  const url=new URL('https://api.restaurantekipeixe.com.br/api/admin/products/bulk');
  const r=await handleAdmin(new Request(url,{
   method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',
    ...(auth?{Cookie:'kipeixe_session='+TOKEN}:{})},
   body:JSON.stringify({action,ids,...extra}),
  }),env,ORIGIN,url);
  return {status:r.status,...await r.json()};
 }
 const get=id=>sql.prepare('SELECT * FROM products WHERE id=?').get(id);
 return {sql,call,get};
}
test('archive/restore/activate/deactivate preserve reversibility and audit',async()=>{
 const {sql,call,get}=fixture();
 assert.equal((await call('archive',['fish-1'],{},false)).status,401);
 assert.equal((await call('archive',['fish-1','fish-1'])).status,422);
 assert.equal((await call('archive',['fish-1','missing'])).status,409);
 assert.equal(get('fish-1').archived,0);
 assert.equal((await call('archive',['fish-1','fish-2','fish-3'])).updated,3);
 assert.equal(get('fish-1').archived,1);
 assert.equal(get('fish-1').active,0);
 assert.equal((await call('archive',['fish-1'])).skipped,1);
 assert.equal((await call('activate',['fish-1'])).skipped,1);
 assert.equal((await call('restore',['fish-1','fish-2','fish-3'])).updated,3);
 assert.equal(get('fish-1').archived,0);
 assert.equal(get('fish-1').active,0);
 assert.equal((await call('activate',['fish-1'])).updated,1);
 assert.equal(get('fish-1').active,1);
 assert.equal((await call('deactivate',['fish-1'])).updated,1);
 assert.equal(get('fish-1').active,0);
 assert.ok(sql.prepare("SELECT count(*) as n FROM audit_log WHERE action LIKE 'PRODUCT_BULK_%'").get().n>=6);
 assert.deepEqual(JSON.parse(sql.prepare("SELECT details FROM audit_log WHERE action='PRODUCT_BULK_ARCHIVE' ORDER BY id LIMIT 1").get().details).changedIds, ['fish-1','fish-2','fish-3']);
 sql.close();
});
test('move and change base/variant prices atomically',async()=>{
 const {sql,call,get}=fixture();
 assert.equal((await call('move',['fish-1'],{categoryId:'missing'})).status,422);
 assert.equal((await call('move',['fish-1','fish-2'],{categoryId:'porcoes'})).updated,2);
 assert.equal(get('fish-2').category_id,'porcoes');
 assert.equal((await call('move',['fish-1','fish-2'],{categoryId:'porcoes'})).skipped,2);
 const r=await call('adjust_price',['fish-1','fish-2','fish-3'],{mode:'percent',percentage:10});
 assert.equal(r.updated,2);
 assert.equal(r.skipped,1);
 assert.equal(get('fish-1').price_cents,11000);
 assert.deepEqual(JSON.parse(get('fish-2').variants_json).map(v=>v.priceCents),[16500,8800]);
 assert.equal((await call('adjust_price',['fish-1','fish-2'],{mode:'amount',amountCents:-150})).updated,2);
 assert.equal(get('fish-1').price_cents,10850);
 assert.deepEqual(JSON.parse(get('fish-2').variants_json).map(v=>v.priceCents),[16350,8650]);
 sql.close();
});
test('invalid batch does not partially change any product',async()=>{
 const {sql,call,get}=fixture();
 assert.equal((await call('adjust_price',['fish-1','fish-4'],{mode:'amount',amountCents:-450})).status,422);
 assert.equal(get('fish-1').price_cents,10000);
 assert.equal(get('fish-4').price_cents,500);
 assert.equal((await call('adjust_price',['fish-1'],{mode:'percent',percentage:-99})).status,422);
 assert.equal((await call('adjust_price',['fish-1'],{mode:'percent',percentage:'5'})).status,422);
 assert.equal((await call('adjust_price',['fish-1'],{mode:'amount',amountCents:1.5})).status,422);
 assert.equal((await call('archive',Array.from({length:251},(_,i)=>'p-'+i))).status,422);
 assert.equal(sql.prepare('SELECT count(*) n FROM audit_log').get().n,0);
 sql.close();
});
