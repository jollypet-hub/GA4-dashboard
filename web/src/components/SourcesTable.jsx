import { Icon } from './Icons.jsx';
import { num, pct } from '../format.js';

const COLORS = ['var(--blue)', 'var(--teal)', 'var(--accent)', 'var(--purple)', '#E5674B', '#5B8DEF', '#98A2B3', '#C2A35A'];

export default function SourcesTable({ sources, compare, onAsk }) {
  const rows = sources?.rows ?? [];
  const measure = (r) => (compare ? Math.abs(r.sessions_change ?? 0) : r.current.sessions ?? 0);
  const max = Math.max(1, ...rows.map(measure));

  return (
    <section className="card grow" aria-label="流量來源">
      <h2><Icon.Share style={{ color: 'var(--teal-ink)' }} />流量來源</h2>
      <p className="hint">{compare ? '依「工作階段增減」排序，最上面就是帶動變化最多的來源' : '依工作階段數排序'}</p>
      {rows.length === 0 ? (
        <div className="empty">這段期間沒有來源資料</div>
      ) : (
        <div className="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>來源 / 媒介</th>
                <th>{compare ? '工作階段增減' : '工作階段'}</th>
                <th className="r">工作階段</th>
                <th className="r">交易</th>
                <th className="r">轉換率</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const change = r.sessions_change ?? 0;
                const up = change >= 0;
                const color = compare ? (up ? COLORS[i % COLORS.length] : 'var(--red)') : COLORS[i % COLORS.length];
                return (
                  <tr key={r.source_medium}>
                    <td><div className="src" title={r.source_medium}><span className="dot" style={{ background: COLORS[i % COLORS.length] }} />{r.source_medium}</div></td>
                    <td>
                      <div className="bar-cell">
                        <div className="bar" style={{ width: `${Math.max(4, (measure(r) / max) * 140)}px`, background: color }} />
                        {compare ? (
                          <span className={`num ${up ? 'chg-up' : 'chg-down'}`}>{up ? '▲' : '▼'} {num(Math.abs(change))}</span>
                        ) : (
                          <span className="num">{num(r.current.sessions)}</span>
                        )}
                        {compare && r.share_of_sessions_change !== null && r.share_of_sessions_change !== undefined && (
                          <span style={{ fontSize: 12, color: 'var(--muted)' }}>占 {Math.round(r.share_of_sessions_change * 100)}%</span>
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
      {rows.length > 0 && compare && (
        <div className="chips" style={{ marginTop: 12 }}>
          <button type="button" onClick={() => onAsk(`工作階段增加最多的來源「${rows[0].source_medium}」帶來的流量品質如何？轉換率和其他來源比起來呢？`)}>問 AI：第一名來源的流量品質？</button>
        </div>
      )}
    </section>
  );
}
