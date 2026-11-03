import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";

function getLocalUser() {
  try { return JSON.parse(localStorage.getItem("reab_user") || "null"); } catch { return null; }
}

export function useProcurementUser() {
  // staleTime:0 + gcTime:0 ensures the cache never carries over a previous user's session.
  // initialData seeds from localStorage so the role is correct on the very first render,
  // while base44.auth.me() fires in the background to confirm/update it.
  const { data: user, isLoading } = useQuery({
    queryKey: ["current-user"],
    queryFn: () => base44.auth.me(),
    staleTime: 0,
    gcTime:    0,
    initialData: getLocalUser,
  });

  const role = user?.role;
  const isAdmin     = ["admin", "supervisor"].includes(role);
  const isComercial = role === "comercial";
  const isAnalista  = role === "analista";   // Inteligencia Comercial
  const isRevisor   = role === "revisor";

  // Builds filter for entity queries.
  // Comercial only sees their own records; everyone else sees all.
  const getOwnerFilter = () => {
    if (isAdmin || isAnalista || isRevisor || !user) return null;
    return { created_by: user.email };
  };

  return { user, isLoading, isAdmin, isComercial, isAnalista, isRevisor, getOwnerFilter };
}
