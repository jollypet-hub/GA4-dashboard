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
    err.status = res.status;
    throw err;
  }
  return body;
}

export const getMe = () => request('/api/dashboard/me');

export const getSummary = ({ start, end, compare }) =>
  request(`/api/dashboard/summary?${new URLSearchParams({ start, end, compare: compare ? '1' : '0' })}`);

export const newJobId = () => crypto.randomUUID().replace(/-/g, '');
export const getAiJob = (jobId) => request(`/api/dashboard/chat/${jobId}`);

// 送出問題；回答要等 20～60 秒，期間每 2 秒查一次進度。
// 手機切到別的 App 時連線可能被切斷（fetch 會失敗但沒有狀態碼），此時改靠查進度拿答案。
export function askAi({ messages, start, end, jobId, onStep }) {
  const post = request('/api/dashboard/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, start, end, jobId }),
  });
  return waitAiJob(jobId, { post, onStep });
}

export async function waitAiJob(jobId, { post, onStep, timeoutMs = 4 * 60 * 1000 } = {}) {
  let settled = null;
  let wake = () => {};
  post?.then(
    (value) => { settled = { ok: true, value }; wake(); },
    (error) => { if (error.status) { settled = { ok: false, error }; wake(); } },
  );
  const onVisible = () => document.visibilityState === 'visible' && wake();
  document.addEventListener('visibilitychange', onVisible);
  const started = Date.now();
  try {
    while (Date.now() - started < timeoutMs) {
      if (!settled) await new Promise((r) => { wake = r; setTimeout(r, 2000); });
      if (settled) {
        if (settled.ok) return settled.value;
        throw settled.error;
      }
      let job;
      try {
        job = await getAiJob(jobId);
      } catch (e) {
        if (!e.status) continue; // 網路暫時不通，下次再查
        if (e.status === 404 && Date.now() - started < 15000) continue; // 工作可能還沒建立
        throw e;
      }
      if (job.status === 'done') return job.result;
      if (job.status === 'error') throw new Error(job.message || 'AI 回答失敗，請再試一次。');
      onStep?.(job.step);
    }
    throw new Error('等太久了，請再問一次。');
  } finally {
    document.removeEventListener('visibilitychange', onVisible);
  }
}
