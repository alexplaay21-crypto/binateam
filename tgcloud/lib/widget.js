// lib/widget.js — HTML-виджет Bina Trading для сообщения бота (Bot API 10.4).
// Виджет работает без сети: состояние и действия идут через TelegramWidget.request().
// Запросы (до 64 байт):  r:<id> — обновить, b:<id>:<u|d>:<сумма BC>:<сек> — сделка.
import * as TR from './trading.js';
import * as E from './engine.js';

export const WIDGET_HTML = `<style>
body{margin:0;padding:10px 12px;font:14px system-ui,sans-serif}
.h{display:flex;justify-content:space-between;align-items:baseline}
.t{font-weight:700;font-size:1.1em}.p{font-weight:700;font-size:1.5em}
.g{color:#21b36b}.r{color:#e5484d}.m{color:var(--tg-theme-hint-color)}
svg{display:block;width:100%;height:90px;margin:6px 0}
.row{display:flex;gap:6px;margin:6px 0;overflow:hidden}
.row button{flex:1;padding:6px 0;font-size:.85em;border-radius:9px;border:0;background:var(--tg-theme-secondary-bg-color);color:var(--tg-theme-text-color)}
.row button.on{background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color)}
.big{display:flex;gap:8px;margin-top:8px}.big button{flex:1;padding:11px 0;border:0;border-radius:12px;color:#fff;font-weight:700;font-size:1em}
#u{background:#21b36b}#d{background:#e5484d}
#o div{display:flex;justify-content:space-between;font-size:.85em;padding:2px 0}
#s{min-height:1.2em;font-size:.85em;margin-top:6px}
</style>
<div class="h"><span class="t" id="tk">…</span><span class="m"><span id="bal"></span> <button id="rf" style="border:0;background:none;color:var(--tg-theme-link-color);padding:0 0 0 6px">⟳</button></span></div>
<div class="h"><span class="p" id="pr">…</span><span id="ch"></span></div>
<svg viewBox="0 0 100 40" preserveAspectRatio="none"><polyline id="ln" fill="none" stroke-width="1.2" points=""/></svg>
<div class="row" id="tks"></div><div class="row" id="am"></div><div class="row" id="du"></div>
<div class="big"><button id="u">▲ BUY</button><button id="d">▼ SELL</button></div>
<div id="s" class="m"></div><div id="o"></div>
<script>
var W=window.TelegramWidget,S={},id=0,am=100,du=60,busy=0;
function fromChat(){try{var c=JSON.parse(W.chatData||'{}');if(c.id)id=c.id;if(c.s){var b=S.b,o=S.o;S=c.s;if(b&&!S.b)S.b=b;if(o&&!S.o)S.o=o}}catch(e){}}
fromChat();
function $(x){return document.getElementById(x)}
function chips(el,list,cur,f){el.innerHTML='';list.forEach(function(v){var b=document.createElement('button');b.textContent=v[1];if(v[0]==cur)b.className='on';b.onclick=function(){f(v[0])};el.appendChild(b)})}
function draw(){if(!S.t)return;$('tk').textContent='$'+S.t;$('pr').textContent=S.p+' BC';$('bal').textContent=S.b?S.b+' BC':'';
var ch=$('ch');ch.textContent=S.c;ch.className=S.c[0]=='-'?'r':'g';
var pts=S.k||[],n=pts.length,ln=$('ln');ln.setAttribute('stroke',S.c[0]=='-'?'#e5484d':'#21b36b');
ln.setAttribute('points',pts.map(function(v,i){return(n>1?i*100/(n-1):50)+','+(38-v*.36)}).join(' '));
chips($('tks'),S.a||[],id,function(v){id=v;ask('r:'+id)});
chips($('am'),[[10,'10'],[50,'50'],[100,'100'],[500,'500']],am,function(v){am=v;draw()});
chips($('du'),[[30,'30с'],[60,'1м'],[180,'3м'],[300,'5м']],du,function(v){du=v;draw()});
$('u').textContent='▲ BUY +'+S.y+'%';$('d').textContent='▼ SELL +'+S.y+'%';
var o=$('o');o.innerHTML='';(S.o||[]).forEach(function(x){var d=document.createElement('div');
d.innerHTML='<span>'+(x[0]=='u'?'▲':'▼')+' $'+x[1]+' '+x[2]+' BC</span><span class="'+(x[4]>0?'g':x[4]<0?'r':'m')+'">'+(x[3]>0?x[3]+' с':'итог…')+'</span>';o.appendChild(d)})}
function ask(q,msg,bg){if(busy)return;busy=1;if(msg)$('s').textContent=msg;
W.request(q).then(function(a){busy=0;try{var r=JSON.parse(a.result);if(r.s)S=r.s;if(r.id)id=r.id;$('s').textContent=r.m||''}catch(e){}draw()},
function(e){busy=0;if(bg)return;$('s').textContent=e.code=='RATE_LIMITED'?'Слишком часто, подождите':e.code=='NOT_ALLOWED'?'Откройте бота, чтобы торговать':'Нет связи с ботом'})}
$('rf').onclick=function(){ask('r:'+id,'Обновляю…')};
$('u').onclick=function(){ask('b:'+id+':u:'+am+':'+du,'Открываю сделку…')};
$('d').onclick=function(){ask('b:'+id+':d:'+am+':'+du,'Открываю сделку…')};
W.onEvent('chatDataChanged',function(){fromChat();draw()});
draw();ask('r:'+id,0,1);setInterval(function(){ask('r:'+id,0,1)},5500);
</script>`;

