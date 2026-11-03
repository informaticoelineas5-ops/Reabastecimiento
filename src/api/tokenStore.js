const KEY = 'reab_jwt';

export const tokenStore = {
  get()      { try { return localStorage.getItem(KEY); }       catch { return null; } },
  set(token) { try { localStorage.setItem(KEY, token); }       catch {} },
  clear()    { try { localStorage.removeItem(KEY); }           catch {} },
};
