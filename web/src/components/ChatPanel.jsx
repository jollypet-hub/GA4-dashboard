import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icons.jsx';
import { askAi } from '../api.js';
import { shortDate } from '../format.js';

const TOOL_NAMES = {
  ga4_overview: '經營總覽',
  ga4_traffic_sources: '流量來源',
  ga4_devices: '裝置比較',
  ga4_products: '商品表現',
  ga4_funnel: '購買流程',
  ga4_data_health: '資料健康',
};

const SUGGESTIONS = ['這段期間營收變化的主要原因是什麼？', '哪個流量來源帶來最多成交？', '手機和電腦的轉換率差多少？', '跑一次資料健康檢查'];

// 只支援粗體與條列，所有內容都以文字節點呈現，不插入 HTML
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}
function RichText({ text }) {
  const blocks = text.split(/\n{2,}/);
  return blocks.map((block, bi) => {
    const lines = block.split('\n').filter((l) => l.trim());
    const isList = lines.length && lines.every((l) => /^\s*([-•*]|\d+[.、])\s+/.test(l));
    if (isList) {
      return (
        <ul key={bi}>
          {lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*([-•*]|\d+[.、])\s+/, ''))}</li>)}
        </ul>
      );
    }
    return <p key={bi}>{lines.map((l, li) => <span key={li}>{li > 0 && <br />}{inline(l.replace(/^#+\s*/, ''))}</span>)}</p>;
  });
}

export default function ChatPanel({ open, onClose, aiEnabled, range, pending, onPendingUsed }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send(text) {
    const q = text.trim();
    if (!q || busy || !aiEnabled) return;
    const next = [...messages, { role: 'user', content: q }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const history = next.filter((m) => m.role === 'user' || m.role === 'assistant').map(({ role, content }) => ({ role, content }));
      const out = await askAi({ messages: history, start: range.start, end: range.end });
      setMessages([...next, { role: 'assistant', content: out.reply, tools: out.tools, provider: out.provider }]);
    } catch (err) {
      setMessages([...next, { role: 'error', content: err.message }]);
    } finally {
      setBusy(false);
    }
  }

  // 從儀表板其他地方帶進來的問題（例如「問 AI 怎麼看」）
  useEffect(() => {
    if (open && pending) {
      onPendingUsed();
      send(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pending]);

  if (!open) return null;
  return (
    <aside className="chat" aria-label="問 AI">
      <div className="chat-head">
        <div className="chat-title">
          <span className="mark"><Icon.Spark /></span>
          <div className="t"><b>問 AI</b><span>依目前畫面：{shortDate(range.start)} – {shortDate(range.end)}</span></div>
          <button type="button" className="iconbtn" aria-label="關閉" onClick={onClose}><Icon.Close /></button>
        </div>
        <div className={`status ${aiEnabled ? 'on' : 'off'}`}><i />AI 資料存取：{aiEnabled ? '開啟中' : '已關閉'}</div>
      </div>

      <div className="chat-body" ref={bodyRef}>
        {!aiEnabled && <div className="msg-err">AI 資料存取開關目前關閉，暫時不能提問。請聯絡管理員到管理頁開啟。</div>}
        {aiEnabled && messages.length === 0 && (
          <div className="msg-ai">
            <p>你好！我會讀取這段期間的 GA4 數據來回答，並區分<strong>數據顯示的事實</strong>與<strong>推測的原因</strong>。可以從下面的問題開始：</p>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="msg-user">{m.content}</div>
          ) : m.role === 'error' ? (
            <div key={i} className="msg-err">{m.content}</div>
          ) : (
            <div key={i} className="msg-ai">
              <RichText text={m.content} />
              {m.tools?.length > 0 && (
                <div className="msg-tools">
                  {m.tools.map((t, ti) => (
                    <span key={ti}>查詢：{TOOL_NAMES[t.name] ?? t.name}{t.start_date ? ` ${shortDate(t.start_date)}–${shortDate(t.end_date)}` : ''}</span>
                  ))}
                </div>
              )}
              {m.provider === 'gemini' && <div className="msg-provider">本次由 Gemini 回答（Claude 暫時無法使用）</div>}
            </div>
          ),
        )}
        {busy && <div className="typing" aria-label="AI 正在查詢資料"><i /><i /><i /></div>}
        {aiEnabled && !busy && (
          <div className="chips">
            {SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => send(s)}>{s}</button>)}
          </div>
        )}
      </div>

      <form className="chat-form" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <div className="line">
          <label htmlFor="ask" className="sr-only">輸入問題</label>
          <textarea
            id="ask"
            ref={inputRef}
            rows={1}
            value={input}
            disabled={!aiEnabled}
            placeholder={aiEnabled ? '問問這段期間的數據…' : 'AI 目前關閉'}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
          />
          <button className="send" type="submit" aria-label="送出" disabled={!aiEnabled || busy || !input.trim()}><Icon.Send /></button>
        </div>
        <small>AI 只讀 GA4 彙總數據，數字以畫面為準。Enter 送出，Shift + Enter 換行。</small>
      </form>
    </aside>
  );
}
