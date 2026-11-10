import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Icon } from './Icons.jsx';
import { DEVICE_NAMES, num, pct } from '../format.js';

const STYLE = {
  mobile: { color: 'var(--blue)', icon: 'Phone' },
  desktop: { color: 'var(--purple)', icon: 'Desktop' },
  tablet: { color: 'var(--teal)', icon: 'Tablet' },
};

export default function DeviceChart({ devices }) {
  const rows = devices?.rows ?? [];
  const total = rows.reduce((n, r) => n + (r.current.sessions ?? 0), 0);
  const data = rows.map((r) => ({
    name: DEVICE_NAMES[r.device] ?? r.device,
    key: r.device,
    sessions: r.current.sessions ?? 0,
    share: total ? (r.current.sessions ?? 0) / total : 0,
    rate: r.current.purchaseRatePerSession,
  }));

  return (
    <section className="card side" aria-label="裝置比較">
      <h2 style={{ marginBottom: 14 }}><Icon.Phone style={{ color: 'var(--purple)' }} />裝置比較</h2>
      {data.length === 0 ? (
        <div className="empty">這段期間沒有裝置資料</div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ width: 150, height: 150 }} role="img" aria-label="各裝置工作階段占比圓環圖">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={data} dataKey="sessions" nameKey="name" innerRadius={46} outerRadius={70} paddingAngle={2} stroke="none">
                  {data.map((d) => <Cell key={d.key} fill={STYLE[d.key]?.color ?? '#98A2B3'} />)}
                </Pie>
                <Tooltip formatter={(v, n) => [`${num(v)} 工作階段`, n]} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="dev-list">
            {data.map((d) => {
              const I = Icon[STYLE[d.key]?.icon ?? 'Desktop'];
              return (
                <div className="dev-item" key={d.key}>
                  <I style={{ color: STYLE[d.key]?.color ?? '#98A2B3' }} />
                  <b style={{ fontWeight: 500 }}>{d.name}</b>
                  <span className="num">占 {Math.round(d.share * 100)}% · 轉換 {pct(d.rate)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
