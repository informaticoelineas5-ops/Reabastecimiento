import BodegonPropuesta from "@/pages/bodegones/BodegonPropuesta";
import { FF_CONFIG } from "@/pages/bodegones/propuestaConfig";

// Propuesta de reabastecimiento de los almacenes FF: la misma pantalla que Bodegones, sin Script ni Aprobación INV.
export default function FFPropuesta() {
  return <BodegonPropuesta config={FF_CONFIG} />;
}
