// 後端 API。未登入（401）時導回登入頁。

async function request(path, init) {
  const res = await fetch(path, { credentials: 'same-origin', ...init });
  if (res.status === 401) {
    window.location.href = '/dashboard/login';
    throw new Error('需要登入');
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* 非 JSON 回應 */
  }
  if (!res.ok) {
    const err = new Error(body?.message || `連線失敗（${res.status}）`);
    err.code = body?.error;
    throw err;
  }
  return body;
}

export const getMe = () => request('/api/dashboard/me');

export const getSummary = ({ start, end, compare }) =>
  request(`/api/dashboard/summary?${new URLSearchParams({ start, end, compare: compare ? '1' : '0' })}`);

export const askAi = ({ messages, start, end }) =>
  request('/api/dashboard/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, start, end }),
  });
