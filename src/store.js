// 狀態儲存：OAuth 用戶端、登入中狀態、授權碼、權杖、存取開關。
// 正式環境用 Firestore；本機測試可設 USE_MEMORY_STORE=1 使用記憶體版本（正式環境禁止）。
// 權杖與授權碼只存 SHA-256 雜湊，資料庫外洩也無法直接拿來用。

import { createHash, randomBytes } from 'node:crypto';

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// Firestore 讀回的時間是 Timestamp，記憶體版本是 Date；統一轉成毫秒
export function toMillis(v) {
  if (!v) return NaN;
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === 'function') return v.toMillis();
  return new Date(v).getTime();
}
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

const C = {
  clients: 'oauth_clients',
  pending: 'oauth_pending',
  codes: 'oauth_codes',
  tokens: 'oauth_tokens',
  settings: 'settings',
  users: 'allowed_users',
};
const ACCESS_DOC = 'access';

class FirestoreStore {
  constructor() {
    this.ready = import('@google-cloud/firestore').then(({ Firestore }) => {
      this.db = new Firestore({ ignoreUndefinedProperties: true });
    });
  }
  async col(name) {
    await this.ready;
    return this.db.collection(name);
  }
  async get(colName, id) {
    const snap = await (await this.col(colName)).doc(id).get();
    return snap.exists ? snap.data() : null;
  }
  async set(colName, id, data) {
    await (await this.col(colName)).doc(id).set(data);
  }
  async del(colName, id) {
    await (await this.col(colName)).doc(id).delete();
  }
  // 讀取後立即刪除（一次性使用），以交易確保不會被重複使用
  async take(colName, id) {
    const ref = (await this.col(colName)).doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      tx.delete(ref);
      return snap.data();
    });
  }
  async list(colName) {
    const snap = await (await this.col(colName)).limit(500).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  async deleteWhere(colName, field, value) {
    const col = await this.col(colName);
    let total = 0;
    for (;;) {
      const q = field ? col.where(field, '==', value) : col;
      const snap = await q.limit(400).get();
      if (snap.empty) return total;
      const batch = this.db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      total += snap.size;
    }
  }
}

class MemoryStore {
  constructor() {
    this.data = new Map();
  }
  m(c) {
    if (!this.data.has(c)) this.data.set(c, new Map());
    return this.data.get(c);
  }
  async get(c, id) {
    const v = this.m(c).get(id);
    return v ? structuredClone(v) : null;
  }
  async set(c, id, data) {
    this.m(c).set(id, structuredClone(data));
  }
  async del(c, id) {
    this.m(c).delete(id);
  }
  async take(c, id) {
    const v = await this.get(c, id);
    this.m(c).delete(id);
    return v;
  }
  async list(c) {
    return [...this.m(c).entries()].map(([id, v]) => ({ id, ...structuredClone(v) }));
  }
  async deleteWhere(c, field, value) {
    let n = 0;
    for (const [k, v] of this.m(c)) {
      if (!field || v[field] === value) {
        this.m(c).delete(k);
        n++;
      }
    }
    return n;
  }
}

export function createStore() {
  const useMemory = process.env.USE_MEMORY_STORE === '1';
  if (useMemory && process.env.NODE_ENV === 'production') {
    throw new Error('正式環境不可使用記憶體儲存');
  }
  const raw = useMemory ? new MemoryStore() : new FirestoreStore();
  const expiry = (sec) => new Date(Date.now() + sec * 1000);
  // 每筆有期限的資料都必須有 expireAt；缺少或已過期一律視為無效
  const alive = (doc) => !!doc && toMillis(doc.expireAt) > Date.now();

  return {
    kind: useMemory ? 'memory' : 'firestore',

    // OAuth 用戶端（Claude 動態註冊）
    getClient: (id) => raw.get(C.clients, id),
    saveClient: (client) => raw.set(C.clients, client.client_id, client),

    // Google 登入進行中的狀態
    savePending: (id, data, ttlSec) => raw.set(C.pending, id, { ...data, expireAt: expiry(ttlSec) }),
    takePending: async (id) => {
      const d = await raw.take(C.pending, id);
      return alive(d) ? d : null;
    },

    // 授權碼（一次性）
    saveCode: (code, data, ttlSec) => raw.set(C.codes, sha256(code), { ...data, expireAt: expiry(ttlSec) }),
    peekCode: async (code) => {
      const d = await raw.get(C.codes, sha256(code));
      return alive(d) ? d : null;
    },
    takeCode: async (code) => {
      const d = await raw.take(C.codes, sha256(code));
      return alive(d) ? d : null;
    },

    // 存取／更新權杖
    saveToken: (token, data, ttlSec) => raw.set(C.tokens, sha256(token), { ...data, expireAt: expiry(ttlSec) }),
    getToken: async (token) => {
      const d = await raw.get(C.tokens, sha256(token));
      return alive(d) ? d : null;
    },
    deleteToken: (token) => raw.del(C.tokens, sha256(token)),
    deleteGrant: (grantId) => raw.deleteWhere(C.tokens, 'grantId', grantId),
    deleteAllTokens: () => raw.deleteWhere(C.tokens, null, null),

    // 一般使用者白名單（管理員另外由環境變數設定）
    listUsers: async () => (await raw.list(C.users)).sort((a, b) => a.id.localeCompare(b.id)),
    getUser: (email) => raw.get(C.users, email),
    addUser: (email, by) => raw.set(C.users, email, { addedBy: by, addedAt: new Date().toISOString() }),
    removeUser: (email) => raw.del(C.users, email),
    deleteTokensByEmail: (email) => raw.deleteWhere(C.tokens, 'email', email),

    // 資料存取開關：沒有紀錄時視為「關閉」
    getAccessSwitch: async () => {
      const d = await raw.get(C.settings, ACCESS_DOC);
      return { enabled: d?.enabled === true, updatedAt: d?.updatedAt ?? null, updatedBy: d?.updatedBy ?? null };
    },
    setAccessSwitch: (enabled, email) =>
      raw.set(C.settings, ACCESS_DOC, { enabled: !!enabled, updatedAt: new Date().toISOString(), updatedBy: email }),
  };
}
