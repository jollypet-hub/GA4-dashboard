import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';
import logo from '../assets/jollypet-logo.svg';

const PRESETS = [
  { id: '7d', label: '近 7 天' },
  { id: '30d', label: '近 30 天' },
  { id: 'month', label: '本月' },
  { id: 'custom', label: '自訂' },
];

export default function Header({ me, range, onPreset, onCustom, compare, onCompare }) {
  const initial = (me?.email || '?').slice(0, 1).toUpperCase();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);

  // 點選單外面或按 Esc 關閉
  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => {
      if (e.type === 'keydown' ? e.key === 'Escape' : !menuRef.current?.contains(e.target)) setMenu(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menu]);

  const actions = (
    <>
      {me?.isAdmin && <a className="linkbtn" href="/admin">管理</a>}
      <form method="post" action="/dashboard/logout" style={{ margin: 0 }}>
        <button className="linkbtn" type="submit">登出</button>
      </form>
    </>
  );

  return (
    <header className="topbar">
      <div className="topbar-in">
        <div className="brand">
          <img className="logo" src={logo} alt="Jolly Pet" />
          <div className="brand-title">
            官網數據儀表板
            <small>GA4 資源 {me?.propertyId ?? '—'} · 台北時間 · 新台幣</small>
          </div>
        </div>

        <nav className="seg" aria-label="日期範圍">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" aria-pressed={range.preset === p.id} onClick={() => onPreset(p.id)}>
              {p.id === 'custom' && <Icon.Calendar />}
              {p.label}
            </button>
          ))}
        </nav>

        {range.preset === 'custom' && (
          <div className="custom-range">
            <label className="sr-only" htmlFor="start">開始日期</label>
            <input id="start" type="date" value={range.start} max={range.end} onChange={(e) => onCustom({ start: e.target.value, end: range.end })} />
            <span>至</span>
            <label className="sr-only" htmlFor="end">結束日期</label>
            <input id="end" type="date" value={range.end} min={range.start} max={me?.today} onChange={(e) => onCustom({ start: range.start, end: e.target.value })} />
          </div>
        )}

        <label className="check">
          <input type="checkbox" checked={compare} onChange={(e) => onCompare(e.target.checked)} />
          與前期比較
        </label>

        {/* 電腦版：完整顯示帳號與按鈕 */}
        <div className="user user-full">
          <span className="avatar">{initial}</span>
          <span>{me?.email}</span>
          {actions}
        </div>

        {/* 手機版：只顯示頭像，點開選單 */}
        <div className="user-compact" ref={menuRef}>
          <button type="button" className="avatar-btn" aria-haspopup="true" aria-expanded={menu} aria-label={`設定：${me?.email ?? ''}`} onClick={() => setMenu(!menu)}>
            <Icon.Gear />
          </button>
          {menu && (
            <div className="user-menu" role="menu">
              <span className="user-email">{me?.email}</span>
              {actions}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
