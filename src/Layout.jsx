import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import {
  LayoutDashboard,
  Package,
  Upload,
  AlertTriangle,
  History,
  ChevronLeft,
  ChevronRight,
  Moon,
  Sun,
  LogOut,
  Menu,
  X,
  ShieldCheck,
  BarChart3,
  ShoppingBag,
  Truck,
  ClipboardList,
  Building2,
  TrendingUp
} from "lucide-react";
import { Button } from "@/components/ui/button";

const navItems = [
  { name: "Dashboard", page: "Dashboard", icon: LayoutDashboard },
  { name: "Catálogo", page: "Catalog", icon: Package },
  { name: "Alertas", page: "Alerts", icon: AlertTriangle },
  { name: "Historial", page: "History", icon: History },
  { name: "Análisis Comparativo", page: "ComparativeAnalysis", icon: BarChart3 },
  { name: "Índices de Ventas", page: "SalesIndexImport", icon: TrendingUp, roles: ["admin", "inventario"] },
  { name: "Ranking Ventas", page: "SalesRanking", icon: TrendingUp, roles: ["admin", "supervisor", "comercial", "inventario"] },
  { name: "── Reabastecimiento ──", page: null, icon: null, isSeparator: true },
  { name: "Panel Compras", page: "procurement/ProcurementDashboard", icon: ShoppingBag, roles: ["admin", "supervisor", "comercial"] },
  { name: "Ofertas Proveedor", page: "procurement/SupplierOffers", icon: Truck, roles: ["admin", "supervisor", "comercial"] },
  { name: "Pedidos de Compra", page: "procurement/PurchaseOrders", icon: ClipboardList, roles: ["admin", "supervisor", "comercial"] },
  { name: "Proveedores", page: "procurement/Suppliers", icon: Building2, roles: ["admin", "supervisor"] },
];

export default function Layout({ children, currentPageName }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [user, setUser] = useState(() => {
    try {
      const cached = localStorage.getItem("reab_user");
      return cached ? JSON.parse(cached) : null;
    } catch { return null; }
  });

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      try { localStorage.setItem("reab_user", JSON.stringify(u)); } catch {}
    }).catch(() => {});
    const saved = localStorage.getItem("theme");
    if (saved === "dark") {
      setDark(true);
      document.documentElement.classList.add("dark");
    }
  }, []);

  const toggleTheme = () => {
    setDark(!dark);
    if (!dark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  };

  const userRole = user?.role || "consulta";
  const filteredNav = navItems.filter(
    (item) => !item.roles || item.roles.includes(userRole) || userRole === "admin"
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-foreground/30 z-40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-50
          flex flex-col bg-sidebar-background text-sidebar-foreground
          transition-all duration-300 ease-in-out
          ${collapsed ? "w-[68px]" : "w-[240px]"}
          ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-16 border-b border-sidebar-accent">
          <div className="h-8 w-8 rounded-lg bg-sidebar-primary flex items-center justify-center flex-shrink-0">
            <BarChart3 className="h-4 w-4 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <h1 className="text-sm font-bold tracking-tight truncate">Control Inventario</h1>
              <p className="text-[10px] text-sidebar-foreground/60">Ventas Online</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
          {filteredNav.map((item) => {
          if (item.isSeparator) {
            return !collapsed ? (
              <div key={item.name} className="px-3 pt-3 pb-1">
                <p className="text-[9px] font-bold uppercase tracking-widest text-sidebar-foreground/30">{item.name.replace(/──\s?/g, '').trim()}</p>
              </div>
            ) : <div key={item.name} className="border-t border-sidebar-accent my-2" />;
          }
          const isActive = currentPageName === item.page;
          return (
            <Link
              key={item.page}
              to={createPageUrl(item.page)}
              onClick={() => setMobileOpen(false)}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                transition-all duration-150
                ${isActive
                  ? "bg-sidebar-primary text-primary-foreground shadow-lg shadow-sidebar-primary/25 border-l-[3px] border-white/70"
                  : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                }
              `}
            >
              <item.icon className="h-4.5 w-4.5 flex-shrink-0" size={18} />
              {!collapsed && <span className="truncate">{item.name}</span>}
            </Link>
          );
        })}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-sidebar-accent space-y-2">
          <button
            onClick={toggleTheme}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
            {!collapsed && <span>{dark ? "Modo Claro" : "Modo Oscuro"}</span>}
          </button>
          {user && (
            <div className={`flex items-center gap-2 px-3 py-2 ${collapsed ? "justify-center" : ""}`}>
              <div className="h-7 w-7 rounded-full bg-sidebar-primary/20 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-sidebar-primary">
                  {user.full_name?.[0] || user.email?.[0] || "U"}
                </span>
              </div>
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium truncate">{user.full_name || user.email}</p>
                  <p className="text-[10px] text-sidebar-foreground/50 flex items-center gap-1">
                    <ShieldCheck size={10} /> {userRole}
                  </p>
                </div>
              )}
              <button
                onClick={() => base44.auth.logout()}
                title="Cerrar sesión"
                className="flex-shrink-0 p-1 rounded text-sidebar-foreground/40 hover:text-destructive hover:bg-sidebar-accent transition-colors"
              >
                <LogOut size={14} />
              </button>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="hidden lg:flex items-center justify-center w-full py-1.5 rounded-lg text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar mobile */}
        <header className="lg:hidden flex items-center justify-between h-14 px-4 border-b border-border bg-card">
          <button onClick={() => setMobileOpen(true)}>
            <Menu size={20} />
          </button>
          <h1 className="text-sm font-bold">Control de Inventario</h1>
          <div className="w-5" />
        </header>
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}