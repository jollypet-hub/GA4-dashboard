// 數字格式：新台幣、千分位、百分比、增減。

const nf = new Intl.NumberFormat('zh-TW');

export const num = (v) => (v === null || v === undefined ? '—' : nf.format(Math.round(v)));
export const twd = (v) => (v === null || v === undefined ? '—' : `NT$${nf.format(Math.round(v))}`);
// 小於 1% 的比率自動多顯示一位小數，避免 0.03% 被顯示成 0.0%
export const ratePct = (v) => (v === null || v === undefined ? '—' : pct(v, v > 0 && v < 0.01 ? 2 : 1));
export const pct = (v, digits = 2) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`);

// 百分比變化（後端已算好的 change_pct，單位是 %）
export function changeLabel(p) {
  if (p === null || p === undefined) return null;
  const up = p >= 0;
  const a = Math.abs(p);
  return { up, text: `${up ? '▲' : '▼'} ${nf.format(a >= 100 ? Math.round(a) : Math.round(a * 10) / 10)}%` };
}

// 比率的差距用百分點表示
export function pointLabel(cur, prev) {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return null;
  const d = (cur - prev) * 100;
  return { up: d >= 0, text: `${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(2)} pt` };
}

export const shortDate = (iso) => {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
};

export const DEVICE_NAMES = { mobile: '手機', desktop: '電腦', tablet: '平板', smart_tv: '電視' };
