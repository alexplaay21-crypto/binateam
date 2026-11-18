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
<div class="h"><span class="t" id="tk">…</span><span class="m" id="bal"></span></div>
<div class="h"><span class="p" id="pr">…</span><span id="ch"></span></div>
<svg viewBox="0 0 100 40" preserveAspectRatio="none"><polyline id="ln" fill="none" stroke-width="1.2" points=""/></svg>
<div class="row" id="tks"></div><div class="row" id="am"></div><div class="row" id="du"></div>
<div class="big"><button id="u">▲ BUY</button><button id="d">▼ SELL</button></div>
<div id="s" class="m"></div><div id="o"></div>
<script>
var W=window.TelegramWidget,S={},id=0,am=100,du=60,busy=0;
try{var c=JSON.parse(W.chatData||'{}');id=c.id||0}catch(e){}
function $(x){return document.getElementById(x)}
function chips(el,list,cur,f){el.innerHTML='';list.forEach(function(v){var b=document.createElement('button');b.textContent=v[1];if(v[0]==cur)b.className='on';b.onclick=function(){f(v[0])};el.appendChild(b)})}
function draw(){if(!S.t)return;$('tk').textContent='$'+S.t;$('pr').textContent=S.p+' BC';$('bal').textContent=S.b+' BC';
var ch=$('ch');ch.textContent=S.c;ch.className=S.c[0]=='-'?'r':'g';
var pts=S.k||[],n=pts.length,ln=$('ln');ln.setAttribute('stroke',S.c[0]=='-'?'#e5484d':'#21b36b');
ln.setAttribute('points',pts.map(function(v,i){return(n>1?i*100/(n-1):50)+','+(38-v*.36)}).join(' '));
chips($('tks'),S.a||[],id,function(v){id=v;ask('r:'+id)});
chips($('am'),[[10,'10'],[50,'50'],[100,'100'],[500,'500']],am,function(v){am=v;draw()});
chips($('du'),[[30,'30с'],[60,'1м'],[180,'3м'],[300,'5м']],du,function(v){du=v;draw()});
$('u').textContent='▲ BUY +'+S.y+'%';$('d').textContent='▼ SELL +'+S.y+'%';
var o=$('o');o.innerHTML='';(S.o||[]).forEach(function(x){var d=document.createElement('div');
d.innerHTML='<span>'+(x[0]=='u'?'▲':'▼')+' $'+x[1]+' '+x[2]+' BC</span><span class="'+(x[4]>0?'g':x[4]<0?'r':'m')+'">'+(x[3]>0?x[3]+' с':'итог…')+'</span>';o.appendChild(d)})}
function ask(q,msg){if(busy)return;busy=1;if(msg)$('s').textContent=msg;
W.request(q).then(function(a){busy=0;try{var r=JSON.parse(a.result);if(r.s)S=r.s;if(r.id)id=r.id;$('s').textContent=r.m||''}catch(e){}draw()},
function(e){busy=0;$('s').textContent=e.code=='RATE_LIMITED'?'Слишком часто, подождите':'Нет связи с ботом'})}
$('u').onclick=function(){ask('b:'+id+':u:'+am+':'+du,'Открываю сделку…')};
$('d').onclick=function(){ask('b:'+id+':d:'+am+':'+du,'Открываю сделку…')};
W.onEvent('chatDataChanged',function(){try{id=JSON.parse(W.chatData).id||id}catch(e){}});
ask('r:'+id);setInterval(function(){ask('r:'+id)},5500);
</script>`;

const fmt = (ubc) => {
  const v = ubc / E.UBC;
  return v.toLocaleString('ru-RU', { maximumFractionDigits: v >= 100 ? 2 : v >= 1 ? 4 : 6 });
};

// Состояние для виджета (≤ 1024 байт).
export async function widgetState(db, uid, tokenId) {
  const v = await TR.view(db, uid, { tokenId });
  if (!v.asset) return { id: 0, s: { t: '—', p: '—', c: '', b: fmt(v.wallet.bc - v.wallet.bc_reserved), a: [], k: [], o: [], y: v.config.payout_bps / 100 }, m: 'Пока нет токенов с достаточной ликвидностью' };
  const pts = v.points.map((x) => x.p);
  const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
  const step = Math.max(1, Math.ceil(pts.length / 40));
  const k = pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map((p) => Math.round(((p - lo) / span) * 99));
  const first = pts[0] ?? 1, last = pts[pts.length - 1] ?? first;
  const ch = ((last - first) / first) * 100;
  const price = Math.floor(last / v.scale);
  return {
    id: v.asset.id,
    s: {
      t: v.asset.ticker, p: fmt(price), c: (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%', b: fmt(v.wallet.bc - v.wallet.bc_reserved),
      a: v.assets.slice(0, 4).map((x) => [x.id, x.ticker]), k, y: v.config.payout_bps / 100,
      o: v.open.slice(0, 3).map((p) => {
        const cur = p.token_id === v.asset.id ? last : p.entry_price;
        const diff = Math.sign(cur - p.entry_price) * (p.direction === 'up' ? 1 : -1);
        return [p.direction === 'up' ? 'u' : 'd', p.asset, Math.round(p.stake / E.UBC), Math.max(0, p.expires_at - v.now), diff];
      }),
    },
  };
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
  TOO_MANY_OPEN: 'Уже 5 открытых сделок', LOW_LIQUIDITY: 'У токена мало ликвидности', TRADING_DISABLED: 'Трейдинг временно выключен',
  ASSET_UNAVAILABLE: 'Токен недоступен для трейдинга', USER_BANNED: 'Аккаунт заблокирован',
};
