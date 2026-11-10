import { Icon } from './Icons.jsx';
import { num, pct, twd } from '../format.js';

const COLORS = ['var(--brand-taupe)', 'var(--brand-sage)', 'var(--blue)', 'var(--purple)', '#E5674B', '#C2A35A', '#5B8DEF', '#98A2B3'];

export default function CategoryChart({ categories }) {
  const rows = (categories?.rows ?? []).slice(0, 8);
  const max = Math.max(1, ...rows.map((r) => r.revenue));
  return (
    <section className="card grow" aria-label="商品類別">
      <h2><Icon.Tag style={{ color: 'var(--purple)' }} />商品類別營收</h2>
      <p className="hint">依 Cyberbiz 送進 GA4 的商品類別統計</p>
      {categories?.status === 'not_set' ? (
        <div className="empty left">
          <b>官網沒有送出商品類別</b>
          <span>Cyberbiz 送給 GA4 的商品資料沒有類別（item_category），所以無法依類別統計。若需要，可請 Cyberbiz 或代理商在電子商務事件中加入商品類別。</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty">這段期間沒有類別資料</div>
      ) : (
        <ul className="cat-list">
          {rows.map((r, i) => (
            <li key={r.category}>
              <div className="cat-top">
                <span className="cat-name"><span className="dot" style={{ background: COLORS[i % COLORS.length] }} />{r.category}</span>
                <span className="num">{twd(r.revenue)}</span>
              </div>
              <span className="fn-bar"><i style={{ width: `${Math.max(1.5, (r.revenue / max) * 100)}%`, background: COLORS[i % COLORS.length] }} /></span>
              <small>占 {pct(r.revenueShare, 0)} · {num(r.purchased)} 件</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
