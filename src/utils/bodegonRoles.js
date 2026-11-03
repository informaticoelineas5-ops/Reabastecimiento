// Roles de Reab. Bodegones. La propuesta de bodegones la ve y la ejecuta SOLO el cardista (y admin/supervisor);
// el cardista, a su vez, no ve nada de Reab. normal. Analista, revisor, comercial, etc. trabajan en Reab. normal.
export const BODEGONES = ["1053", "1201", "1882", "1883"];

// Roles que dan acceso a Reab. normal. Un usuario que solo es cardista queda limitado a la propuesta de bodegones.
const ROLES_REAB_NORMAL = ["admin", "supervisor", "comercial", "analista", "revisor", "inventario", "consulta"];

/** Nombres de rol del usuario (en minúsculas), sea cual sea la forma en que lleguen. */
export function userRoles(user) {
  const list = Array.isArray(user?.roles) && user.roles.length ? user.roles : [user?.role];
  return list.filter(Boolean).map(r => String(r).toLowerCase());
}

/** Qué es el usuario en la propuesta de bodegones. */
export function roleInfo(user) {
  const roles = userRoles(user);
  const isAdmin = roles.some(r => r === "admin" || r === "supervisor");
  const isCardista = roles.includes("cardista");
  return { roles, isAdmin, isCardista };
}

/** true si el usuario puede ver la propuesta de bodegones. */
export const puedeVerBodegones = (user) => { const r = roleInfo(user); return r.isAdmin || r.isCardista; };

/** true si el usuario es cardista y nada más: solo ve la propuesta de bodegones. */
export function esSoloCardista(user) {
  const roles = userRoles(user);
  return roles.includes("cardista") && !roles.some(r => ROLES_REAB_NORMAL.includes(r));
}
