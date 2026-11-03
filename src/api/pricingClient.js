import { supabase } from './supabaseClient';

// NOTE: The parameter name here ('supplier_id') must match the SQL function signature.
// If Supabase returns an error, ask the specialist to confirm the parameter name.
export async function getSupplierPricing(supplierId) {
  const { data, error } = await supabase
    .rpc('get_offer_item_pricing', { supplier_id: supplierId });
  if (error) throw error;
  return data ?? [];
}
