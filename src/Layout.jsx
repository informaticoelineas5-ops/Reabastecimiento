import React, { useState, useEffect, useRef } from "react";
import WhatsNewModal from "@/components/WhatsNewModal";
import { CURRENT_VERSION } from "@/data/changelog";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { userRoles, esSoloCardista, puedeVerBodegones } from "@/utils/bodegonRoles";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Package,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Moon,
  Sun,
  LogOut,
  BookOpen,
  Menu,
  ShieldCheck,
  RefreshCw,
  ShoppingBag,
  CheckCircle,
  Truck,
  ClipboardList,
  Building2,
  TrendingUp,
  Users,
  Bell,
  ChevronDown,
  X,
  Settings2,
  PackageX,
  CalendarDays,
  Warehouse,
  ArrowRightLeft,
  ClipboardCheck,
  Store,
} from "lucide-react";

const navItems = [
  { name: "Dashboard",            page: "Dashboard",                         icon: LayoutDashboard },
  { name: "Catálogo",             page: "Catalog",                           icon: Package },
  { name: "Alertas",              page: "Alerts",                            icon: AlertTriangle },
  { name: "Índices de Ventas",    page: "SalesIndexImport",                  icon: TrendingUp,    roles: ["admin", "inventario", "comercial"] },
  { name: "Ranking Ventas",       page: "SalesRanking",                      icon: TrendingUp,    roles: ["admin", "supervisor", "comercial", "inventario"] },
  { name: "── Reabastecimiento ──", page: null, icon: null, isSeparator: true },
  { name: "Panel Compras",        page: "procurement/ProcurementDashboard",  icon: ShoppingBag,   roles: ["admin", "supervisor", "comercial", "analista", "revisor"] },
  { name: "Agenda",               page: "procurement/Agenda",                icon: CalendarDays,  roles: ["admin", "supervisor", "comercial", "analista", "revisor"] },
  { name: "Ofertas Proveedor",    page: "procurement/SupplierOffers",        icon: Truck,         roles: ["admin", "supervisor", "comercial", "analista", "revisor"] },
  { name: "Pedidos de Compra",    page: "procurement/PurchaseOrders",        icon: ClipboardList, roles: ["admin", "supervisor", "comercial", "analista", "revisor", "inventario"] },
  { name: "Reab. Directo",       page: "procurement/DirectReplenishment",   icon: PackageX,      roles: ["admin", "supervisor", "comercial", "analista", "revisor"] },
  { name: "Proveedores",          page: "procurement/Suppliers",             icon: Building2,     roles: ["admin", "supervisor", "comercial", "analista", "revisor"] },
  { name: "── Reab. Bodegones ──", page: null, icon: null, isSeparator: true, roles: ["admin", "supervisor", "analista", "revisor", "cardista"] },
  { name: "Propuesta Bodegones",  page: "bodegones/Propuesta",    icon: Warehouse,       roles: ["admin", "supervisor", "cardista"] },
  { name: "Distribución Externos",       page: "bodegones/Distribucion", icon: ArrowRightLeft,  roles: ["admin", "supervisor", "analista", "revisor"] },
  { name: "Proveedores Bodegón",  page: "bodegones/ProveedoresBodegon", icon: Building2, roles: ["admin", "supervisor", "analista"] },
  { name: "U/C Pendientes",       page: "bodegones/UCPendientes", icon: ClipboardCheck,  roles: ["admin", "supervisor", "analista", "inventario"] },
  { name: "── Reab. FF ──",       page: null, icon: null, isSeparator: true, roles: ["admin", "supervisor", "analista", "revisor"] },
  { name: "Propuesta FF",         page: "ff/Propuesta",           icon: Store,           roles: ["admin", "supervisor", "analista", "revisor"] },
  { name: "── Admin ──",          page: null, icon: null, isSeparator: true, roles: ["admin"] },
  { name: "Variables de Precios", page: "procurement/VariablesGlobales",     icon: Settings2,     roles: ["admin", "supervisor"] },
  { name: "Usuarios",             page: "admin/UserManagement",              icon: Users,         roles: ["admin"] },
];

