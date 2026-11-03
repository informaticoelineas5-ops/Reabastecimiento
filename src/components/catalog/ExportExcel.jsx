import React, { useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, Loader2 } from "lucide-react";

export default function ExportExcel({ offers, filters }) {
  const [loading, setLoading] = useState(false);

  const handleExport = () => {
    setLoading(true);
    setTimeout(() => {
      const rows = offers.map((o) => {
        const diferencia = (o.existencia_fisica || 0) - ((o.stock_reserva || 0) + (o.stock_tienda || 0));
        const foto = o.fotos?.[0];
        return {
          "Imagen": foto?.foto ?? foto ?? "",
          "Código": o.codigo || "",
          "Nombre": o.nombre || "",
          "Marca": o.marca || "",
          "Proveedor": o.proveedor || "",
          "ID Online": o.offer_external_id || "",
          "Precio": o.precio ?? "",
          "Existencia Física": o.existencia_fisica ?? 0,
          "Stock Reserva": o.stock_reserva ?? 0,
          "Stock Tienda": o.stock_tienda ?? 0,
          "Diferencia (Física - Reserva - Tienda)": diferencia,
          "Clasificación": o.clasificacion || "",
          "Proveedor Producto": o.proveedor || "",
          "Eliminado": o.is_dead ? "Sí" : "No",
          "En Revisión": o.revision ? "Sí" : "No",
          "Usa Catálogo": o.usa_catalogo ? "Sí" : "No",
          "Diff Catálogo": o.has_catalog_diff ? "Sí" : "No",
          "Disponible Oferta": o.available_for_offer ? "Sí" : "No",
          "Categoría Online": o.categoria_online || "",
          "Categoría Almacén": o.categoria_almacen || "",
          "Canal": o.canal || "",
        };
      });

      const ws = XLSX.utils.json_to_sheet(rows);

      // Column widths
      ws["!cols"] = [
        { wch: 40 }, { wch: 12 }, { wch: 35 }, { wch: 20 }, { wch: 20 }, { wch: 14 },
        { wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 13 }, { wch: 30 },
        { wch: 14 }, { wch: 20 }, { wch: 10 }, { wch: 12 }, { wch: 13 },
        { wch: 13 }, { wch: 17 }, { wch: 20 }, { wch: 20 }, { wch: 10 },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Catálogo");
      XLSX.writeFile(wb, `catalogo_${new Date().toISOString().split("T")[0]}.xlsx`);
      setLoading(false);
    }, 50);
  };

  return (
    <Button variant="outline" size="sm" onClick={handleExport} disabled={loading}>
      {loading ? (
        <Loader2 size={14} className="mr-1.5 animate-spin" />
      ) : (
        <FileSpreadsheet size={14} className="mr-1.5 text-green-600" />
      )}
      Excel
    </Button>
  );
}