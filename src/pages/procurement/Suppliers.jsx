import React, { useState } from "react";
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
import { useToast } from "@/components/ui/use-toast";
import {
  Plus, Search, Edit2, Trash2, Building2, Phone, Mail, Globe,
  ToggleLeft, ToggleRight, X, ChevronDown,
} from "lucide-react";
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
  email: "",
  phone: "",
  default_currency: "USD",
  default_exchange_rate: 1,
  address: "",
  contacts: [""],
  productos_global: [],
  productos_especificos: [],
  is_active: true,
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
  const { isAdmin } = useProcurementUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch]           = useState("");
  const [showForm, setShowForm]       = useState(false);
  const [editing, setEditing]         = useState(null);
  const [form, setForm]               = useState(EMPTY_FORM);
  const [saving, setSaving]           = useState(false);
  const [showDeleteId, setShowDeleteId] = useState(null);

  const { data: suppliers = [], isLoading } = useQuery({
    queryKey: ["suppliers"],
    queryFn:  () => base44.entities.Supplier.list("name", 500),
  });

  const filtered = suppliers.filter(s => {
    const q = search.toLowerCase();
    return !q ||
      (s.name || "").toLowerCase().includes(q) ||
      (s.code || "").toLowerCase().includes(q) ||
      (s.contact_name || "").toLowerCase().includes(q) ||
      (s.supplier_type || "").toLowerCase().includes(q) ||
      (s.country || "").toLowerCase().includes(q);
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (s) => {
    setEditing(s);
    // Reconstruye el array de contactos, manteniendo siempre el slot 0
    const contacts = [
      s.contact_name || "",
      s.contact_2    || "",
      s.contact_3    || "",
      s.contact_4    || "",
      s.contact_5    || "",
    ].filter((c, i) => i === 0 || c !== "");

    setForm({
      name:                  s.name || "",
      code:                  s.code || "",
      supplier_type:         s.supplier_type || "",
      comercializacion_type: s.comercializacion_type || "",
      country:               s.country || "",
      email:                 s.email || "",
      phone:                 s.phone || "",
      default_currency:      s.default_currency || "USD",
      default_exchange_rate: s.default_exchange_rate || 1,
      address:               s.address || "",
      contacts:              contacts.length > 0 ? contacts : [""],
      productos_global:      s.productos_global || [],
      productos_especificos: s.productos_especificos || [],
      is_active:             s.is_active !== false,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast({ title: "El nombre del proveedor es obligatorio", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const payload = { name: form.name.trim() };
      if (form.code)                 payload.code = form.code.trim().toUpperCase();
      if (form.supplier_type)        payload.supplier_type = form.supplier_type;
      if (form.comercializacion_type) payload.comercializacion_type = form.comercializacion_type;
      if (form.country)              payload.country = form.country;
      if (form.email)                payload.email = form.email;
      if (form.phone)                payload.phone = form.phone;
      if (form.address)              payload.address = form.address;
      if (form.default_currency)     payload.default_currency = form.default_currency;
      const exRate = parseFloat(form.default_exchange_rate);
      if (!isNaN(exRate))            payload.default_exchange_rate = exRate;

      // Contactos: mapea el array a columnas individuales
      const [c1, c2, c3, c4, c5] = form.contacts;
      payload.contact_name = c1 || "";
      payload.contact_2    = c2 || null;
      payload.contact_3    = c3 || null;
      payload.contact_4    = c4 || null;
      payload.contact_5    = c5 || null;

      // Arrays (siempre se envían para soportar limpiar selecciones en update)
      payload.productos_global      = form.productos_global;
      payload.productos_especificos = form.productos_especificos;

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
    <div className="p-4 md:p-6 space-y-4 max-w-[1200px] mx-auto">

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

      {/* Búsqueda */}
      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
        <Input
          placeholder="Buscar por nombre, ID, país..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-8 h-9"
        />
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
            const allContacts = [s.contact_name, s.contact_2, s.contact_3, s.contact_4, s.contact_5].filter(Boolean);
            return (
              <Card key={s.id} className={`p-4 ${!s.is_active ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0 space-y-2">
                    {/* ID + Nombre + Estado */}
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
                    </div>

                    {/* Tipo proveedor + Comercialización + País */}
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
                    </div>

                    {/* Contacto + Email + Teléfono + Moneda */}
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {allContacts.length > 0 && (
                        <span>
                          {allContacts[0]}
                          {allContacts.length > 1 && <span className="ml-1 text-[10px]">+{allContacts.length - 1} más</span>}
                        </span>
                      )}
                      {s.email && (
                        <span className="flex items-center gap-1"><Mail size={10} /> {s.email}</span>
                      )}
                      {s.phone && (
                        <span className="flex items-center gap-1"><Phone size={10} /> {s.phone}</span>
                      )}
                      {s.default_currency && (
                        <span>
                          {s.default_currency}
                          {s.default_exchange_rate && s.default_exchange_rate !== 1
                            ? ` · TC ×${s.default_exchange_rate}` : ""}
                        </span>
                      )}
                    </div>

                    {/* Productos Global (primeros 3 + contador) */}
                    {s.productos_global?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {s.productos_global.slice(0, 3).map(p => (
                          <Badge key={p} variant="outline" className="text-[10px] bg-primary/5 border-primary/20 text-primary">
                            {p}
                          </Badge>
                        ))}
                        {s.productos_global.length > 3 && (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground">
                            +{s.productos_global.length - 3}
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

            {/* Email + Teléfono */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Email</Label>
                <Input type="email" placeholder="contacto@empresa.com" value={form.email} onChange={sf("email")} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Teléfono</Label>
                <Input placeholder="+1 555 000 0000" value={form.phone} onChange={sf("phone")} className="h-9" />
              </div>
            </div>

            {/* Dirección */}
            <div className="space-y-1">
              <Label className="text-xs">Dirección</Label>
              <Input placeholder="Dirección física del proveedor" value={form.address} onChange={sf("address")} className="h-9" />
            </div>

            {/* Contactos dinámicos */}
            <div className="space-y-2">
              <Label className="text-xs">Contactos</Label>
              {form.contacts.map((contact, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-[72px] shrink-0 text-right">
                    Contacto {idx + 1}
                  </span>
                  <Input
                    placeholder={idx === 0 ? "Nombre del contacto principal" : `Nombre del contacto ${idx + 1}`}
                    value={contact}
                    onChange={e => {
                      const next = [...form.contacts];
                      next[idx] = e.target.value;
                      setForm(p => ({ ...p, contacts: next }));
                    }}
                    className="h-9 flex-1"
                  />
                  {idx > 0 && (
                    <Button
                      type="button" variant="ghost" size="sm"
                      className="h-9 w-9 p-0 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => setForm(p => ({ ...p, contacts: p.contacts.filter((_, i) => i !== idx) }))}
                    >
                      <X size={14} />
                    </Button>
                  )}
                </div>
              ))}
              {form.contacts.length < 5 && (
                <Button
                  type="button" variant="outline" size="sm" className="h-8 text-xs ml-[88px]"
                  onClick={() => setForm(p => ({ ...p, contacts: [...p.contacts, ""] }))}
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

            {/* Activo */}
            <div className="flex items-center gap-2">
              <Checkbox
                id="is_active"
                checked={form.is_active}
                onCheckedChange={checked => setForm(p => ({ ...p, is_active: !!checked }))}
              />
              <Label htmlFor="is_active" className="text-xs cursor-pointer">Proveedor activo</Label>
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
