import { useMemo, useState } from 'react';
import { Icon } from './Icons.jsx';
import { num, pct, ratePct, twd } from '../format.js';
import { downloadCsv } from '../csv.js';

const SORTS = {
  revenue: { label: '依營收', value: (i) => i.revenue, change: (i) => i.revenueChange, show: (i) => twd(i.revenue) },
  purchased: { label: '依件數', value: (i) => i.purchased, change: (i) => i.purchasedChange, show: (i) => `${num(i.purchased)} 件` },
};
const TOP = 10;

function ChangePill({ value, isNew }) {
  if (isNew) return <span className="pill new">新上榜</span>;
  if (value === null || value === undefined) return null;
  const up = value >= 0;
  const a = Math.abs(value * 100);
  return <span className={`pill ${up ? 'up' : 'down'}`}>{up ? '▲' : '▼'} {a >= 100 ? Math.round(a) : a.toFixed(1)}%</span>;
}

export default function ProductsSection({ merch, compare, range, onAsk }) {
  const [sort, setSort] = useState('revenue');
  const [showAll, setShowAll] = useState(false);
  const s = SORTS[sort];

  const ranked = useMemo(() => {
    const items = (merch?.items ?? []).filter((i) => s.value(i) > 0);
    return items.sort((a, b) => s.value(b) - s.value(a) || b.revenue - a.revenue);
  }, [merch, s]);
  const watch = useMemo(() => (merch?.items ?? []).filter((i) => i.highViewLowPurchase).sort((a, b) => b.views - a.views).slice(0, 3), [merch]);

  if (!merch) return null;
  if (merch.status !== 'ok') {
    return (
      <section className="card" aria-label="明星單品">
        <h2><Icon.Star style={{ color: 'var(--brand-taupe-ink)' }} />明星單品</h2>
        <div className="empty">這段期間沒有商品資料</div>
      </section>
    );
  }

  const list = ranked.slice(0, showAll ? 30 : TOP);
  const max = Math.max(1, ...list.map(s.value));
  const t = merch.totals;
  const revChange = compare && t.prevRevenue > 0 ? (t.revenue - t.prevRevenue) / t.prevRevenue : null;
  const c = merch.concentration;

  function exportCsv() {
    const header = ['排名(依營收)', '商品名稱', '商品營收', '營收占比', '購買件數', '瀏覽次數', '加入購物車', '瀏覽→加車', '瀏覽→購買',
      ...(compare ? ['前期營收', '營收變化', '前期件數'] : []), '標籤'];
    const rows = merch.items.map((i, idx) => [
      idx + 1, i.name, i.revenue, pct(i.revenueShare, 1), i.purchased, i.views, i.carts, pct(i.viewToCart, 2), pct(i.viewToPurchase, 2),
      ...(compare ? [i.prevRevenue, i.isNew ? '新上榜' : pct(i.revenueChange, 1), i.prevPurchased] : []),
      [i.star && '明星', i.highViewLowPurchase && '高瀏覽低購買'].filter(Boolean).join('、'),
    ]);
    downloadCsv(`商品表現_${range.start}_${range.end}.csv`, header, rows);
  }

  return (
    <section className="card" aria-label="明星單品">
      <div className="card-head">
        <div>
          <h2><Icon.Star style={{ color: 'var(--brand-taupe-ink)' }} />明星單品</h2>
          <p className="hint">商品營收不含運費。點商品可以問 AI。</p>
        </div>
        <div className="card-tools">
          <div className="seg small" role="group" aria-label="排名依據">
            {Object.entries(SORTS).map(([k, v]) => (
              <button key={k} type="button" aria-pressed={sort === k} onClick={() => setSort(k)}>{v.label}</button>
            ))}
          </div>
          <button type="button" className="linkbtn" onClick={exportCsv}><Icon.Download />匯出 CSV</button>
        </div>
      </div>

      <div className="merch-stats">
        <div>
          <span>商品營收</span>
          <b className="num">{twd(t.revenue)}</b>
          {revChange !== null && <ChangePill value={revChange} />}
        </div>
        <div>
          <span>賣出件數</span>
          <b className="num">{num(t.purchased)}</b>
          <small>{num(t.itemsWithSales)} 個商品有成交</small>
        </div>
        <div className="conc">
          <span>前 3 名占商品營收</span>
          <b className="num">{pct(c.top3Share, 0)}</b>
          <div className="stack" aria-hidden="true">
            <i style={{ width: `${(c.top3Share ?? 0) * 100}%` }} />
          </div>
          <small>{(c.top3Share ?? 0) >= 0.6 ? '營收集中在少數商品' : '營收分散在多個商品'}</small>
        </div>
      </div>

      <ol className="rank">
        {list.map((i, idx) => (
          <li key={i.name}>
            <span className={`no ${idx < 3 ? 'top' : ''}`}>{idx + 1}</span>
            <button type="button" className="rank-main" onClick={() => onAsk(`商品「${i.name}」這段期間表現如何？瀏覽、加入購物車到購買的轉換有沒有問題？`)}>
              <span className="rank-name">{i.name}</span>
              <span className="rank-tags">
                {i.star && <span className="tag star">★ 明星</span>}
                {i.highViewLowPurchase && <span className="tag warn">高瀏覽低購買</span>}
                <span className="tag plain"><Icon.Eye />{num(i.views)} 瀏覽 · 購買率 {ratePct(i.viewToPurchase)}</span>
              </span>
              <span className="rank-bar"><i style={{ width: `${Math.max(2, (s.value(i) / max) * 100)}%` }} /></span>
            </button>
            <span className="rank-val">
              <b className="num">{s.show(i)}</b>
              <small>{sort === 'revenue' ? `${num(i.purchased)} 件 · 占 ${pct(i.revenueShare, 0)}` : twd(i.revenue)}</small>
              {compare && <ChangePill value={s.change(i)} isNew={i.isNew} />}
            </span>
          </li>
        ))}
      </ol>
      {ranked.length > TOP && (
        <button type="button" className="more" onClick={() => setShowAll(!showAll)}>
          {showAll ? '收合' : `顯示更多（共 ${ranked.length} 個有${sort === 'revenue' ? '營收' : '成交'}的商品）`}
        </button>
      )}

      {watch.length > 0 && (
        <div className="watch">
          <h3><Icon.Warn />很多人看、很少人買</h3>
          <p>這些商品瀏覽次數高，但購買率低於整體（{pct(t.viewToPurchase, 2)}）的一半，可以檢查價格、商品頁、庫存或廣告受眾。</p>
          <ul>
            {watch.map((i) => (
              <li key={i.name}>
                <span className="rank-name">{i.name}</span>
                <span className="num">{num(i.views)} 瀏覽 → {num(i.purchased)} 件（{pct(i.viewToPurchase, 2)}）</span>
                <button type="button" onClick={() => onAsk(`商品「${i.name}」瀏覽 ${i.views} 次但只賣出 ${i.purchased} 件，可能的原因是什麼？流量從哪裡來？`)}>問 AI</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {merch.notSetShare > 0.05 && <p className="foot-note">有 {pct(merch.notSetShare, 0)} 的商品營收沒有商品名稱（not set），代表部分購買事件沒有帶商品資料。</p>}
    </section>
  );
}
