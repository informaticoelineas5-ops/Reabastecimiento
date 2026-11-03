import React, { useState, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import SearchSelect from "@/components/common/SearchSelect";
import { useToast } from "@/components/ui/use-toast";
import {
  Plus, Search, Edit2, Trash2, Building2, Phone, Mail, Globe,
  ToggleLeft, ToggleRight, X, ChevronDown, FileText, CalendarDays,
  History, AlertTriangle, Filter, PhoneCall,
} from "lucide-react";
import { format, parseISO, differenceInDays } from "date-fns";
import { es } from "date-fns/locale";
import { useProcurementUser } from "@/hooks/useProcurementUser";

// ── Constantes ───────────────────────────────────────────────────────────────

const TIPO_PROVEEDOR = [
  "Emp Extranjera", "Emp Mixta", "Emp Nacional", "Mipyme", "TCP", "Cooperativa",
];

const TIPO_COMERCIALIZACION = [
  "DAP", "Importación", "Merc Nacionalizada", "Consignación",
  "Producción Nac", "Venta Online", "Venta Plaza", "Leasing con opc compra",
];

const PAISES = [
  "Afganistán", "Albania", "Alemania", "Andorra", "Angola", "Antigua y Barbuda",
  "Arabia Saudita", "Argelia", "Argentina", "Armenia", "Australia", "Austria",
  "Azerbaiyán", "Bahamas", "Bahrein", "Bangladés", "Barbados", "Baréin",
  "Bélgica", "Belice", "Benín", "Bielorrusia", "Birmania", "Bolivia",
  "Bosnia y Herzegovina", "Botsuana", "Brasil", "Brunéi", "Bulgaria",
  "Burkina Faso", "Burundi", "Cabo Verde", "Camerún", "Canadá", "Catar",
  "Chile", "China", "Chipre", "Colombia", "Comoras", "Congo", "Corea del Norte",
  "Corea del Sur", "Costa de Marfil", "Costa Rica", "Croacia", "Cuba",
  "Dinamarca", "Dominica", "Ecuador", "Egipto", "El Salvador",
  "Emiratos Árabes Unidos", "Eslovaquia", "Eslovenia", "España", "Estados Unidos",
  "Estonia", "Eswatini", "Etiopía", "Filipinas", "Finlandia", "Francia",
  "Gabón", "Gambia", "Georgia", "Ghana", "Gran Bretaña", "Grecia", "Guatemala",
  "Guinea", "Guinea Ecuatorial", "Guinea-Bisáu", "Guyana", "Haití", "Holanda",
  "Honduras", "Hungría", "India", "Indonesia", "Irak", "Irán", "Irlanda",
  "Islandia", "Islas Marshall", "Islas Salomón", "Islas Vírgenes, ReinoUnido.",
  "IslasVírgenes, EstadosUnidos.", "Italia", "Jamaica", "Japón", "Jordania",
  "Kazajistán", "Kenia", "Kirguistán", "Kiribati", "Kuwait", "Laos", "Lesoto",
  "Letonia", "Liberia", "Libia", "Liechtenstein", "Lituania", "Luxemburgo",
  "Malasia", "Malawi", "Maldivas", "Mali", "Malta", "Marruecos", "Mauricio",
  "Mauritania", "México", "Micronesia", "Mónaco", "Mongolia", "Montenegro",
  "Namibia", "Nauru", "Nepal", "Nicaragua", "Níger", "Nigeria", "Noruega",
  "Nueva Zelanda", "Omán", "Pakistán", "Palaos", "Panamá", "Paraguay", "Perú",
  "Polonia", "Portugal", "Reino Unido", "República Checa", "República de Moldavia",
  "República de Serbia", "República de Sudáfrica", "República Democrática del Congo",
  "República Dominicana", "República Oriental del Uruguay", "Rumanía", "Rusia",
  "Rwanda", "Samoa", "San Cristóbal y Nieves", "San Marino", "Santa Lucía",
  "Santa Sede", "Senegal", "Serbia", "Seychelles", "Sierra Leona", "Singapur",
  "Siria", "Somalia", "Sudán", "Sudán del Sur", "Suecia", "Suiza", "Tailandia",
  "Tanzania", "Tayikistán", "Togo", "Tonga", "Trinidad y Tobago", "Túnez",
  "Turkmenistán", "Turquía", "Tuvalu", "Ucrania", "Uganda", "Uzbekistán",
  "Vanuatu", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabue",
];

const PRODUCTOS_GLOBAL = [
  "Alimentos", "Bebidas", "Confecciones textiles", "Calzado", "Electrónica",
  "Ferretería", "Mobilliario", "Materiales de Construcción", "Herramientas",
  "Aseo", "Cosmética", "Perfumería", "Juguetes", "Materiales de Oficina",
  "Electrodomésticos", "Transporte-Izaje", "Artículos para Mascotas",
  "Clima y Refrigeración", "Medicamentos", "Menaje hogar", "Ofimática",
  "Energías Alternativas", "Maquinarias", "Iluminación",
  "Partes y Piezas Transporte", "Seguridad", "Sublimación", "Fotografía y Video",
  "Jardinería", "Cigarros", "Aceites y Lubricantes", "Servicios",
  "Artículos para Fiestas", "Piscinas", "Equipamiento cocina",
  "Control de Plagas", "Productos industriales y de servicios", "Insumos",
  "Implementos Deportivos", "Decoración", "Operador logístico", "Almacenamiento",
  "Combustible",
];

const PRODUCTOS_ESPECIFICOS = [
  "Accesorios Higiene Personal", "Aceite de cocina", "Aceite de Oliva",
  "Aceites y lubricantes", "Aguas embotelladas", "Ajuar de cama",
  "Alimentos procesados", "Almohadas", "Arroz", "Artículos de Decoración",
  "Artículos de ferretería", "Artículos de limpieza", "Artículos de Verano",
  "Artículos litografiados", "Artículos para el hogar", "Aseo del Cabello",
  "Aseo del Hogar", "Barniz", "Batería de cocina", "Baterías", "Baterías de litio",
  "Batidoras", "Bebidas alcohólicas", "Bebidas energéticas", "Bicicletas",
  "Bocinas", "Cableado y Conductores", "Café", "Café Bustelo", "Café e Infusiones",
  "Café la Carreta", "Café La Llave", "Café marcas nacionales", "Calentadores de gas",
  "Calentadores eléctricos", "Cámaras", "Cámaras de Seguridad", "Cámaras Frías",
  "Camión refrigerado", "Capas de agua", "Cargadores de baterías de litio",
  "Cárnicos", "Carros", "Celulares", "Cementos", "Cerveza Bucanero", "Cerveza Cristal",
  "Cerveza Heineken", "Cerveza Parranda", "Cervezas Importadas", "Cervezas Nacionales",
  "Chococolate en Polvo", "Chocolate", "Chorizo", "Cigarros", "Cintas adhesivas",
  "Coca-Cola", "Cocinas", "Colchones", "Condimentos naturales deshidratados",
  "Confituras", "Control y Automatización", "Cortes de Cerdo", "Cortes de Res",
  "Cortinas", "Cosméticos", "Cristalería", "Culeros desechables", "Derivados chocolates",
  "Detergente", "Edredones", "Encurtidos", "Enlatados", "Equipos de audio",
  "Equipos para envasar", "Equipos para etiquetar", "Escobas",
  "Estabilizadores de voltaje", "Estanterías", "Extintores", "Fabricante de tornillos",
  "Fanta", "Freezer", "Fundas", "Galletas", "Gelatinas", "Granos", "Helados",
  "Herramientas", "Hojas", "Hypermalt", "Impermeabilizantes", "Implementos deportivos",
  "Impresoras", "Insumos de almacén", "Insumos desechables", "Jabones", "Jamón",
  "Jarras", "Jugos", "Jugos Importados", "Jugos Juver", "Jugos La Estancia",
  "Jugos nacionales", "Juguetes", "Lácteos", "Lámparas", "Leche condensada",
  "Leche en Polvo", "Leche evaporada", "Leche Fluída", "Legumbres", "Lencerías varias",
  "Licores", "Lonas", "Luminarias", "Madera", "Malta Bucanero", "Malta Morena",
  "Maltas", "Mantequilla", "Mariscos", "Material de oficina", "Mayonesa",
  "Medicinas", "Medios de Protección", "Menaje de cocina", "Mesas",
  "Mesas y sillas de dominó", "Metales", "Microwaves", "Mochilas", "Montacargas",
  "Morteros", "Moto eléctrica", "Muebles sanitarios", "Natillas", "Neumáticos",
  "Paneles solares", "Papel oficina", "Papel sanitario", "Pastas alimenticias",
  "Pellys", "Perfumes", "Pescados", "Pinturas", "Pladur", "Plantas eléctricas",
  "Plomería", "Pollo", "Porcelanato", "Productos Badia", "Productos Carnation",
  "Productos Colgate", "Productos D´Gary", "Productos Don Simón", "Productos Goya",
  "Productos Guillette", "Productos Gullón", "Productos La Costeña",
  "Productos La Lechera", "Productos Milexus", "Productos Nestlé", "Productos Palmolive",
  "Productos para el cuidado personal", "Protección Eléctrica", "Protectores de línea",
  "Queso Crema", "Queso Gouda", "Quesos", "Rastras", "Real Malt", "Refresco",
  "Refresco instantáneo", "Refrescos importados", "Refrescos nacionales", "Refrescos Santa",
  "Ropa reciclada", "Sábanas", "Sal", "Salchichas", "Salsa/pasta de tomate", "Salsas",
  "Sazones", "Servicio de impresiones", "Servicio de sublimación",
  "Servicios de llenado de extintores", "Sillas", "Snacks secos", "Soldaduras",
  "Sombrillas", "Splits", "Sprite", "Televisores", "Termos", "Toallitas Húmedas",
  "Toldos", "Tóner", "Traspaletas", "Triciclo", "Útiles del hogar", "Vajilla",
  "Vainilla", "Velas", "Ventiladores", "Vinagre", "Vinos", "Yogurt", "Zapatos",
  "Abrasivos", "Azúcar", "Cereales", "Conservas", "Contenedores", "Diesel",
  "Embutidos", "Etiquetas", "Film Alimentario", "Gasolina", "Harinas", "Insumos",
  "ISOTanques", "Nylon retráctil", "Quimicos para piscinas",
  "Autos eléctricos", "Autos mecánicos",
];

const EMPTY_FORM = {
  name: "",
  code: "",
  supplier_type: "",
  comercializacion_type: "",
  country: "",
  address: "",
  email: "",
  comercial: "",
  default_currency: "USD",
  default_exchange_rate: 1,
  contacts: [{ name: "", cargo: "", telefono: "" }],
  productos_global: [],
  productos_especificos: [],
  is_active: true,
  has_contract: false,
  contract_notes: "",
  next_contact_date: "",
};

// ── Componente MultiSelect con búsqueda ──────────────────────────────────────

function ProductoMultiSelect({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const shown = q.trim()
    ? options.filter(o => o.toLowerCase().includes(q.toLowerCase()))
    : options;

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="w-full h-9 border border-input rounded-md px-3 text-sm text-left flex items-center justify-between bg-background hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <span className={value.length === 0 ? "text-muted-foreground" : "font-medium"}>
            {value.length === 0 ? "Seleccionar..." : `${value.length} seleccionado(s)`}
          </span>
          <ChevronDown size={14} className={`text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </button>

        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setQ(""); }} />
            <div className="absolute z-50 w-full top-full mt-1.5 border border-border rounded-md bg-popover shadow-md flex flex-col max-h-56">
              <div className="p-2 border-b border-border shrink-0">
                <Input
                  autoFocus
                  placeholder="Buscar..."
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  className="h-7 text-xs"
                  onClick={e => e.stopPropagation()}
                />
              </div>
              <div className="overflow-y-auto">
                {shown.length === 0 && (
                  <p className="px-3 py-3 text-xs text-muted-foreground text-center">Sin resultados</p>
                )}
                {shown.map(opt => (
                  <label key={opt} className="flex items-center gap-2.5 px-3 py-2 hover:bg-accent cursor-pointer text-sm select-none">
                    <Checkbox
                      checked={value.includes(opt)}
                      onCheckedChange={checked => onChange(checked ? [...value, opt] : value.filter(v => v !== opt))}
                    />
                    <span className="truncate">{opt}</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {value.map(v => (
            <Badge key={v} variant="secondary" className="text-[10px] pl-2 pr-1 gap-1">
              <span className="truncate max-w-[150px]">{v}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter(x => x !== v))}
                className="ml-0.5 hover:text-destructive"
              >
                <X size={10} />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Página principal ─────────────────────────────────────────────────────────

export default function Suppliers() {
  const { isAdmin, isComercial, isAnalista, isRevisor, user } = useProcurementUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const canManageContacts = isAdmin || isComercial || isAnalista || isRevisor;

  const [search, setSearch]           = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showForm, setShowForm]       = useState(false);
  const [editing, setEditing]         = useState(null);
  const [form, setForm]               = useState(EMPTY_FORM);
  const [saving, setSaving]           = useState(false);
  const [showDeleteId, setShowDeleteId] = useState(null);
  const [markingContactId, setMarkingContactId] = useState(null);

  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ["suppliers"],
    queryFn:  () => base44.entities.Supplier.list("name", 500),
  });

  const { data: allOrders = [] } = useQuery({
    queryKey: ["purchase-orders-for-suppliers"],
    queryFn:  () => base44.entities.PurchaseOrder.list("-created_date", 500),
  });

  const { data: supplierContacts = [] } = useQuery({
    queryKey: ["supplier-contacts"],
    queryFn:  () => base44.entities.SupplierContact.list("-contact_date", 2000),
  });

  const lastContactBySupplier = useMemo(() => {
    const map = {};
    supplierContacts.forEach(c => {
      if (!c.supplier_id || !c.contact_date) return;
      if (!map[c.supplier_id] || c.contact_date > map[c.supplier_id]) {
        map[c.supplier_id] = c.contact_date;
      }
    });
    return map;
  }, [supplierContacts]);

  const handleMarkContacted = async (s) => {
    if (lastContactBySupplier[s.id] === today) {
      toast({ title: "Ya contactado hoy", description: `${s.name} ya fue marcado como contactado hoy.` });
      return;
    }
    setMarkingContactId(s.id);
    try {
      await base44.entities.SupplierContact.create({
        supplier_id:   s.id,
        supplier_name: s.name,
        contact_date:  today,
        contacted_by:  user?.email,
      });
      queryClient.invalidateQueries({ queryKey: ["supplier-contacts"] });
      toast({ title: "Contacto registrado", description: `${s.name} marcado como contactado hoy.` });
    } catch (err) {
      toast({ title: "Error al registrar contacto", description: err?.message, variant: "destructive" });
    } finally {
      setMarkingContactId(null);
    }
  };

  const orderStatsBySupplier = useMemo(() => {
    const map = {};
    const currentYear = new Date().getFullYear().toString();
    allOrders.forEach(ord => {
      const name = ord.supplier_name;
      if (!name) return;
      if (!map[name]) map[name] = { total: 0, thisYear: 0, lastDate: null, totalAmount: 0 };
      map[name].total += 1;
      if ((ord.created_date || "").startsWith(currentYear)) map[name].thisYear += 1;
      if (ord.total_amount) map[name].totalAmount += ord.total_amount;
      if (!map[name].lastDate || (ord.created_date || "") > map[name].lastDate) {
        map[name].lastDate = ord.created_date;
      }
    });
    return map;
  }, [allOrders]);

  const today = new Date().toISOString().slice(0, 10);

  const filtered = suppliers.filter(s => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      (s.name || "").toLowerCase().includes(q) ||
      (s.code || "").toLowerCase().includes(q) ||
      (s.contact_name || "").toLowerCase().includes(q) ||
      (s.comercial || "").toLowerCase().includes(q) ||
      (s.supplier_type || "").toLowerCase().includes(q) ||
      (s.country || "").toLowerCase().includes(q);
    const matchCategory = !categoryFilter ||
      (s.productos_global || []).includes(categoryFilter) ||
      (s.productos_especificos || []).includes(categoryFilter);
    return matchSearch && matchCategory;
  });

  // Proveedores con contacto próximo (próximos 14 días)
  const upcomingContacts = suppliers.filter(s => {
    if (!s.next_contact_date) return false;
    const diff = differenceInDays(parseISO(s.next_contact_date), new Date());
    return diff >= 0 && diff <= 14;
  }).sort((a, b) => (a.next_contact_date || "").localeCompare(b.next_contact_date || ""));

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (s) => {
    setEditing(s);
    const raw = [
      { name: s.contact_name || "", cargo: s.cargo_1 || "", telefono: s.telefono_1 || "" },
      { name: s.contact_2    || "", cargo: s.cargo_2 || "", telefono: s.telefono_2 || "" },
      { name: s.contact_3    || "", cargo: s.cargo_3 || "", telefono: s.telefono_3 || "" },
      { name: s.contact_4    || "", cargo: s.cargo_4 || "", telefono: s.telefono_4 || "" },
      { name: s.contact_5    || "", cargo: s.cargo_5 || "", telefono: s.telefono_5 || "" },
    ];
    const contacts = raw.filter((c, i) => i === 0 || c.name || c.cargo || c.telefono);
    setForm({
      name:                  s.name || "",
      code:                  s.code || "",
      supplier_type:         s.supplier_type || "",
      comercializacion_type: s.comercializacion_type || "",
      country:               s.country || "",
      address:               s.address || "",
      email:                 s.email || "",
      comercial:             s.comercial || "",
      default_currency:      s.default_currency || "USD",
      default_exchange_rate: s.default_exchange_rate || 1,
      contacts:              contacts.length > 0 ? contacts : [{ name: "", cargo: "", telefono: "" }],
      productos_global:      s.productos_global || [],
      productos_especificos: s.productos_especificos || [],
      is_active:             s.is_active !== false,
      has_contract:          s.has_contract || false,
      contract_notes:        s.contract_notes || "",
      next_contact_date:     s.next_contact_date || "",
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "El nombre del proveedor es obligatorio", variant: "destructive" });
      return;
    }
    if (form.next_contact_date && form.next_contact_date < today) {
      toast({ title: "Fecha inválida", description: "El próximo contacto no puede ser una fecha anterior a hoy.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = { name: form.name.trim() };
      if (form.code)                  payload.code = form.code.trim().toUpperCase();
      if (form.supplier_type)         payload.supplier_type = form.supplier_type;
      if (form.comercializacion_type) payload.comercializacion_type = form.comercializacion_type;
      if (form.country)               payload.country = form.country;
      if (form.address)               payload.address = form.address;
      if (form.email)                 payload.email = form.email;
      if (form.comercial)             payload.comercial = form.comercial;
      if (form.default_currency)      payload.default_currency = form.default_currency;
      const exRate = parseFloat(form.default_exchange_rate);
      if (!isNaN(exRate))             payload.default_exchange_rate = exRate;

      // Contactos: mapea array de objetos a columnas individuales
      const slots = [...form.contacts, {},{},{},{},{}].slice(0, 5);
      payload.contact_name = slots[0]?.name || "";
      payload.cargo_1      = slots[0]?.cargo    || null;
      payload.telefono_1   = slots[0]?.telefono || null;
      payload.contact_2    = slots[1]?.name    || null;
      payload.cargo_2      = slots[1]?.cargo    || null;
      payload.telefono_2   = slots[1]?.telefono || null;
      payload.contact_3    = slots[2]?.name    || null;
      payload.cargo_3      = slots[2]?.cargo    || null;
      payload.telefono_3   = slots[2]?.telefono || null;
      payload.contact_4    = slots[3]?.name    || null;
      payload.cargo_4      = slots[3]?.cargo    || null;
      payload.telefono_4   = slots[3]?.telefono || null;
      payload.contact_5    = slots[4]?.name    || null;
      payload.cargo_5      = slots[4]?.cargo    || null;
      payload.telefono_5   = slots[4]?.telefono || null;

      // Arrays (siempre se envían para soportar limpiar selecciones en update)
      payload.productos_global      = form.productos_global;
      payload.productos_especificos = form.productos_especificos;

      payload.has_contract      = form.has_contract;
      payload.contract_notes    = form.contract_notes || null;
      payload.next_contact_date = form.next_contact_date || null;

      if (editing || !form.is_active) payload.is_active = form.is_active;

      if (editing) {
        await base44.entities.Supplier.update(editing.id, payload);
        toast({ title: "Proveedor actualizado" });
      } else {
        await base44.entities.Supplier.create(payload);
        toast({ title: "Proveedor creado" });
      }
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setShowForm(false);
    } catch (err) {
      toast({ title: "Error al guardar", description: err?.message ?? "Error desconocido", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    await base44.entities.Supplier.delete(id);
    queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    setShowDeleteId(null);
    toast({ title: "Proveedor eliminado" });
  };

  const toggleActive = async (s) => {
    await base44.entities.Supplier.update(s.id, { is_active: !s.is_active });
    queryClient.invalidateQueries({ queryKey: ["suppliers"] });
  };

  // Atajo para inputs de texto simples
  const sf = field => e => setForm(p => ({ ...p, [field]: e.target.value }));

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Building2 size={18} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Proveedores</h1>
            <p className="text-xs text-muted-foreground">{filtered.length} registrado(s)</p>
          </div>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={openCreate}>
            <Plus size={15} className="mr-1.5" /> Nuevo Proveedor
          </Button>
        )}
      </div>

      {/* Mini stats */}
      {suppliers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {[
            { label: "Total",    value: suppliers.length,                              cls: "text-foreground" },
            { label: "Activos",  value: suppliers.filter(s => s.is_active !== false).length, cls: "text-success" },
            { label: "Inactivos",value: suppliers.filter(s => s.is_active === false).length, cls: "text-muted-foreground" },
          ].map(({ label, value, cls }) => (
            <div key={label} className="flex items-center gap-1.5 bg-muted/60 border border-border/50 rounded-lg px-3 py-1.5 text-xs">
              <span className={`font-bold text-sm ${cls}`}>{value}</span>
              <span className="text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Plan de Contacto — próximos 14 días */}
      {upcomingContacts.length > 0 && (
        <Card className="p-4 border-warning/40 bg-warning/5">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3 text-warning">
            <CalendarDays size={14} /> Plan de Contacto — Próximos 14 días
          </h3>
          <div className="flex flex-wrap gap-2">
            {upcomingContacts.map(s => {
              const diff = differenceInDays(parseISO(s.next_contact_date), new Date());
              const urgent = diff <= 2;
              return (
                <div key={s.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs border ${urgent ? "bg-destructive/10 border-destructive/30" : "bg-muted/60 border-border/50"}`}>
                  {urgent && <AlertTriangle size={11} className="text-destructive flex-shrink-0" />}
                  <div>
                    <p className="font-semibold">{s.name}</p>
                    <p className={`text-[10px] ${urgent ? "text-destructive" : "text-muted-foreground"}`}>
                      {diff === 0 ? "Hoy" : diff === 1 ? "Mañana" : `En ${diff} días`}
                      {" · "}{format(parseISO(s.next_contact_date), "dd MMM", { locale: es })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Búsqueda + Filtro de categoría */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, ID, país..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Filter size={14} className="shrink-0 text-muted-foreground" />
          <SearchSelect
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={PRODUCTOS_GLOBAL}
            allValue="" allLabel="Todos los productos"
            placeholder="Filtrar por producto…" size="md" className="w-[230px]"
          />
        </div>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="space-y-3">
          {Array(4).fill(0).map((_, i) => (
            <div key={i} className="h-24 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center space-y-3">
          <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center">
            <Building2 size={22} className="text-muted-foreground opacity-50" />
          </div>
          <div>
            <p className="text-sm font-medium">
              {search ? "Sin resultados" : "No hay proveedores registrados"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {search ? "Intenta con otro término de búsqueda." : "Crea el primero con el botón Nuevo Proveedor."}
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map(s => {
            const allContacts = [
              { name: s.contact_name, cargo: s.cargo_1, telefono: s.telefono_1 },
              { name: s.contact_2,    cargo: s.cargo_2, telefono: s.telefono_2 },
              { name: s.contact_3,    cargo: s.cargo_3, telefono: s.telefono_3 },
              { name: s.contact_4,    cargo: s.cargo_4, telefono: s.telefono_4 },
              { name: s.contact_5,    cargo: s.cargo_5, telefono: s.telefono_5 },
            ].filter(c => c.name || c.telefono);
            const stats = orderStatsBySupplier[s.name];
            const nextContactDiff = s.next_contact_date
              ? differenceInDays(parseISO(s.next_contact_date), new Date())
              : null;
            const contactUrgent = nextContactDiff !== null && nextContactDiff <= 2;
            return (
              <Card key={s.id} className={`p-4 ${!s.is_active ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0 space-y-2">
                    {/* ID + Nombre + Estado + Contrato */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {s.code && (
                        <Badge variant="outline" className="text-[10px] font-mono font-bold border-primary/40 text-primary bg-primary/5 tracking-wide">
                          {s.code}
                        </Badge>
                      )}
                      <span className="font-semibold truncate">{s.name}</span>
                      <Badge variant={s.is_active ? "default" : "outline"} className="text-[10px]">
                        {s.is_active ? "Activo" : "Inactivo"}
                      </Badge>
                      <Badge variant="outline" className={`text-[10px] flex items-center gap-1 ${s.has_contract ? "text-success border-success/40 bg-success/5" : "text-muted-foreground"}`}>
                        <FileText size={9} /> {s.has_contract ? "Con contrato" : "Sin contrato"}
                      </Badge>
                    </div>

                    {/* Tipo proveedor + Comercialización + País + Comercial */}
                    <div className="flex flex-wrap gap-1.5 items-center">
                      {s.supplier_type && (
                        <Badge variant="secondary" className="text-[10px]">{s.supplier_type}</Badge>
                      )}
                      {s.comercializacion_type && (
                        <Badge variant="outline" className="text-[10px]">{s.comercializacion_type}</Badge>
                      )}
                      {s.country && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Globe size={10} /> {s.country}
                        </span>
                      )}
                      {s.comercial && (
                        <span className="text-xs text-muted-foreground">· {s.comercial}</span>
                      )}
                    </div>

                    {/* Contactos + Email + Moneda */}
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {allContacts.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Phone size={10} />
                          {allContacts[0].name}
                          {allContacts[0].cargo && <span className="opacity-70">({allContacts[0].cargo})</span>}
                          {allContacts[0].telefono && <span className="font-mono">{allContacts[0].telefono}</span>}
                          {allContacts.length > 1 && <span className="ml-1 text-[10px]">+{allContacts.length - 1} más</span>}
                        </span>
                      )}
                      {s.email && (
                        <span className="flex items-center gap-1"><Mail size={10} /> {s.email}</span>
                      )}
                      {s.default_currency && (
                        <span>
                          {s.default_currency}
                          {s.default_exchange_rate && s.default_exchange_rate !== 1
                            ? ` · TC ×${s.default_exchange_rate}` : ""}
                        </span>
                      )}
                    </div>

                    {/* Historial de operaciones */}
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <History size={10} />
                        {stats ? (
                          <>
                            <span className="font-semibold text-foreground">{stats.total}</span> pedido(s) histórico
                            {stats.thisYear > 0 && <span className="ml-1">· <span className="font-semibold text-primary">{stats.thisYear}</span> este año</span>}
                          </>
                        ) : "Sin pedidos registrados"}
                      </span>
                      {stats?.lastDate && (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <CalendarDays size={10} />
                          Último pedido: <span className="font-medium text-foreground ml-0.5">
                            {format(parseISO(stats.lastDate), "dd MMM yyyy", { locale: es })}
                          </span>
                        </span>
                      )}
                    </div>

                    {/* Próximo contacto + Último contacto + Marcar contactado */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {s.next_contact_date && (
                        <div className={`flex items-center gap-1.5 text-xs rounded px-2 py-1 w-fit ${contactUrgent ? "bg-destructive/10 text-destructive" : nextContactDiff !== null && nextContactDiff <= 7 ? "bg-warning/10 text-warning" : "bg-muted/60 text-muted-foreground"}`}>
                          {contactUrgent && <AlertTriangle size={10} />}
                          <CalendarDays size={10} />
                          <span>Contactar: <strong>{format(parseISO(s.next_contact_date), "dd MMM yyyy", { locale: es })}</strong></span>
                          {nextContactDiff !== null && (
                            <span className="opacity-70">
                              ({nextContactDiff === 0 ? "hoy" : nextContactDiff < 0 ? `hace ${Math.abs(nextContactDiff)}d` : `en ${nextContactDiff}d`})
                            </span>
                          )}
                        </div>
                      )}
                      {lastContactBySupplier[s.id] && (
                        <div className="flex items-center gap-1.5 text-xs rounded px-2 py-1 w-fit bg-success/10 text-success">
                          <History size={10} />
                          <span>Último contacto: <strong>{format(parseISO(lastContactBySupplier[s.id]), "dd MMM yyyy", { locale: es })}</strong></span>
                        </div>
                      )}
                      {canManageContacts && (() => {
                        const contactadoHoy = lastContactBySupplier[s.id] === today;
                        return (
                          <Button
                            variant="outline" size="sm"
                            className={`h-6 text-[11px] px-2 ${contactadoHoy ? "text-success border-success/40 bg-success/5 cursor-default" : ""}`}
                            disabled={markingContactId === s.id || contactadoHoy}
                            onClick={() => handleMarkContacted(s)}
                          >
                            <PhoneCall size={10} className="mr-1" />
                            {markingContactId === s.id ? "Guardando..." : contactadoHoy ? "Ya contactado hoy" : "Marcar contactado hoy"}
                          </Button>
                        );
                      })()}
                    </div>

                    {/* Productos Global (primeros 3 + contador) */}
                    {s.productos_global?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {s.productos_global.slice(0, 4).map(p => (
                          <Badge key={p} variant="outline" className={`text-[10px] ${categoryFilter === p ? "bg-primary/15 border-primary/40 text-primary" : "bg-primary/5 border-primary/20 text-primary"}`}>
                            {p}
                          </Badge>
                        ))}
                        {s.productos_global.length > 4 && (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            +{s.productos_global.length - 4}
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>

                  {isAdmin && (
                    <div className="flex gap-1 flex-shrink-0">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => toggleActive(s)} title={s.is_active ? "Desactivar" : "Activar"}>
                        {s.is_active
                          ? <ToggleRight size={15} className="text-success" />
                          : <ToggleLeft size={15} className="text-muted-foreground" />}
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => openEdit(s)}>
                        <Edit2 size={13} />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 hover:text-destructive" onClick={() => setShowDeleteId(s.id)}>
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Formulario Crear / Editar ────────────────────────────────────────── */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Proveedor" : "Nuevo Proveedor"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">

            {/* ID + Nombre */}
            <div className="grid grid-cols-[148px_1fr] gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-primary">ID Proveedor</Label>
                <Input
                  placeholder="EE01"
                  value={form.code}
                  onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                  className="font-mono tracking-widest h-9"
                  maxLength={10}
                />
                <p className="text-[10px] text-muted-foreground">Ej: EE01 · MI03 · CN15</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nombre del Proveedor <span className="text-destructive">*</span></Label>
                <Input
                  placeholder="Nombre de la empresa"
                  value={form.name}
                  onChange={sf("name")}
                  className="h-9"
                />
              </div>
            </div>

            {/* Tipo Proveedor + Tipo Comercialización */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Tipo Proveedor</Label>
                <Select
                  value={form.supplier_type || "_none"}
                  onValueChange={v => setForm(p => ({ ...p, supplier_type: v === "_none" ? "" : v }))}
                >
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— Sin especificar</SelectItem>
                    {TIPO_PROVEEDOR.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tipo Comercialización</Label>
                <Select
                  value={form.comercializacion_type || "_none"}
                  onValueChange={v => setForm(p => ({ ...p, comercializacion_type: v === "_none" ? "" : v }))}
                >
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">— Sin especificar</SelectItem>
                    {TIPO_COMERCIALIZACION.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* País + Moneda + Tasa de cambio */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">País</Label>
                <Select
                  value={form.country || "_none"}
                  onValueChange={v => setForm(p => ({ ...p, country: v === "_none" ? "" : v }))}
                >
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
                  <SelectContent className="max-h-60">
                    <SelectItem value="_none">— Sin especificar</SelectItem>
                    {PAISES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Moneda</Label>
                <Input placeholder="USD" value={form.default_currency} onChange={sf("default_currency")} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tasa de cambio</Label>
                <Input type="number" step="0.01" placeholder="1" value={form.default_exchange_rate} onChange={sf("default_exchange_rate")} className="h-9" />
              </div>
            </div>

            {/* Comercial interno + Email */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Comercial (interno)</Label>
                <Input placeholder="Quién gestiona este proveedor" value={form.comercial} onChange={sf("comercial")} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Email</Label>
                <Input type="email" placeholder="contacto@empresa.com" value={form.email} onChange={sf("email")} className="h-9" />
              </div>
            </div>

            {/* Dirección */}
            <div className="space-y-1">
              <Label className="text-xs">Dirección</Label>
              <Input placeholder="Dirección del proveedor" value={form.address} onChange={sf("address")} className="h-9" />
            </div>

            {/* Contactos dinámicos (nombre + cargo + teléfono) */}
            <div className="space-y-2">
              <Label className="text-xs">Contactos del proveedor</Label>
              {form.contacts.map((contact, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <span className="text-xs text-muted-foreground w-[68px] shrink-0 text-right mt-2.5">
                    Contacto {idx + 1}
                  </span>
                  <div className="flex-1 grid grid-cols-3 gap-2">
                    <Input
                      placeholder="Nombre"
                      value={contact.name}
                      onChange={e => {
                        const next = form.contacts.map((c, i) => i === idx ? { ...c, name: e.target.value } : c);
                        setForm(p => ({ ...p, contacts: next }));
                      }}
                      className="h-9 text-sm"
                    />
                    <Input
                      placeholder="Cargo"
                      value={contact.cargo}
                      onChange={e => {
                        const next = form.contacts.map((c, i) => i === idx ? { ...c, cargo: e.target.value } : c);
                        setForm(p => ({ ...p, contacts: next }));
                      }}
                      className="h-9 text-sm"
                    />
                    <Input
                      placeholder="Teléfono"
                      value={contact.telefono}
                      onChange={e => {
                        const next = form.contacts.map((c, i) => i === idx ? { ...c, telefono: e.target.value } : c);
                        setForm(p => ({ ...p, contacts: next }));
                      }}
                      className="h-9 text-sm"
                    />
                  </div>
                  {idx > 0 && (
                    <Button
                      type="button" variant="ghost" size="sm"
                      className="h-9 w-9 p-0 text-muted-foreground hover:text-destructive shrink-0 mt-0"
                      onClick={() => setForm(p => ({ ...p, contacts: p.contacts.filter((_, i) => i !== idx) }))}
                    >
                      <X size={14} />
                    </Button>
                  )}
                </div>
              ))}
              {form.contacts.length < 5 && (
                <Button
                  type="button" variant="outline" size="sm" className="h-8 text-xs ml-[80px]"
                  onClick={() => setForm(p => ({ ...p, contacts: [...p.contacts, { name: "", cargo: "", telefono: "" }] }))}
                >
                  <Plus size={12} className="mr-1" /> Agregar contacto
                </Button>
              )}
            </div>

            {/* Productos Global */}
            <ProductoMultiSelect
              label="Productos Global"
              options={PRODUCTOS_GLOBAL}
              value={form.productos_global}
              onChange={v => setForm(p => ({ ...p, productos_global: v }))}
            />

            {/* Productos Específicos */}
            <ProductoMultiSelect
              label="Productos Específicos"
              options={PRODUCTOS_ESPECIFICOS}
              value={form.productos_especificos}
              onChange={v => setForm(p => ({ ...p, productos_especificos: v }))}
            />

            {/* Contrato + Próximo contacto */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Próximo contacto previsto</Label>
                <Input
                  type="date"
                  value={form.next_contact_date}
                  onChange={sf("next_contact_date")}
                  min={today}
                  className="h-9"
                />
                {form.next_contact_date && form.next_contact_date < today && (
                  <p className="text-[10px] text-destructive">La fecha no puede ser anterior a hoy</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Notas del contrato</Label>
                <Input
                  placeholder="Ej: Vence dic 2026, condiciones especiales..."
                  value={form.contract_notes}
                  onChange={sf("contract_notes")}
                  className="h-9"
                  disabled={!form.has_contract}
                />
              </div>
            </div>

            {/* Activo + Contrato */}
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="is_active"
                  checked={form.is_active}
                  onCheckedChange={checked => setForm(p => ({ ...p, is_active: !!checked }))}
                />
                <Label htmlFor="is_active" className="text-xs cursor-pointer">Proveedor activo</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="has_contract"
                  checked={form.has_contract}
                  onCheckedChange={checked => setForm(p => ({ ...p, has_contract: !!checked }))}
                />
                <Label htmlFor="has_contract" className="text-xs cursor-pointer flex items-center gap-1">
                  <FileText size={11} /> Tiene contrato
                </Label>
              </div>
            </div>

            {/* Acciones */}
            <div className="flex gap-2 justify-end pt-2 border-t border-border">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? "Guardando..." : editing ? "Actualizar" : "Crear Proveedor"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Confirmar eliminación ────────────────────────────────────────────── */}
      <Dialog open={!!showDeleteId} onOpenChange={() => setShowDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>¿Eliminar proveedor?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Esta acción no se puede deshacer. Las ofertas y pedidos vinculados a este proveedor no serán eliminados.
          </p>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" size="sm" onClick={() => setShowDeleteId(null)}>Cancelar</Button>
            <Button variant="destructive" size="sm" onClick={() => handleDelete(showDeleteId)}>Eliminar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
