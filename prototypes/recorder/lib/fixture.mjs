// The local fixture: one page with every case the brief names, an edge page
// for the gate probes, and a large page for lag numbers.
import http from "node:http";

const MAIN = `<!doctype html><title>Recorder fixture</title>
<style>
 body{font:14px system-ui;margin:12px} section{margin:8px 0;padding:6px;border:1px solid #ccc}
 #toast{position:fixed;right:12px;top:12px;background:#333;color:#fff;padding:8px}
 .cart{display:inline-block;width:32px;height:24px;background:#fc6;cursor:default}
 iframe{width:320px;height:60px;border:3px solid #88c;padding:5px}
</style>
<main>
 <h1>Recorder fixture</h1>

 <section aria-label="Late data">
  <button id="load">Load orders</button>
  <span id="loadStatus"></span>
  <table aria-label="Orders"><tbody id="orders"><tr><td>Order 1</td></tr></tbody></table>
 </section>

 <section aria-label="Lookalike rows">
  <button id="insertNow">Insert task</button>
  <button id="insertLater">Insert task later</button>
  <ul id="tasks" aria-label="Tasks"><li>Task</li><li>Task</li><li>Task</li></ul>
 </section>

 <section aria-label="Toast">
  <button id="notify">Notify later</button>
  <button id="other">Other</button>
  <span id="otherCount">0</span>
 </section>

 <section aria-label="Form">
  <form id="form"><label>Name <input id="name" name="name"></label></form>
  <p id="greeting"></p>
  <label><input id="subscribe" type="checkbox"> Subscribe</label>
  <span id="subState">not subscribed</span>
  <label>Color <select id="color"><option>red</option><option>green</option><option>blue</option></select></label>
  <span id="colorState">Color: red</span>
 </section>

 <section aria-label="Pointerdown menu">
  <button id="menuBtn">Menu</button>
  <div id="menu" role="menu" hidden><div role="menuitem" id="rename">Rename</div></div>
  <span id="menuState"></span>
 </section>

 <section aria-label="Missing target">
  <div id="cartWrap"><a class="cart" data-test="cart-link"><span class="badge"></span></a></div>
  <p id="cartState">cart closed</p>
 </section>

 <section aria-label="Shadow"><div id="host"></div></section>
 <section aria-label="Frame"><iframe id="frame" src="/frame" title="Inner frame"></iframe></section>
</main>
<script>
 const $ = (id) => document.getElementById(id);
 let orders = 1;
 $('load').addEventListener('click', () => {
   $('loadStatus').textContent = 'Loading';
   setTimeout(() => { orders += 1; $('orders').insertAdjacentHTML('beforeend', '<tr><td>Order ' + orders + '</td></tr>'); $('loadStatus').textContent = ''; }, 1500);
 });
 const insertTask = () => $('tasks').children[1].insertAdjacentHTML('beforebegin', '<li>Task</li>');
 $('insertNow').addEventListener('click', insertTask);
 $('insertLater').addEventListener('click', () => setTimeout(insertTask, 1500));
 $('notify').addEventListener('click', () => setTimeout(() => {
   const toast = document.createElement('div'); toast.id = 'toast'; toast.setAttribute('role', 'status');
   toast.innerHTML = 'Saved <button id="dismiss">Dismiss</button>';
   toast.querySelector('button').addEventListener('click', () => toast.remove());
   document.body.append(toast);
 }, 1500));
 $('other').addEventListener('click', () => { $('otherCount').textContent = String(Number($('otherCount').textContent) + 1); });
 $('form').addEventListener('submit', (e) => { e.preventDefault(); $('greeting').textContent = 'Hello, ' + $('name').value; });
 $('subscribe').addEventListener('change', (e) => { $('subState').textContent = e.target.checked ? 'subscribed' : 'not subscribed'; });
 $('color').addEventListener('change', (e) => { $('colorState').textContent = 'Color: ' + e.target.value; });
 $('menuBtn').addEventListener('pointerdown', () => { $('menu').hidden = false; });
 $('rename').addEventListener('click', () => { $('menu').hidden = true; $('menuState').textContent = 'renamed'; });
 document.querySelector('.cart').addEventListener('click', () => { $('cartState').textContent = 'cart open'; });
 const root = $('host').attachShadow({ mode: 'open' });
 root.innerHTML = '<button id="shadowBtn">Shadow button</button><span id="shadowCount">0</span>';
 root.getElementById('shadowBtn').addEventListener('click', () => { const c = root.getElementById('shadowCount'); c.textContent = String(Number(c.textContent) + 1); });
</script>`;

const FRAME = `<!doctype html><title>Inner</title><body style="margin:4px;font:14px system-ui">
<button id="inner">Inner button</button> <span id="innerCount">0</span>
<script>document.getElementById('inner').addEventListener('click', () => { const c = document.getElementById('innerCount'); c.textContent = String(Number(c.textContent) + 1); });</script></body>`;

