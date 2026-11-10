import { useCallback, useEffect, useState } from 'react';
import Header from './components/Header.jsx';
import HealthBanner from './components/HealthBanner.jsx';
import KpiCards from './components/KpiCards.jsx';
import TrendChart from './components/TrendChart.jsx';
import SourcesTable from './components/SourcesTable.jsx';
import DeviceChart from './components/DeviceChart.jsx';
import ChatPanel from './components/ChatPanel.jsx';
import { Icon } from './components/Icons.jsx';
import { getMe, getSummary } from './api.js';
import { shortDate } from './format.js';

const DAY = 86_400_000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

// 依台北的「今天」計算預設區間（不含今天，GA4 當天資料不完整）
function presetRange(preset, today) {
  const t = Date.parse(`${today}T00:00:00Z`);
  if (preset === '30d') return { start: iso(t - 30 * DAY), end: iso(t - DAY) };
  if (preset === 'month') {
    const first = `${today.slice(0, 8)}01`;
    return { start: first, end: first === today ? today : iso(t - DAY) };
  }
  return { start: iso(t - 7 * DAY), end: iso(t - DAY) };
}

export default function App() {
  const [me, setMe] = useState(null);
  const [range, setRange] = useState(null);
  const [compare, setCompare] = useState(true);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [pending, setPending] = useState(null);

  useEffect(() => {
    getMe()
      .then((m) => {
        setMe(m);
        setRange({ preset: '7d', ...presetRange('7d', m.today) });
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!range?.start || !range?.end || range.start > range.end) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSummary({ start: range.start, end: range.end, compare })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range?.start, range?.end, compare]);

  const ask = useCallback((q) => {
    setPending(q);
    setChatOpen(true);
  }, []);

  const ov = data?.overview;
  return (
    <>
      {me && range && (
        <Header
          me={me}
          range={range}
          compare={compare}
          onCompare={setCompare}
          onPreset={(p) => setRange(p === 'custom' ? { ...range, preset: 'custom' } : { preset: p, ...presetRange(p, me.today) })}
          onCustom={(r) => setRange({ preset: 'custom', ...r })}
        />
      )}

      <main>
        {range && (
          <div className="period">
            <h1 className="num">
              {shortDate(range.start)} – {shortDate(range.end)}
              {compare && ov?.comparison_period && <span>對比 {shortDate(ov.comparison_period.startDate)} – {shortDate(ov.comparison_period.endDate)}</span>}
            </h1>
            <div className="stamp">
              {data?.generatedAt && `資料更新：${new Date(data.generatedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}`}
              {' · GA4 通常延遲 24–48 小時'}
            </div>
          </div>
        )}

        {error && <div className="error" role="alert">無法載入資料：{error}</div>}

        {loading && !data ? (
          <>
            <div className="skeleton" style={{ height: 72 }} />
            <div className="kpis">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton" style={{ height: 128 }} />)}</div>
            <div className="skeleton" style={{ height: 340 }} />
          </>
        ) : (
          data && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, opacity: loading ? 0.55 : 1, transition: 'opacity .2s' }}>
              <HealthBanner health={data.health} onAsk={ask} />
              <KpiCards overview={ov} compare={compare} />
              <TrendChart trend={data.trend} compare={compare} />
              <div className="row">
                <SourcesTable sources={data.sources} compare={compare} onAsk={ask} />
                <DeviceChart devices={data.devices} />
              </div>
              <p className="foot-note">
                口徑：購買營收＝purchase 事件營收；客單價＝購買營收 ÷ 交易筆數；購買轉換率＝交易筆數 ÷ 工作階段（工作階段口徑）。
                GA4 受 Cookie 同意與追蹤阻擋影響，與 Cyberbiz 訂單數可能不同。
              </p>
            </div>
          )
        )}
      </main>

      {!chatOpen && me && (
        <button type="button" className="fab" onClick={() => setChatOpen(true)} title={me.aiEnabled ? '' : 'AI 資料存取開關目前關閉'}>
          <Icon.Chat />問 AI
        </button>
      )}
      {me && range && (
        <ChatPanel
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          aiEnabled={me.aiEnabled}
          range={range}
          pending={pending}
          onPendingUsed={() => setPending(null)}
        />
      )}
    </>
  );
}
