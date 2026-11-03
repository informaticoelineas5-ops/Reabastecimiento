import { Warehouse, Store } from "lucide-react";
import { BODEGONES } from "@/utils/bodegonRoles";

// La misma pantalla de propuesta sirve para los bodegones y para los FF: cambia la lista de almacenes,
// las columnas que lleva y lo que se puede hacer con el resultado.
//   almacenes     → { key, label, title }: `key` es el código del almacén; `label` lo que se ve en pantalla
//   showScript    → sección "Script"
//   showGenerar   → botón "Generar Pedido BT" e historial de pedidos
export const BODEGON_CONFIG = {
  id: "bodegon-propuesta",
  icon: Warehouse,
  noun: "Bodegón",
  nounPlural: "bodegones",
  title: "Propuesta de Reabastecimiento",
  almacenes: BODEGONES.map(key => ({ key, label: key, title: key })),
  defaultAlmacen: "1053",
  showScript: true,
  showGenerar: true,
  stockHeader: "Stock bodegón",
  loadingAll: "de los bodegones",
  loadingOne: "del bodegón",
  exportName: "propuesta_bodegones",
  sheetName: "Propuesta Bodegones",
};

// Almacenes FF (tipo "ff" en la lista de almacenes). Nombre TKC: "B23 Electrocuba FF-Yeya <ciudad> (<clave>)".
export const FF_ALMACENES = [
  { key: "1964", label: "Pinar",      title: "B23 Electrocuba FF-Yeya Pinar (1964)" },
  { key: "1965", label: "Matanzas",   title: "B23 Electrocuba FF-Yeya Matanzas (1965)" },
  { key: "1966", label: "Cienfuegos", title: "B23 Electrocuba FF-Yeya Cienfuegos (1966)" },
  { key: "1967", label: "Centro",     title: "B23 Electrocuba FF-Yeya Centro (1967)" },
  { key: "1968", label: "Camagüey",   title: "B23 Electrocuba FF-Yeya Camagüey (1968)" },
  { key: "1969", label: "Holguín",    title: "B23 Electrocuba FF-Yeya Holguín (1969)" },
  { key: "1970", label: "Santiago",   title: "B23 Electrocuba FF-Yeya Santiago (1970)" },
];

export const FF_CONFIG = {
  id: "ff-propuesta",
  icon: Store,
  noun: "FF",
  nounPlural: "FF",
  title: "Propuesta FF",
  almacenes: FF_ALMACENES,
  defaultAlmacen: FF_ALMACENES[0].key,
  showScript: false,
  showGenerar: false,
  stockHeader: "Stock FF",
  loadingAll: "de los FF",
  loadingOne: "del FF",
  exportName: "propuesta_ff",
  sheetName: "Propuesta FF",
};