const fmt = (ubc) => {
  const v = ubc / E.UBC;
  return v.toLocaleString('ru-RU', { maximumFractionDigits: v >= 100 ? 2 : v >= 1 ? 4 : 6 });
};

// Общее состояние токена — одинаковое для всех, кто видит виджет (≤ 1024 байт).
export async function publicState(db, tokenId) {
  const NOW = '(SELECT now FROM v_now)';
  const list = await db.all(
    `SELECT t.id, t.ticker, p.real_bc FROM tokens t JOIN token_pools p ON p.token_id = t.id
     WHERE t.is_hidden = 0 ORDER BY t.is_verified DESC, p.real_bc DESC LIMIT 4`);
  let tok = tokenId ? await db.get(
    `SELECT t.id, t.ticker FROM tokens t JOIN token_pools p ON p.token_id = t.id WHERE t.id = :t AND t.is_hidden = 0`, { ':t': Number(tokenId) }) : null;
  tok = tok ?? list[0];
  const st = await E.settings(db);
  const y = st.trading_payout_bps / 100;
  if (!tok) return { id: 0, s: { t: '—', p: '—', c: '', a: [], k: [], y } };
  const pts = (await TR.points(db, tok.id)).map((x) => x.p);
  const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const step = Math.max(1, Math.ceil(pts.length / 40));
  const k = pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map((p) => Math.round(((p - lo) / span) * 99));
  const first = pts[0] ?? 1, last = pts[pts.length - 1] ?? first;
  const ch = ((last - first) / first) * 100;
  const a = list.map((x) => [x.id, x.ticker]);
  if (!a.some((x) => x[0] === tok.id)) a.unshift([tok.id, tok.ticker]);
  return { id: tok.id, s: { t: tok.ticker, p: fmt(Math.floor(last / TR.PRICE_X_SCALE)), c: (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%', a: a.slice(0, 4), k, y } };
}

// Общее + личное: баланс и открытые сделки того, кто нажал.
export async function widgetState(db, uid, tokenId) {
  await TR.settleDue(db, { userId: uid, limit: 10 });
  const pub = await publicState(db, tokenId);
  const w = await db.get('SELECT bc - bc_reserved AS free FROM wallets WHERE user_id = :u', { ':u': uid });
  const open = await db.all(`SELECT * FROM trading_positions WHERE user_id = :u AND status = 'open' ORDER BY id DESC LIMIT 3`, { ':u': uid });
  const now = (await db.get('SELECT now FROM v_now')).now;
  const cur = await db.get(`SELECT ${'CAST(CAST(virtual_bc + real_bc AS REAL) * 1000000.0 / tokens AS INTEGER)'} AS x FROM token_pools WHERE token_id = :t`, { ':t': pub.id });
  pub.s.b = fmt(w?.free ?? 0);
  pub.s.o = open.map((p) => {
    const diff = p.token_id === pub.id && cur ? Math.sign(cur.x - p.entry_price) * (p.direction === 'up' ? 1 : -1) : 0;
    return [p.direction === 'up' ? 'u' : 'd', p.asset, Math.round(p.stake / E.UBC), Math.max(0, p.expires_at - now), diff];
  });
  if (!pub.id) pub.m = 'Пока нет токенов';
  return pub;
}

export async function handleWidgetQuery(db, uid, data) {
  const [cmd, id, dir, amt, dur] = String(data).split(':');
  if (cmd === 'b') {
    try {
      const p = await TR.openPosition(db, uid, {
        tokenId: Number(id), direction: dir === 'u' ? 'up' : 'down', stake: Number(amt) * E.UBC, durationS: Number(dur),
        clientId: `w${Date.now()}`, source: 'widget',
      });
      const st = await widgetState(db, uid, Number(id));
      return { ...st, m: `Сделка открыта: ${dir === 'u' ? '▲' : '▼'} $${p.asset} ${amt} BC на ${dur} с` };
    } catch (e) {
      const st = await widgetState(db, uid, Number(id));
      return { ...st, m: WIDGET_ERRORS[e.code] ?? 'Не удалось открыть сделку' };
    }
  }
  return widgetState(db, uid, Number(id) || null);
}

export const WIDGET_ERRORS = {
  INSUFFICIENT_BC: 'Недостаточно BC', BET_TOO_SMALL: 'Слишком маленькая ставка', BET_TOO_LARGE: 'Ставка больше лимита токена',
  TOO_MANY_OPEN: 'Уже 5 открытых сделок', LOW_LIQUIDITY: 'Трейдинг по токену откроется, когда в пуле будет от 1000 BC', TRADING_DISABLED: 'Трейдинг временно выключен',
  ASSET_UNAVAILABLE: 'Трейдинг по токену откроется, когда в пуле будет от 1000 BC', USER_BANNED: 'Аккаунт заблокирован',
  POSITION_OPEN: 'Сначала дождитесь итога сделки',
};
