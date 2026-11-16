import json
from pathlib import Path
from playwright.sync_api import sync_playwright
import http.server,threading,os,tempfile

root=Path(__file__).resolve().parents[1]
os.chdir(root)
menu=json.loads((root/'menu-data.js').read_text(encoding='utf8').split('=',1)[1].strip().rstrip(';'))
categories=[dict(id=c['id'],title=c['title'],eyebrow=c['eyebrow'],active=1,sort_order=i) for i,c in enumerate(menu)]
products=[]
for cat in menu:
 for i,item in enumerate(cat['items']):
  products.append(dict(id=cat['id']+'-'+str(i),category_id=cat['id'],name=item['name'],description=item['description'],
    price_cents=round(item['price']*100) if item['price'] is not None else None,
    variants=[{'label':v['label'],'priceCents':round(v['price']*100)} for v in item['variants']],active=1,archived=0,sort_order=i))
seed_products=json.loads(json.dumps(products,ensure_ascii=False))
sent=[]
output_dir=Path(tempfile.gettempdir())/'kipeixe-catalog-tests'
output_dir.mkdir(parents=True,exist_ok=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Quiet)
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(channel='chrome',headless=True,args=['--no-sandbox'])
  for kind,width,height in [('desktop',1440,900),('mobile',390,844)]:
   products[:]=json.loads(json.dumps(seed_products,ensure_ascii=False))
   sent.clear()
   page=browser.new_page(viewport={'width':width,'height':height})
   errors=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   def mock(route):
    path=route.request.url.split('/api/',1)[1]
    if path.startswith('auth/session'):data={'authenticated':True,'username':'teste','role':'owner'}
    elif path.startswith('admin/orders'):data={'orders':[]}
    elif path.startswith('admin/catalog'):data={'categories':categories,'products':products}
    elif path.startswith('admin/products/bulk'):
     payload=route.request.post_data_json
     sent.append(payload)
     count=0
     for product in products:
      if product['id'] not in payload['ids']:continue
      action=payload['action']
      if action=='archive' and not product['archived']:
       product['archived']=1;product['active']=0;count+=1
      elif action=='restore' and product['archived']:
       product['archived']=0;product['active']=0;count+=1
      elif action=='activate' and not product['archived'] and not product['active']:
       product['active']=1;count+=1
      elif action=='deactivate' and not product['archived'] and product['active']:
       product['active']=0;count+=1
      elif action=='move':
       product['category_id']=payload['categoryId'];count+=1
      elif action=='adjust_price':
       if product['price_cents'] is not None:
        product['price_cents']=round(product['price_cents']*(1+payload['percentage']/100));count+=1
     data={'ok':True,'updated':count,'skipped':len(payload['ids'])-count}
    else: data={}
    route.fulfill(status=200,content_type='application/json',body=json.dumps(data,ensure_ascii=False))
   page.route('**/api/**',mock)
   page.goto(f'http://127.0.0.1:{server.server_port}/gestao.html',wait_until='domcontentloaded',timeout=30000)
   page.locator('[data-tab="products"]').click()
   page.locator('#catalog-count-all').wait_for(state='visible')
   page.wait_for_function('document.querySelector("#catalog-count-all").textContent === "109"')
   assert page.locator('#products-list tr').count()==25
   assert page.locator('#catalog-count-active').inner_text()=='109'
   page.screenshot(path=str(output_dir/('catalog-initial-'+kind+'.png')))
   page.locator('#catalog-select-filtered').click()
   assert '109 produtos' in page.locator('#bulk-selected-count').inner_text()
   page.locator('#bulk-action').select_option('archive')
   page.locator('#bulk-review').click()
   page.locator('#catalog-bulk-modal').wait_for(state='visible')
   assert page.locator('#catalog-bulk-apply').is_disabled()
   page.locator('#catalog-bulk-phrase').fill('ARQUIVAR')
   page.locator('#catalog-bulk-apply').click()
   page.wait_for_function('document.querySelector("#catalog-count-archived").textContent === "109"')
   assert sent[-1]['action']=='archive' and len(sent[-1]['ids'])==109
   page.locator('[data-catalog-view="archived"]').click()
   assert page.locator('#products-list tr').count()==25
   page.locator('#catalog-select-filtered').click()
   page.locator('#bulk-action').select_option('restore')
   page.locator('#bulk-review').click()
   page.locator('#catalog-bulk-apply').click()
   page.wait_for_function('document.querySelector("#catalog-count-inactive").textContent === "109"')
   page.locator('[data-catalog-view="inactive"]').click()
   page.locator('#catalog-select-filtered').click()
   page.locator('#bulk-action').select_option('activate')
   page.locator('#bulk-review').click()
   page.locator('#catalog-bulk-apply').click()
   page.wait_for_function('document.querySelector("#catalog-count-active").textContent === "109"')
   page.locator('[data-catalog-view="all"]').click()
   page.locator('#product-category-filter').select_option('peixes')
   page.locator('#catalog-select-filtered').click()
   assert '12 produtos' in page.locator('#bulk-selected-count').inner_text()
   page.locator('#bulk-action').select_option('move')
   page.locator('#bulk-category').select_option('porcoes')
   page.locator('#bulk-review').click()
   page.locator('#catalog-bulk-apply').click()
   page.wait_for_function('document.querySelector("#catalog-bulk-bar").hidden')
   assert sent[-1]['action']=='move' and len(sent[-1]['ids'])==12
   page.locator('#product-category-filter').select_option('')
   page.locator('#product-search').fill('Tilápia')
   page.locator('#catalog-select-filtered').click()
   page.locator('#bulk-action').select_option('adjust_price')
   page.locator('#bulk-price-value').fill('10')
   page.locator('#bulk-review').click()
   page.locator('#catalog-bulk-apply').click()
   page.wait_for_function('document.querySelector("#catalog-bulk-bar").hidden')
   assert sent[-1]['action']=='adjust_price'
   assert sent[-1]['mode']=='percent' and sent[-1]['percentage']==10
   page.locator('#product-search').fill('')
   page.locator('#products-list [data-edit-product]').first.click()
   assert page.locator('#product-editor').is_visible()
   page.locator('#close-editor').click()
   assert page.locator('#product-editor').is_hidden()
   assert not errors,errors
   out=output_dir/('catalog-admin-'+kind+'.png')
   page.screenshot(path=str(out),full_page=False)
   print(kind,'PASS 109 products, select-all filtered, bulk archive->restore->activate, move, price adjustment, editor drawer; no JS errors',out,flush=True)
   page.close()
  browser.close()
finally:server.shutdown()
