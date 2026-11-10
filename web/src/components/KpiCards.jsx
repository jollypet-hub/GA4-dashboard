import { Icon } from './Icons.jsx';
import { changeLabel, num, pct, pointLabel, twd } from '../format.js';

function Kpi({ icon, color, soft, label, value, change, prev, warn }) {
  const I = Icon[icon];
  return (
    <div className="kpi">
      <div className="kpi-head">
        <span className="kpi-ico" style={{ background: soft, color }}><I /></span>
        <span>{label}</span>
        {warn && <span className="warnmark" title={warn}><Icon.Warn width="18" height="18" role="img" aria-label="資料警示" aria-hidden={undefined} /></span>}
      </div>
      <div className="kpi-val num">{value}</div>
      <div className="kpi-foot">
        {change && <span className={`pill num ${change.up ? 'up' : 'down'}`}>{change.text}</span>}
        {prev && <span>前期 <span className="num">{prev}</span></span>}
      </div>
    </div>
  );
}

export default function KpiCards({ overview, compare }) {
  if (!overview || overview.status === 'no_data' || !overview.current) {
    return <div className="card empty">這段期間 GA4 沒有回傳資料（不代表數值為 0）。</div>;
  }
  const c = overview.current;
  const p = compare ? overview.previous : null;
  const ch = compare ? overview.change_pct ?? {} : {};
  // 轉換率低於 0.5% 時提醒先檢查追蹤（一般電商約 1–3%）
  const lowRate = c.purchaseRatePerSession !== null && c.purchaseRatePerSession < 0.005;

  return (
    <section className="kpis" aria-label="關鍵指標">
      <Kpi icon="Revenue" color="var(--brand-taupe-ink)" soft="var(--accent-soft)" label="購買營收" value={twd(c.purchaseRevenue)} change={changeLabel(ch.purchaseRevenue)} prev={p && twd(p.purchaseRevenue)} />
      <Kpi icon="Cart" color="var(--blue-ink)" soft="var(--blue-soft)" label="交易筆數" value={num(c.transactions)} change={changeLabel(ch.transactions)} prev={p && `${num(p.transactions)} 筆`} />
      <Kpi icon="Receipt" color="var(--purple)" soft="var(--purple-soft)" label="客單價" value={twd(c.avgOrderValue)} change={changeLabel(ch.avgOrderValue)} prev={p && twd(p.avgOrderValue)} />
      <Kpi icon="Target" color="var(--red-ink)" soft="var(--red-soft)" label="購買轉換率" value={pct(c.purchaseRatePerSession)} change={p && pointLabel(c.purchaseRatePerSession, p.purchaseRatePerSession)} prev={p && pct(p.purchaseRatePerSession)} warn={lowRate ? '轉換率偏低，可能有 purchase 事件漏記，建議先檢查追蹤' : null} />
      <Kpi icon="Users" color="var(--teal-ink)" soft="var(--teal-soft)" label="工作階段" value={num(c.sessions)} change={changeLabel(ch.sessions)} prev={p && num(p.sessions)} />
    </section>
  );
}
