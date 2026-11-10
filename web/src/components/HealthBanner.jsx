import { useState } from 'react';
import { Icon } from './Icons.jsx';

const LEVEL = { high: 0, medium: 1, low: 2 };

// 資料健康：有問題時放在最上方提醒，避免拿不完整的資料下結論
export default function HealthBanner({ health, onAsk }) {
  const [open, setOpen] = useState(false);
  if (!health || health.status === 'no_data') return null;
  const findings = [...(health.findings ?? [])].sort((a, b) => LEVEL[a.severity] - LEVEL[b.severity]);

  if (!findings.length) {
    return (
      <section className="banner ok" aria-label="資料健康">
        <div className="ico"><Icon.Check /></div>
        <div><strong>資料健康：沒有發現明顯問題</strong><span style={{ fontSize: 14 }}>關鍵電商事件都有紀錄，也沒有重複交易。</span></div>
      </section>
    );
  }

  const shown = open ? findings : findings.slice(0, 2);
  return (
    <section className="banner warn" aria-label="資料健康提醒">
      <div className="ico"><Icon.Warn /></div>
      <div style={{ flexGrow: 1 }}>
        <strong>資料健康：發現 {findings.length} 項需要檢查的問題</strong>
        <ul>
          {shown.map((f) => <li key={f.check}>{f.message}</li>)}
        </ul>
        {findings.length > 2 && (
          <button type="button" onClick={() => setOpen(!open)} style={{ marginLeft: 0, padding: '6px 0' }}>
            {open ? '收合' : `再看 ${findings.length - 2} 項`}
          </button>
        )}
      </div>
      <button type="button" onClick={() => onAsk('這段期間的資料健康檢查發現了哪些問題？會怎麼影響營收和轉換率的解讀？')}>問 AI 怎麼看</button>
    </section>
  );
}