const PAGE_NAMES = {
  Dashboard:                          "Dashboard",
  Catalog:                            "Catálogo",
  Alerts:                             "Alertas",
  SalesIndexImport:                   "Índices de Ventas",
  SalesRanking:                       "Ranking de Ventas",
  "procurement/ProcurementDashboard": "Panel Compras",
  "procurement/Agenda":               "Agenda de Reabastecimiento",
  "procurement/SupplierOffers":       "Ofertas Proveedor",
  "procurement/SupplierOfferDetail":  "Detalle de Oferta",
  "procurement/PurchaseOrders":       "Pedidos de Compra",
  "procurement/PurchaseOrderDetail":  "Detalle de Pedido",
  "procurement/Suppliers":            "Proveedores",
  "admin/UserManagement":             "Usuarios",
  "procurement/VariablesGlobales":    "Variables Globales de Precios",
  "procurement/DirectReplenishment":  "Reabastecimiento Directo",
  "bodegones/Propuesta":              "Propuesta Bodegones",
  "bodegones/Distribucion":           "Distribución Externos",
  "bodegones/ProveedoresBodegon":     "Proveedores Bodegón",
  "bodegones/UCPendientes":           "Productos sin U/C",
  "ff/Propuesta":                     "Propuesta FF",
  ImportConfig:                       "Importación",
  Connectors:                         "Conectores",
};

const ROLE_LABELS = {
  admin:      "Administrador",
  supervisor: "Supervisor",
  comercial:  "Comercial",
  analista:   "Analista IC",
  revisor:    "Revisor",
  inventario: "Inventario",
  consulta:   "Consulta",
};


