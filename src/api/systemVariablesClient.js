import { base44 } from './supabaseClient';
import { tokenStore } from './tokenStore';

const REAB_BASE = 'https://apireab.mercadoelineas.com/api/v1';

async function reabFetch(method, path, body) {
  const token = tokenStore.get();
  const res = await fetch(`${REAB_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`REAB ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

export async function getSystemVariables() {
  const res = await reabFetch('GET', '/system-variables?is_active=true&sortBy=label&pageSize=200');
  return res.data ?? [];
}

export async function updateSystemVariable(id, newValue) {
  await reabFetch('PATCH', `/system-variables/${id}`, { value: newValue });
}

export async function getActiveSuppliers() {
  const rows = await base44.entities.Supplier.filter({ is_active: true }, 'name', 1000);
  return rows.map(s => ({ id: s.id, name: s.name, code: s.code }));
}

export async function getSupplierOverridesForVariable(systemVariableId) {
  const res = await reabFetch('GET', `/supplier-variable-overrides?system_variable_id=${systemVariableId}&pageSize=1000`);
  return res.data ?? [];
}

export async function getOverridesForSupplier(supplierId) {
  const res = await reabFetch('GET', `/supplier-variable-overrides?supplier_id=${supplierId}&pageSize=1000`);
  return res.data ?? [];
}

export async function upsertSupplierOverride(supplierId, systemVariableId, value) {
  const check = await reabFetch('GET', `/supplier-variable-overrides?supplier_id=${supplierId}&system_variable_id=${systemVariableId}&pageSize=1`);
  const existing = check.data?.[0];
  if (existing) {
    await reabFetch('PATCH', `/supplier-variable-overrides/${existing.id}`, { value });
  } else {
    await reabFetch('POST', '/supplier-variable-overrides', { supplier_id: supplierId, system_variable_id: systemVariableId, value });
  }
}

export async function deleteSupplierOverride(id) {
  await reabFetch('DELETE', `/supplier-variable-overrides/${id}`);
}

export async function deleteAllOverridesForVariable(systemVariableId) {
  const res = await reabFetch('GET', `/supplier-variable-overrides?system_variable_id=${systemVariableId}&pageSize=1000`);
  const items = res.data ?? [];
  await Promise.all(items.map(item => reabFetch('DELETE', `/supplier-variable-overrides/${item.id}`)));
}

export async function deleteOverridesForSuppliers(systemVariableId, supplierIds) {
  if (!supplierIds?.length) return;
  const res = await reabFetch('GET', `/supplier-variable-overrides?system_variable_id=${systemVariableId}&supplier_id_in=${supplierIds.join(',')}&pageSize=1000`);
  const items = res.data ?? [];
  await Promise.all(items.map(item => reabFetch('DELETE', `/supplier-variable-overrides/${item.id}`)));
}
