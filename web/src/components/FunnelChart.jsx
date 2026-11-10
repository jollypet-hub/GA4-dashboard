import { Icon } from './Icons.jsx';
import { num, pct } from '../format.js';

const STEP_NAMES = ['瀏覽商品', '加入購物車', '開始結帳', '完成購買'];
const COLORS = ['var(--brand-taupe)', '#B8A88E', 'var(--teal)', 'var(--brand-sage-ink)'];

// 支援兩種資料：封閉式漏斗（逐步使用者）與事件人數（漏斗 API 無法使用時）
function toSteps(funnel) {
  if (funnel?.method === 'funnel') {
    return funnel.steps.map((s, i) => ({ name: s.step || STEP_NAMES[i], users: s.active_users ?? 0 }));
  }
  if (funnel?.method === 'event_totals_fallback') {
    return funnel.events.map((e) => ({ name: e.step, users: e.users ?? 0 }));
  }
  return [];
}

export default function FunnelChart({ funnel, onAsk }) {
  const steps = toSteps(funnel);
  const strict = funnel?.method === 'funnel';
  const max = Math.max(1, steps[0]?.users ?? 0, ...steps.map((s) => s.users));

  // 找出流失最多的一步
  let worst = -1;
  let worstRate = -1;
  steps.forEach((s, i) => {
    if (i === 0 || !steps[i - 1].users) return;
    const drop = 1 - s.users / steps[i - 1].users;
    if (drop > worstRate) {
      worstRate = drop;
      worst = i;
    }
  });

  return (
    <section className="card grow" aria-label="購買流程">
      <h2><Icon.Funnel style={{ color: 'var(--teal-ink)' }} />購買流程</h2>
      <p className="hint">{strict ? '依序完成每一步的人數（同一個人要先完成上一步）' : '各步驟的觸發人數（不是逐步追蹤，僅供參考）'}</p>
      {steps.length === 0 || !steps[0].users ? (
        <div className="empty">這段期間沒有購買流程資料</div>
      ) : (
        <>
          <ol className="funnel">
            {steps.map((s, i) => {
              const rate = i > 0 && steps[i - 1].users ? s.users / steps[i - 1].users : null;
              return (
                <li key={s.name}>
                  {i > 0 && (
                    <div className={`fn-rate ${i === worst ? 'worst' : ''}`}>
                      ↓ {rate === null ? '—' : pct(rate, 1)} 繼續{i === worst && <b>流失最多</b>}
                    </div>
                  )}
                  <div className="fn-row">
                    <span className="fn-name">{s.name}</span>
                    <span className="fn-bar"><i style={{ width: `${Math.max(1.5, (s.users / max) * 100)}%`, background: COLORS[i % COLORS.length] }} /></span>
                    <span className="fn-val num">{num(s.users)} 人</span>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="foot-note">從瀏覽商品到完成購買：{pct(steps.at(-1).users / steps[0].users, 2)}</p>
          {worst > 0 && (
            <div className="chips" style={{ marginTop: 12 }}>
              <button type="button" onClick={() => onAsk(`購買流程中「${steps[worst - 1].name} → ${steps[worst].name}」流失最多，可能的原因和改善方向是什麼？`)}>
                問 AI：為什麼卡在「{steps[worst].name}」？
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
