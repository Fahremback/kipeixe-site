"""Verify the Ambiente gallery stays gap-free and fully pictured at responsive widths."""
from pathlib import Path
import os
import tempfile
import threading
import http.server
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
os.chdir(ROOT)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Quiet)
threading.Thread(target=server.serve_forever,daemon=True).start()
base=f'http://127.0.0.1:{server.server_port}/index.html#ambiente'
preview=Path(tempfile.gettempdir()) / 'kipeixe-gallery-previews'
preview.mkdir(parents=True,exist_ok=True)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(channel='chrome',headless=True,args=['--no-sandbox'])
  for label,width,height in [
   ('desktop',1440,900),
   ('laptop',1024,768),
   ('tablet',760,1024),
   ('mobile',390,844),
   ('smallmobile',320,720),
  ]:
   page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
   errors=[]
   page.on('pageerror',lambda exc:errors.append(str(exc)))
   page.goto(base,wait_until='domcontentloaded',timeout=30000)
   page.wait_for_function("!document.documentElement.hasAttribute('data-appearance-loading')",timeout=11000)
   page.wait_for_function("getComputedStyle(document.querySelector('.ambient-page')).display !== 'none'",timeout=12000)
   gallery=page.locator('.photo-grid')
   gallery.scroll_into_view_if_needed()
   page.locator('.photo-grid img').evaluate_all('(els)=>els.forEach(img => img.loading = "eager")')
   page.wait_for_function("Array.from(document.querySelectorAll('.photo-grid img')).every(img => img.complete && img.naturalWidth > 0)",timeout=15000)
   details=gallery.evaluate("""(grid) => {
     const style=getComputedStyle(grid),box=grid.getBoundingClientRect();
     const figures=[...grid.querySelectorAll('figure')];
     const boxes=figures.map(e=>e.getBoundingClientRect());
     const cols=style.gridTemplateColumns.split(' ').map(parseFloat);
     const rows=style.gridTemplateRows.split(' ').map(parseFloat);
     const gapX=parseFloat(style.columnGap),gapY=parseFloat(style.rowGap);
     let missing=[],cy=box.top;
     for(let y=0;y<rows.length;y++){
       let cx=box.left;
       for(let x=0;x<cols.length;x++){
         const px=cx+cols[x]/2,py=cy+rows[y]/2;
         if(!boxes.some(r=>px >= r.left && px <= r.right && py >= r.top && py <= r.bottom)) {
           missing.push({col:x,row:y,px,py});
         }
         cx+=cols[x]+gapX;
       }
       cy+=rows[y]+gapY;
     }
     return {columns:cols.length,rows:rows.length,missing,
       figureCount:figures.length,photoCount:figures.filter(e=>e.querySelector('img')).length,
       rects:boxes.map(e=>({x:e.x,y:e.y,width:e.width,height:e.height})),
       viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,
       imageErrors:[...grid.querySelectorAll('img')].filter(e=>!e.complete||!e.naturalWidth).map(e=>e.src)
     };
   }""")
   assert details['figureCount']==6,details
   assert details['photoCount']==6,details
   assert not details['imageErrors'],details
   assert not details['missing'],details
   assert details['columns'] == (2 if width <= 760 else 6),details
   assert details['documentWidth']<=width+1,details
   assert not errors,errors
   gallery.screenshot(path=str(preview/f'ambiente-mosaic-{label}.png'),timeout=10000)
   print(label,'PASS',width, f"{details['columns']}x{details['rows']} grid", 'no empty cells / missing photos / overflow',flush=True)
   page.close()
  browser.close()
finally:
 server.shutdown()