export default function Layout({ children, currentPageName }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { logout: authLogout } = useAuth();
  const [collapsed,    setCollapsed]    = useState(false);
  const [mobileOpen,  setMobileOpen]   = useState(false);
  const [dark,        setDark]         = useState(false);
  const [user,        setUser]         = useState(() => {
    try { return JSON.parse(localStorage.getItem("reab_user") || "null"); } catch { return null; }
  });

  // WhatsNew modal
  const [showWhatsNew, setShowWhatsNew] = useState(false);
  useEffect(() => {
    const key = `reab_changelog_seen_v${CURRENT_VERSION}`;
    if (!localStorage.getItem(key)) {
      const t = setTimeout(() => setShowWhatsNew(true), 800);
      return () => clearTimeout(t);
    }
  }, []);
  const handleCloseWhatsNew = () => {
    localStorage.setItem(`reab_changelog_seen_v${CURRENT_VERSION}`, "1");
    setShowWhatsNew(false);
  };

  // Notifications
  const [notifOpen,     setNotifOpen]     = useState(false);
  const [userMenuOpen,  setUserMenuOpen]  = useState(false);
  const notifRef    = useRef(null);
  const userMenuRef = useRef(null);

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

  const userRole = user?.role || "consulta";

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = e => {
      if (notifRef.current    && !notifRef.current.contains(e.target))    setNotifOpen(false);
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggleTheme = () => {
    setDark(d => {
      const next = !d;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("theme", next ? "dark" : "light");
      return next;
    });
  };

  const myNavRoles = userRoles(user);
  // El cardista no ve nada de Reab. normal: solo lo que lista explícitamente su rol
  const soloCardista = esSoloCardista(user);
  const filteredNav = navItems.filter(item => soloCardista
    ? item.roles?.includes("cardista")
    : !item.roles || item.roles.some(r => myNavRoles.includes(r)) || userRole === "admin");

  // Acceso directo por URL: el cardista solo entra a su propuesta, y la propuesta de bodegones solo la ven cardista/admin
  const bloqueada = !!user && (
    (soloCardista && currentPageName !== "bodegones/Propuesta") ||
    (currentPageName === "bodegones/Propuesta" && !puedeVerBodegones(user))
  );
  useEffect(() => {
    if (bloqueada) navigate(soloCardista ? "/bodegones/Propuesta" : "/", { replace: true });
  }, [bloqueada, soloCardista, navigate]);

  // Comercial: pedidos aprobados pendientes de notificar.
  // Filtramos solo por approval_status en la API para evitar discrepancias de case o
  // columnas opcionales; el resto se filtra en JS via select.
  const { data: approvedOrders = [] } = useQuery({
    queryKey: ["approved-orders-notif", user?.email],
    queryFn: () => base44.entities.PurchaseOrder.filter(
      { approval_status: "approved" },
      null,
      100,
    ),
    select: orders => orders.filter(o =>
      !o.comercial_notified &&
      o.created_by?.toLowerCase() === user?.email?.toLowerCase()
    ),
    enabled: userRole === "comercial" && !!user?.email,
    refetchInterval: 30_000,
  });

  // Analista IC: pedidos esperando revisión IC
  const { data: pendingIcOrders = [] } = useQuery({
    queryKey: ["pending-ic-orders-notif"],
    queryFn: () => base44.entities.PurchaseOrder.filter({ approval_status: "pending_ic" }, null, 20),
    enabled: userRole === "analista",
    refetchInterval: 30_000,
  });

  // Revisor: pedidos esperando aprobación final
  const { data: pendingReviewOrders = [] } = useQuery({
    queryKey: ["pending-review-orders-notif"],
    queryFn: () => base44.entities.PurchaseOrder.filter({ approval_status: "pending_review" }, null, 20),
    enabled: userRole === "revisor",
    refetchInterval: 30_000,
  });

  const markOrderNotified = async (orderId) => {
    try {
      await base44.entities.PurchaseOrder.update(orderId, { comercial_notified: true });
      queryClient.invalidateQueries({ queryKey: ["approved-orders-notif", user?.email] });
    } catch {}
  };

  const unreadCount = approvedOrders.length + pendingIcOrders.length + pendingReviewOrders.length;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-foreground/40 backdrop-blur-sm z-40 lg:hidden animate-in fade-in-0 duration-200"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Sidebar ─────────────────────────────────────── */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50
        flex flex-col bg-sidebar-background dark:bg-gradient-to-b dark:from-sidebar-background dark:via-sidebar-background dark:to-sidebar-accent/40 text-sidebar-foreground
        shadow-2xl shadow-black/30 transition-all duration-300 ease-in-out
        ${collapsed  ? "w-[68px]"  : "w-[240px]"}
        ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
      `}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 h-16 border-b border-sidebar-accent">
          <div className="group/logo h-8 w-8 rounded-lg bg-gradient-to-br from-sidebar-primary to-accent shadow-lg shadow-sidebar-primary/40 flex items-center justify-center flex-shrink-0 transition-transform duration-300 hover:scale-110 hover:rotate-6">
            <RefreshCw className="h-4 w-4 text-primary-foreground transition-transform duration-700 group-hover/logo:rotate-180" />
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <h1 className="text-sm font-bold tracking-tight truncate">ELINEAS</h1>
              <p className="text-[10px] text-sidebar-foreground/60">Reabastecimiento</p>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto stagger">
          {filteredNav.map(item => {
            if (item.isSeparator) {
              return !collapsed ? (
                <div key={item.name} className="px-3 pt-3 pb-1">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-sidebar-foreground/30">
                    {item.name.replace(/──\s?/g, "").trim()}
                  </p>
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
                  group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                  transition-all duration-200
                  ${isActive
                    ? "bg-gradient-to-r from-sidebar-primary to-sidebar-primary/75 text-primary-foreground shadow-lg shadow-sidebar-primary/30 border-l-[3px] border-white/70"
                    : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent hover:translate-x-0.5 hover:shadow-md hover:shadow-black/20"
                  }
                `}
              >
                <item.icon className="flex-shrink-0 transition-transform duration-200 group-hover:scale-110" size={18} />
                {!collapsed && <span className="truncate">{item.name}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Footer — only collapse toggle */}
        <div className="p-3 border-t border-sidebar-accent">
          <button
            onClick={() => setCollapsed(c => !c)}
            className="hidden lg:flex items-center justify-center w-full py-1.5 rounded-lg text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-all duration-200 active:scale-95"
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top bar (desktop + mobile) */}
        <header className="flex items-center justify-between h-14 px-5 border-b border-border bg-card/85 backdrop-blur-md shadow-sm flex-shrink-0 gap-4 relative z-20">
          {/* Mobile: hamburger */}
          <button className="lg:hidden text-muted-foreground hover:text-foreground" onClick={() => setMobileOpen(true)}>
            <Menu size={20} />
          </button>

          {/* Page name — desktop left, mobile center */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <h2 key={currentPageName} className="text-sm font-semibold text-foreground truncate animate-in fade-in-0 slide-in-from-left-2 duration-300">
              {PAGE_NAMES[currentPageName] || currentPageName || "Dashboard"}
            </h2>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-1">

            {/* ── Notification bell ── */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => { setNotifOpen(o => !o); setUserMenuOpen(false); }}
                className="relative h-9 w-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-all duration-200 active:scale-90"
                title="Notificaciones"
              >
                <Bell size={18} />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 h-[14px] min-w-[14px] rounded-full bg-destructive text-[9px] font-bold text-white flex items-center justify-center px-0.5 leading-none animate-[pop_.35s_ease-out,glow-pulse_2s_ease-in-out_.4s_infinite]">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 top-11 w-80 bg-card border border-border rounded-xl shadow-2xl shadow-primary/10 z-50 overflow-hidden origin-top-right animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150">
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <h3 className="font-semibold text-sm">Notificaciones</h3>
                    <button onClick={() => setNotifOpen(false)} className="text-muted-foreground hover:text-foreground p-0.5">
                      <X size={14} />
                    </button>
                  </div>

                  {/* List */}
                  <div className="max-h-72 overflow-y-auto">
                    {approvedOrders.length === 0 && pendingIcOrders.length === 0 && pendingReviewOrders.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
                        <Bell size={24} className="opacity-25" />
                        <p className="text-sm">Sin notificaciones nuevas</p>
                      </div>
                    ) : (
                      <>
                        {/* Comercial: approved orders ready to download */}
                        {approvedOrders.map(order => (
                          <button
                            key={order.id}
                            onClick={() => {
                              markOrderNotified(order.id);
                              setNotifOpen(false);
                              navigate(`/procurement/PurchaseOrderDetail/${order.id}`);
                            }}
                            className="w-full flex items-start gap-3 px-4 py-3 hover:bg-primary/5 hover:pl-5 transition-all duration-200 border-b border-border/40 last:border-0 text-left"
                          >
                            <div className="h-8 w-8 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <ShieldCheck size={14} className="text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold">Pedido aprobado</p>
                              <p className="text-xs text-muted-foreground truncate">
                                #{order.id.slice(-6).toUpperCase()} · {order.supplier_name} — listo para descargar
                              </p>
                            </div>
                          </button>
                        ))}

                        {/* Analista IC: pedidos pendientes de revisión */}
                        {pendingIcOrders.map(order => (
                          <button
                            key={order.id}
                            onClick={() => {
                              setNotifOpen(false);
                              navigate(`/procurement/PurchaseOrderDetail/${order.id}`);
                            }}
                            className="w-full flex items-start gap-3 px-4 py-3 hover:bg-primary/5 hover:pl-5 transition-all duration-200 border-b border-border/40 last:border-0 text-left"
                          >
                            <div className="h-8 w-8 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <ClipboardList size={14} className="text-purple-600 dark:text-purple-400" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold">Pedido pendiente de revisión IC</p>
                              <p className="text-xs text-muted-foreground truncate">
                                #{order.id.slice(-6).toUpperCase()} · {order.supplier_name}
                              </p>
                            </div>
                          </button>
                        ))}

                        {/* Revisor: pedidos pendientes de aprobación */}
                        {pendingReviewOrders.map(order => (
                          <button
                            key={order.id}
                            onClick={() => {
                              setNotifOpen(false);
                              navigate(`/procurement/PurchaseOrderDetail/${order.id}`);
                            }}
                            className="w-full flex items-start gap-3 px-4 py-3 hover:bg-primary/5 hover:pl-5 transition-all duration-200 border-b border-border/40 last:border-0 text-left"
                          >
                            <div className="h-8 w-8 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <CheckCircle size={14} className="text-amber-600 dark:text-amber-400" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold">Pedido pendiente de aprobación</p>
                              <p className="text-xs text-muted-foreground truncate">
                                #{order.id.slice(-6).toUpperCase()} · {order.supplier_name}
                              </p>
                            </div>
                          </button>
                        ))}
                      </>
                    )}
                  </div>

                </div>
              )}
            </div>

            {/* ── User menu ── */}
            {user && (
              <div className="relative" ref={userMenuRef}>
                <button
                  onClick={() => { setUserMenuOpen(o => !o); setNotifOpen(false); }}
                  className="group flex items-center gap-1.5 h-9 px-2 rounded-lg hover:bg-primary/10 transition-all duration-200 active:scale-95"
                  title={user.full_name || user.email}
                >
                  <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary to-accent shadow-md shadow-primary/30 flex items-center justify-center text-primary-foreground font-bold text-xs flex-shrink-0 ring-2 ring-transparent transition-all duration-200 group-hover:ring-primary/30">
                    {(user.full_name || user.email || "U")[0].toUpperCase()}
                  </div>
                  <ChevronDown size={13} className="text-muted-foreground hidden sm:block" />
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 top-11 w-64 bg-card border border-border rounded-xl shadow-2xl shadow-primary/10 z-50 overflow-hidden origin-top-right animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150">
                    {/* Profile info */}
                    <div className="px-4 py-3 border-b border-border">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary to-accent shadow-lg shadow-primary/30 flex items-center justify-center text-primary-foreground font-bold text-base flex-shrink-0">
                          {(user.full_name || user.email || "U")[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate leading-tight">
                            {user.full_name || "Sin nombre"}
                          </p>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-primary leading-tight mt-0.5">
                            {ROLE_LABELS[userRole] || userRole}
                          </p>
                          <p className="text-[10px] text-muted-foreground truncate leading-tight mt-0.5">
                            {user.email}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Options */}
                    <div className="py-1">
                      <button
                        onClick={() => { toggleTheme(); setUserMenuOpen(false); }}
                        className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-foreground hover:bg-primary/10 hover:pl-5 transition-all duration-200 text-left"
                      >
                        {dark ? <Sun size={15} /> : <Moon size={15} />}
                        {dark ? "Modo Claro" : "Modo Oscuro"}
                      </button>
                      <a
                        href="/manual-reabastecimiento.html"
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-foreground hover:bg-primary/10 hover:pl-5 transition-all duration-200 text-left"
                      >
                        <BookOpen size={15} />
                        Manual de Usuario
                      </a>
                      <button
                        onClick={() => { setUserMenuOpen(false); authLogout(); navigate('/login'); }}
                        className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-destructive hover:bg-destructive/10 hover:pl-5 transition-all duration-200 text-left"
                      >
                        <LogOut size={15} />
                        Cerrar sesión
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto app-surface">
          <div key={currentPageName} className="page-enter">
            {bloqueada ? null : children}
          </div>
        </div>
      </main>

      <WhatsNewModal open={showWhatsNew} onClose={handleCloseWhatsNew} />
    </div>
  );
}
