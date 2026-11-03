export const CURRENT_VERSION = "2.1";

export const CHANGELOG = [
  {
    version: "2.1",
    date: "Junio 2026",
    title: "Flujo de compras completo + mejoras de gestión",
    changes: [
      { type: "new",     text: "Flujo post-confirmación: nuevos estados 'En Tránsito' y 'Pagado' con registro de cantidades reales pagadas por ítem" },
      { type: "new",     text: "Modal de Pago: campo de referencia/factura y detección de discrepancias entre lo pedido y lo pagado" },
      { type: "new",     text: "Pestaña 'Cantidades Pagadas' en el detalle del pedido con tabla comparativa y total pagado" },
      { type: "new",     text: "Stepper visual de progreso del pedido en 7 etapas dentro del detalle" },
      { type: "new",     text: "Módulo Proveedores: campo de contrato, plan de contacto con alertas, historial de pedidos y fecha del último pedido" },
      { type: "new",     text: "Filtro por categoría de producto en el módulo Proveedores" },
      { type: "new",     text: "Sección 'Plan de Contacto' — proveedores a contactar en los próximos 14 días con alertas de urgencia" },
      { type: "new",     text: "Panel de Compras: tabla de estado por proveedor y seguimiento de ofertas en el tiempo con estado de pedido vinculado" },
      { type: "improve", text: "Vista previa de foto del producto al pasar el cursor en Propuesta & Pedido" },
      { type: "improve", text: "Imágenes de producto visibles en el proceso de asociación de IDs" },
      { type: "improve", text: "Estado de asociación en pestaña Ítems ahora muestra el código y nombre del producto vinculado" },
      { type: "improve", text: "Índice de ventas se muestra como número entero si es ≥ 1, decimales solo si < 1" },
      { type: "improve", text: "Mini-estadísticas en la cabecera de Ofertas de Proveedores, Pedidos de Compra y Proveedores" },
      { type: "fix",     text: "Nombres de productos ya no se cortan en la tabla de Propuesta & Pedido" },
      { type: "fix",     text: "Login ahora muestra correctamente 'Sistema de Reabastecimiento' como título principal" },
      { type: "fix",     text: "Manual de Usuario corregido: nombre de empresa 'Mercado Elíneas'" },
      { type: "fix",     text: "El rol 'Inventario' ahora puede visualizar los Pedidos de Compra" },
    ],
  },
  {
    version: "2.0",
    date: "Mayo 2026",
    title: "Lanzamiento del sistema de Reabastecimiento",
    changes: [
      { type: "new", text: "Módulo de Catálogo con índices de ventas e índice AVG" },
      { type: "new", text: "Módulo de Ofertas de Proveedores con importación de archivos" },
      { type: "new", text: "Flujo de aprobación IC → Revisor → Comercial" },
      { type: "new", text: "Propuesta de compra automática basada en índices de ventas" },
      { type: "new", text: "Dashboard con KPIs del proceso de reabastecimiento" },
    ],
  },
];
