import { tokenStore } from './tokenStore';

const AUTH_BASE = 'https://apiauth.mercadoelineas.com/api';

// Clave de servicio que se envía en el sign-in (viene de .env.local → VITE_SERVICE_KEY)
const SERVICE_KEY = import.meta.env.VITE_SERVICE_KEY?.trim();

// JWT de corta duración (5 min) — usado en todas las llamadas API
const elineasStore = {
  set(t) { try { localStorage.setItem('elineas_jwt', t); } catch {} },
  clear() { try { localStorage.removeItem('elineas_jwt'); } catch {} },
};

// Token de sesión (7 días) — usado solo para renovar el JWT
const SESSION_KEY = 'reab_session_token';
const sessionStore = {
  get()      { try { return localStorage.getItem(SESSION_KEY); }       catch { return null; } },
  set(token) { try { localStorage.setItem(SESSION_KEY, token); }       catch {} },
  clear()    { try { localStorage.removeItem(SESSION_KEY); }           catch {} },
};

export async function apiAuthLogin(email, password) {
  const res = await fetch(`${AUTH_BASE}/auth/sign-in`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...(SERVICE_KEY ? { 'x-service-key': SERVICE_KEY } : {}) },
    body:    JSON.stringify({ email, password, rememberMe: true }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Auth error ${res.status}`);
  }

  // Token de sesión (7 días) viene en el header
  const sessionToken = res.headers.get('set-auth-token');
  if (sessionToken) sessionStore.set(sessionToken);

  const json  = await res.json();
  const token = json.token;
  if (!token) throw new Error('El servidor de autenticación no devolvió un token');

  tokenStore.set(token);
  elineasStore.set(token);
  return json;
}

export function apiAuthClearTokens() {
  tokenStore.clear();
  elineasStore.clear();
  sessionStore.clear();
}

// Renueva el JWT usando el token de sesión (7 días).
// El JWT dura ~5 min; llamar cada 3 min.
let _refreshCount = 0;

export async function apiAuthRefreshToken() {
  const sessionToken = sessionStore.get();
  const callN = ++_refreshCount;
  const time  = new Date().toLocaleTimeString();

  if (!sessionToken) {
    // Sin session token: el usuario no ha hecho login o la sesión fue limpiada
    console.warn(`[auth-refresh #${callN} ${time}] Sin session token — skip`);
    return null;
  }

  try {
    const res  = await fetch(`${AUTH_BASE}/auth/token`, {
      method:  'GET',
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    const json = await res.json().catch(() => null);

    if (res.ok && json?.token) {
      tokenStore.set(json.token);
      elineasStore.set(json.token);
      return json.token;
    }
  } catch (e) {
    console.warn(`[auth-refresh #${callN}] error: ${e.message}`);
  }

  console.warn(`[auth-refresh #${callN}] ✗ refresh fallido`);
  return null;
}
