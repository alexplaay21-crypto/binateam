import { bc } from '../format';

// Свечной график по реальным сделкам. Пустые периоды — плоская линия без объёма.
export function CandleChart({ candles, height = 220 }: { candles: any[]; height?: number }) {
  const W = 360, H = height, volH = 40, pad = 4, axis = 52;
  if (!candles.length) return <div className="empty">Сделок пока не было</div>;
  const hi = Math.max(...candles.map((c) => c.h)), lo = Math.min(...candles.map((c) => c.l));
  const span = hi - lo || hi * 0.02 || 1;
  const top = hi + span * 0.08, bottom = lo - span * 0.08;
  const plotH = H - volH - pad * 2;
  const y = (v: number) => pad + ((top - v) / (top - bottom)) * plotH;
  const maxV = Math.max(1, ...candles.map((c) => c.v));
  const cw = (W - axis) / candles.length;
  const bw = Math.max(1, cw * 0.65);
  const last = candles[candles.length - 1].c;
  const ticks = [top - (top - bottom) * 0.1, (top + bottom) / 2, bottom + (top - bottom) * 0.1];
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={0} x2={W - axis} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={0.5} />
            <text x={W - axis + 4} y={y(t) + 3}>{bc(t)}</text>
          </g>
        ))}
        {candles.map((c, i) => {
          const x = i * cw + cw / 2;
          const color = c.empty ? 'var(--hint)' : c.c >= c.o ? 'var(--up)' : 'var(--down)';
          const vh = (c.v / maxV) * (volH - 6);
          return (
            <g key={c.t}>
              {c.empty ? (
                <line x1={x - bw / 2} x2={x + bw / 2} y1={y(c.c)} y2={y(c.c)} stroke={color} strokeWidth={1} opacity={0.5} />
              ) : (
                <>
                  <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth={1} />
                  <rect x={x - bw / 2} width={bw} y={y(Math.max(c.o, c.c))} height={Math.max(1, Math.abs(y(c.o) - y(c.c)))} fill={color} />
                  <rect x={x - bw / 2} width={bw} y={H - vh} height={vh} fill={color} opacity={0.35} />
                </>
              )}
            </g>
          );
        })}
        <line x1={0} x2={W - axis} y1={y(last)} y2={y(last)} stroke="var(--accent)" strokeWidth={0.6} strokeDasharray="3 3" />
        <rect x={W - axis + 1} y={y(last) - 7} width={axis - 1} height={14} rx={3} fill="var(--accent)" />
        <text x={W - axis + 4} y={y(last) + 3} style={{ fill: 'var(--on-accent)' }}>{bc(last)}</text>
      </svg>
    </div>
  );
}

// График глубины стакана: меняется с каждой заявкой, даже без сделок.
export function DepthChart({ bids, asks }: { bids: any[]; asks: any[] }) {
  const W = 360, H = 90;
  if (!bids.length && !asks.length) return <div className="empty">Стакан пуст</div>;
  const cum = (lv: any[]) => { let s = 0; return lv.map((l) => ({ p: l.price, q: (s += l.qty) })); };
  const b = cum(bids), a = cum(asks);
  const prices = [...b, ...a].map((x) => x.p);
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const maxQ = Math.max(1, ...b.map((x) => x.q), ...a.map((x) => x.q));
  const x = (p: number) => (maxP === minP ? W / 2 : ((p - minP) / (maxP - minP)) * (W - 8) + 4);
  const yv = (q: number) => H - 4 - (q / maxQ) * (H - 12);
  const path = (pts: { p: number; q: number }[]) => {
    if (!pts.length) return '';
    let d = `M ${x(pts[0].p)} ${H - 4}`;
    for (const pt of pts) d += ` L ${x(pt.p)} ${yv(pt.q)}`;
    return d + ` L ${x(pts[pts.length - 1].p)} ${H - 4} Z`;
  };
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H }}>
        <path d={path(b)} fill="var(--up-bg)" stroke="var(--up)" strokeWidth={1} />
        <path d={path(a)} fill="var(--down-bg)" stroke="var(--down)" strokeWidth={1} />
      </svg>
    </div>
  );
}
