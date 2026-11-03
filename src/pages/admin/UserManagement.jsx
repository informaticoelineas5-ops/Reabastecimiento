import React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useProcurementUser } from "@/hooks/useProcurementUser";
import { Users, ShieldCheck, Info, Mail } from "lucide-react";

const ROLES = [
  { value: "admin",      label: "Admin",       desc: "Acceso total al sistema." },
  { value: "supervisor", label: "Supervisor",  desc: "Acceso amplio: compras, bodegones y catálogos." },
  { value: "comercial",  label: "Comercial",   desc: "Importa ofertas y genera pedidos de compra; solo ve y modifica los que él creó." },
  { value: "analista",   label: "Analista IC", desc: "Inteligencia Comercial: revisa y ajusta las cantidades de los pedidos; trabaja con Bodegones." },
  { value: "revisor",    label: "Revisor",     desc: "Aprueba los pedidos finales." },
  { value: "inventario", label: "Inventario",  desc: "Índices, ranking y catálogo; consulta de pedidos." },
  { value: "consulta",   label: "Consulta",    desc: "Solo lectura. Es el rol que recibe quien no tiene ninguno asignado en este sistema." },
];

const ROLE_COLORS = {
  admin:      "bg-red-100 text-red-700 border-red-200",
  supervisor: "bg-purple-100 text-purple-700 border-purple-200",
  comercial:  "bg-blue-100 text-blue-700 border-blue-200",
  analista:   "bg-violet-100 text-violet-700 border-violet-200",
  revisor:    "bg-amber-100 text-amber-700 border-amber-200",
  inventario: "bg-teal-100 text-teal-700 border-teal-200",
  consulta:   "bg-gray-100 text-gray-600 border-gray-200",
};

const roleLabel = (value) => ROLES.find(r => r.value === value)?.label ?? value;

export default function UserManagement() {
  const { user, isAdmin } = useProcurementUser();

  if (!isAdmin) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <ShieldCheck size={32} className="mx-auto mb-2 opacity-30" />
        <p className="text-sm">Esta sección es solo para administradores.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Users size={20} className="text-primary" />
          Usuarios
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Consulta de usuarios y roles de Reabastecimiento.
        </p>
      </div>

      <div className="flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/30 p-3 text-xs text-blue-800 dark:text-blue-300">
        <Info size={14} className="shrink-0 mt-0.5" />
        <span>
          Los usuarios, sus roles y sus permisos se crean y se modifican en <strong>Identity</strong>, no desde esta aplicación.
          Un cambio de rol hecho allí llega a las sesiones abiertas en menos de 30 segundos.
          Una persona sin ningún rol asignado para Reabastecimiento entra como <strong>Consulta</strong>.
        </span>
      </div>

      {/* Sesión actual */}
      <Card className="p-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Tu sesión</p>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
            {(user?.full_name || user?.email || "?").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{user?.full_name || "Sin nombre"}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 truncate">
              <Mail size={11} /> {user?.email ?? "—"}
            </p>
          </div>
          {user?.role && (
            <Badge variant="outline" className={`ml-auto text-xs ${ROLE_COLORS[user.role] ?? ""}`}>
              {roleLabel(user.role)}
            </Badge>
          )}
        </div>
      </Card>

      {/* Roles del sistema */}
      <Card className="p-0 overflow-hidden">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-4 pt-4 pb-2">Roles del sistema</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-border bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium w-40 select-text">Rol</th>
              <th className="px-4 py-2 font-medium select-text">Qué puede hacer</th>
            </tr>
          </thead>
          <tbody>
            {ROLES.map(r => (
              <tr key={r.value} className="border-b border-border/50 last:border-0">
                <td className="px-4 py-2.5">
                  <Badge variant="outline" className={`text-xs ${ROLE_COLORS[r.value] ?? ""}`}>{r.label}</Badge>
                </td>
                <td className="px-4 py-2.5 text-muted-foreground text-xs">{r.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
