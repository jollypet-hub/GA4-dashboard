import { useMemo, useState } from 'react';
import { Icon } from './Icons.jsx';
import { num, pct, twd } from '../format.js';

const COLORS = ['var(--blue)', 'var(--teal)', 'var(--accent)', 'var(--purple)', '#E5674B', '#5B8DEF', '#98A2B3', '#C2A35A'];
const TOP = 8;

const revChange = (r) => (r.previous ? (r.current.purchaseRevenue ?? 0) - (r.previous.purchaseRevenue ?? 0) : null);

export default function SourcesTable({ sources, compare, onAsk }) {
  const [mode, setMode] = useState('traffic');
  const [showAll, setShowAll] = useState(false);
  const all = sources?.rows ?? [];

  // 依流量：有比較時依工作階段增減；依營收：依購買營收（和 GA4「購買收益（按工作階段來源／媒介）」相同）
  const rows = useMemo(() => {
    if (mode === 'revenue') {
      return all.filter((r) => (r.current.purchaseRevenue ?? 0) > 0 || (compare && (r.previous?.purchaseRevenue ?? 0) > 0))
        .sort((a, b) => (b.current.purchaseRevenue ?? 0) - (a.current.purchaseRevenue ?? 0));
    }
    return all;
  }, [all, mode, compare]);
  const list = showAll ? rows : rows.slice(0, TOP);

  const measure = (r) =>
    mode === 'revenue' ? r.current.purchaseRevenue ?? 0 : compare ? Math.abs(r.sessions_change ?? 0) : r.current.sessions ?? 0;
  const max = Math.max(1, ...list.map(measure));
  const totalRevenue = sources?.totals?.current?.purchaseRevenue ?? 0;

  return (
    <section className="card grow" aria-label="流量來源">
      <div className="card-head">
        <div>
          <h2><Icon.Share style={{ color: 'var(--teal-ink)' }} />流量來源</h2>
          <p className="hint">
            {mode === 'revenue'
              ? '依購買營收排序（工作階段來源／媒介，與 GA4 報表相同）'
              : compare
                ? '依「工作階段增減」排序，最上面就是帶動變化最多的來源'
                : '依工作階段數排序'}
          </p>
        </div>
        <div className="card-tools">
          <div className="seg small" role="group" aria-label="排序依據">
            <button type="button" aria-pressed={mode === 'traffic'} onClick={() => setMode('traffic')}>依流量</button>
            <button type="button" aria-pressed={mode === 'revenue'} onClick={() => setMode('revenue')}>依營收</button>
          </div>
        </div>
      </div>
      {list.length === 0 ? (
        <div className="empty">{mode === 'revenue' ? '這段期間沒有來源帶來營收' : '這段期間沒有來源資料'}</div>
      ) : (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>來源 / 媒介</th>
                <th>{mode === 'revenue' ? '購買營收' : compare ? '工作階段增減' : '工作階段'}</th>
                <th className="r">工作階段</th>
                <th className="r">交易</th>
                <th className="r">轉換率</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => {
                const change = r.sessions_change ?? 0;
                const up = change >= 0;
                const rc = revChange(r);
                const color = mode === 'traffic' && compare && !up ? 'var(--red)' : COLORS[i % COLORS.length];
                return (
                  <tr key={r.source_medium}>
                    <td>
                      <div className="src" title={r.source_medium}><span className="dot" style={{ background: COLORS[i % COLORS.length] }} />{r.source_medium}</div>
                      {r.checkout_redirect && <span className="tag warn" style={{ marginTop: 4 }} title="客人去付款或登入後跳回官網，被 GA4 記成新來源；這些成交其實屬於客人最初的來源">結帳跳轉，非真正來源</span>}
                    </td>
                    <td>
                      <div className="bar-cell">
                        <div className="bar" style={{ width: `${Math.max(4, (measure(r) / max) * 140)}px`, background: color }} />
                        {mode === 'revenue' ? (
                          <>
                            <span className="num">{twd(r.current.purchaseRevenue)}</span>
                            {totalRevenue > 0 && <span style={{ fontSize: 12, color: 'var(--muted)' }}>占 {Math.round(((r.current.purchaseRevenue ?? 0) / totalRevenue) * 100)}%</span>}
                            {compare && rc !== null && rc !== 0 && (
                              <span className={`num ${rc > 0 ? 'chg-up' : 'chg-down'}`} style={{ fontSize: 12 }}>{rc > 0 ? '▲' : '▼'} {twd(Math.abs(rc))}</span>
                            )}
                          </>
                        ) : compare ? (
                          <>
                            <span className={`num ${up ? 'chg-up' : 'chg-down'}`}>{up ? '▲' : '▼'} {num(Math.abs(change))}</span>
                            {r.share_of_sessions_change !== null && r.share_of_sessions_change !== undefined && (
                              <span style={{ fontSize: 12, color: 'var(--muted)' }}>占 {Math.round(r.share_of_sessions_change * 100)}%</span>
                            )}
                          </>
                        ) : (
                          <span className="num">{num(r.current.sessions)}</span>
                        )}
                      </div>
                    </td>
                    <td className="r num">{num(r.current.sessions)}</td>
                    <td className="r num">{num(r.current.transactions)}</td>
                    <td className="r num">{pct(r.current.purchaseRatePerSession)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > TOP && (
        <button type="button" className="more" onClick={() => setShowAll(!showAll)}>
          {showAll ? '收合' : `顯示全部（共 ${rows.length} 個來源）`}
        </button>
      )}
      {sources?.checkout_redirect_summary && (
        <p className="foot-note" style={{ marginTop: 10 }}>
          有 {num(sources.checkout_redirect_summary.transactions)} 筆成交被記在結帳／付款頁跳轉的來源，實際上屬於客人最初的來源（多半是廣告或自然搜尋）。
          GA4 設定「不需要的參照網址」後，新資料就不會再出現。
        </p>
      )}
      {all.length > 0 && (
        <div className="chips" style={{ marginTop: 12 }}>
          {mode === 'revenue' && rows[0] ? (
            <button type="button" onClick={() => onAsk(`營收最高的來源是「${rows[0].source_medium}」，各來源的營收和轉換率差異代表什麼？廣告來源為什麼幾乎沒有成交？`)}>問 AI：各來源的成交差異？</button>
          ) : compare ? (
            <button type="button" onClick={() => onAsk(`工作階段增加最多的來源「${all[0].source_medium}」帶來的流量品質如何？轉換率和其他來源比起來呢？`)}>問 AI：第一名來源的流量品質？</button>
          ) : null}
        </div>
      )}
    </section>
  );
}
