import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Icon } from './Icons.jsx';
import { num, shortDate, twd } from '../format.js';

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', fontSize: 13, boxShadow: '0 4px 12px rgba(16,24,40,.1)' }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}{d.missing ? '（沒有資料）' : ''}</div>
      <div>工作階段：<span className="num">{num(d.sessions)}</span></div>
      <div>購買營收：<span className="num">{twd(d.purchaseRevenue)}</span></div>
      <div>交易：<span className="num">{num(d.transactions)}</span> 筆</div>
      {d.prev_date && <div style={{ color: 'var(--muted)', marginTop: 4 }}>前期同日工作階段：<span className="num">{num(d.prev_sessions)}</span></div>}
    </div>
  );
}

export default function TrendChart({ trend, compare }) {
  const days = (trend?.days ?? []).map((d) => ({ ...d, label: shortDate(d.date), sessionsShown: d.missing ? null : d.sessions }));
  return (
    <section className="card" aria-label="每日趨勢">
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}><Icon.Trend style={{ color: 'var(--blue-ink)' }} />每日趨勢</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 13, color: 'var(--ink-2)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, height: 3, background: 'var(--blue)', borderRadius: 2 }} />工作階段</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 12, height: 12, background: 'var(--accent)', borderRadius: 3 }} />購買營收</span>
          {compare && <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, borderTop: '2px dashed #98A2B3' }} />前期工作階段</span>}
        </div>
      </div>
      {days.length === 0 ? (
        <div className="empty">這段期間沒有每日資料</div>
      ) : (
        <div style={{ width: '100%', height: 280 }} role="img" aria-label="每日工作階段與購買營收趨勢圖">
          <ResponsiveContainer>
            <ComposedChart data={days} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#EEF0F3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#5B6475' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
              <YAxis yAxisId="s" tick={{ fontSize: 12, fill: '#5B6475' }} tickLine={false} axisLine={false} width={48} tickFormatter={num} />
              <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 12, fill: '#5B6475' }} tickLine={false} axisLine={false} width={64} tickFormatter={(v) => `$${num(v)}`} />
              <Tooltip content={<Tip />} cursor={{ fill: 'rgba(31,111,235,.06)' }} />
              <Bar yAxisId="r" dataKey="purchaseRevenue" name="購買營收" fill="var(--accent)" radius={[6, 6, 0, 0]} maxBarSize={44} opacity={0.85} />
              {compare && <Line yAxisId="s" type="monotone" dataKey="prev_sessions" name="前期工作階段" stroke="#98A2B3" strokeWidth={2} strokeDasharray="6 6" dot={false} />}
              <Line yAxisId="s" type="monotone" dataKey="sessionsShown" name="工作階段" stroke="var(--blue)" strokeWidth={3} dot={{ r: 4, fill: '#fff', strokeWidth: 2 }} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