// Every app-level event of interest is logged, so a probe can tell what the
// page received and how many times.
const EDGE = `<!doctype html><title>Gate edge cases</title>
<style>
 body{font:14px system-ui;margin:12px} .box{margin:6px 0}
 #drag{width:70px;height:24px;background:#fcc} #drop{width:160px;height:36px;background:#ccf}
 #slider{width:200px;height:20px;background:#ddd;position:relative} #knob{position:absolute;left:0;top:0;width:20px;height:20px;background:#555}
 iframe{width:320px;height:60px;border:3px solid #88c;padding:5px;margin-left:40px}
</style>
<main>
 <button id="plain">Plain</button> <span id="plainCount">0</span>
 <div class="box" id="dbl" style="width:120px;background:#eee">double me</div>
 <p class="box" id="text">Some selectable text for drag selection here.</p>
 <div class="box" id="drag" draggable="true">drag me</div><div class="box" id="drop">drop zone</div>
 <div class="box" id="slider"><div id="knob"></div></div><span id="sliderValue">0</span>
 <div class="box"><input id="range" type="range" aria-label="Volume" min="0" max="10" value="5"></div>
 <div class="box"><select id="pick" aria-label="Pick"><option>a</option><option>b</option><option>c</option></select></div>
 <div class="box"><input id="file" type="file" aria-label="Upload"></div>
 <div class="box" id="ctx" style="width:120px;background:#efe">right click me</div>
 <div class="box"><a id="blank" href="/two" target="_blank">New tab</a> <a id="nav" href="/two">Navigate</a></div>
 <div class="box"><button id="menuBtn">Menu</button><div id="menu" role="menu" hidden><div role="menuitem">Rename</div></div></div>
 <div class="box"><label id="lbl"><input id="chk" type="checkbox"> Agree</label></div>
 <div class="box"><input id="field" aria-label="Field"></div>
 <iframe id="frame" src="/frame" title="Inner frame"></iframe>
 <pre id="state"></pre>
</main>
<script>
 const $ = (id) => document.getElementById(id);
 window.__log = [];
 const log = (s) => window.__log.push(s);
 for (const type of ['pointerdown','mousedown','pointerup','mouseup','click','dblclick','contextmenu','auxclick','keydown','keyup','dragstart','drop','change','input'])
   document.addEventListener(type, (e) => log(type + ':' + (e.target.id || e.target.nodeName) + (type.startsWith('key') ? ':' + e.key : type === 'click' ? ':' + e.detail : '')));
 $('plain').addEventListener('click', () => { $('plainCount').textContent = String(Number($('plainCount').textContent) + 1); });
 $('dbl').addEventListener('dblclick', () => { $('dbl').textContent = 'doubled'; });
 $('drop').addEventListener('dragover', (e) => e.preventDefault());
 $('drop').addEventListener('drop', () => { $('drop').textContent = 'dropped'; });
 let sliding = false;
 $('slider').addEventListener('pointerdown', (e) => { sliding = true; $('slider').setPointerCapture(e.pointerId); });
 $('slider').addEventListener('pointermove', (e) => { if (!sliding) return; const x = Math.max(0, Math.min(180, e.clientX - $('slider').getBoundingClientRect().left)); $('knob').style.left = x + 'px'; $('sliderValue').textContent = String(Math.round(x)); });
 $('slider').addEventListener('pointerup', () => { sliding = false; });
 $('ctx').addEventListener('contextmenu', (e) => { e.preventDefault(); $('ctx').textContent = 'context menu'; });
 $('menuBtn').addEventListener('pointerdown', () => { $('menu').hidden = false; });
</script>`;

const TWO = `<!doctype html><title>Two</title><main><h1>Page two</h1><button id="b2">Second</button> <a href="/edge">Back</a></main>`;

const BIG = `<!doctype html><title>Big</title><main><button id="go">Go</button> <span id="count">0</span><table>${Array.from(
  { length: 2000 },
  (_, i) =>
    `<tr><td>Row ${i}</td><td><a href="#${i}">link ${i}</a></td><td><button>Edit ${i}</button></td></tr>`
).join("")}</table></main>
<script>document.getElementById('go').addEventListener('click', () => { const c = document.getElementById('count'); c.textContent = String(Number(c.textContent) + 1); });</script>`;

export function serveFixture() {
  const routes = {
    "/": MAIN,
    "/frame": FRAME,
    "/edge": EDGE,
    "/two": TWO,
    "/big": BIG,
  };
  const server = http.createServer((req, res) => {
    const body = routes[new URL(req.url, "http://x").pathname];
    if (body === undefined) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("content-type", "text/html");
    res.end(body);
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        origin: `http://127.0.0.1:${server.address().port}`,
        close: () => server.close(),
      })
    )
  );
}
