import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentCredentialStatus, paymentConfigured, paymentReady } from '../src/asaas-environments.mjs';
import { handleAdmin } from '../src/management.mjs';
const token = 'sample-webhook-token-for-unit-testing';
const apiKey = 'sample-key-no-real-financial-access';
test('production webhook exists but API key is missing',()=>{
  const env={ASAAS_PRODUCTION_WEBHOOK_TOKEN:token};
  assert.deepEqual(paymentCredentialStatus(env,'production'),{apiKeyConfigured:false,webhookConfigured:true,configured:false});
  assert.equal(paymentConfigured(env,'production'),false);
});
test('status distinguishes missing webhook',()=>{
  assert.deepEqual(paymentCredentialStatus({ASAAS_PRODUCTION_API_KEY:apiKey},'production'),{apiKeyConfigured:true,webhookConfigured:false,configured:false});
});
test('readiness never exposes credential values or accepts placeholders',()=>{
  assert.equal(paymentCredentialStatus({ASAAS_PRODUCTION_API_KEY:'NAO_CONFIGURADA',ASAAS_PRODUCTION_WEBHOOK_TOKEN:token},'production').configured,false);
  const status=paymentCredentialStatus({ASAAS_PRODUCTION_API_KEY:apiKey,ASAAS_PRODUCTION_WEBHOOK_TOKEN:token},'production');
  assert.deepEqual(status,{apiKeyConfigured:true,webhookConfigured:true,configured:true});
  assert.ok(!JSON.stringify(status).includes(apiKey));
  assert.ok(!JSON.stringify(status).includes(token));
});
test('payment guard requires both credentials plus enabled Worker and DB',()=>{
  const base={DB:{},PAYMENTS_ENABLED:'true',ASAAS_PRODUCTION_WEBHOOK_TOKEN:token};
  assert.equal(paymentReady(base,'production'),false);
  assert.equal(paymentReady({...base,ASAAS_PRODUCTION_API_KEY:apiKey,PAYMENTS_ENABLED:'false'},'production'),false);
  assert.equal(paymentReady({...base,ASAAS_PRODUCTION_API_KEY:apiKey},'production'),true);
  assert.equal(paymentReady({...base,ASAAS_PRODUCTION_API_KEY:apiKey,DB:null},'production'),false);
});
test('sandbox cannot enable production credentials',()=>{
  const env={ASAAS_SANDBOX_API_KEY:apiKey,ASAAS_SANDBOX_WEBHOOK_TOKEN:token};
  assert.equal(paymentConfigured(env,'sandbox'),true);
  assert.equal(paymentConfigured(env,'production'),false);
});

test('owner status reports independent flags without revealing secrets',async()=>{
  const db={prepare(sql){return {
    bind(){return this;},
    async first(){if(sql.includes('FROM admin_sessions s'))return {username:'owner',role:'owner'};return {username:'owner'};},
    async all(){return {results:[]};},
  };}};
  const origin='https://restaurantekipeixe.com.br';
  const req=new Request('https://api.restaurantekipeixe.com.br/api/admin/settings',{
    headers:{Origin:origin,Cookie:'kipeixe_session='+'f'.repeat(64)},
  });
  const response=await handleAdmin(req,{DB:db,PAYMENTS_ENABLED:'true',ASAAS_PRODUCTION_WEBHOOK_TOKEN:token},origin,new URL(req.url));
  assert.equal(response.status,200);
  const body=await response.json();
  assert.deepEqual(body.asaasEnvironments.production,{apiKeyConfigured:false,webhookConfigured:true,configured:false});
  assert.equal(body.paymentSystemAvailable,true);
  assert.ok(!JSON.stringify(body).includes(token));
  assert.equal(response.headers.get('Cache-Control'),'no-store');
});
