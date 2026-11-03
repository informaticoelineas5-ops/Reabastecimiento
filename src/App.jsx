import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { pagesConfig } from './pages.config'
import { HashRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import ImportConfig from './pages/ImportConfig';
import ProcurementDashboard from './pages/procurement/ProcurementDashboard';
import Suppliers from './pages/procurement/Suppliers';
import SupplierOffers from './pages/procurement/SupplierOffers';
import SupplierOfferDetail from './pages/procurement/SupplierOfferDetail';
import PurchaseOrders from './pages/procurement/PurchaseOrders';
import PurchaseOrderDetail from './pages/procurement/PurchaseOrderDetail';
import Agenda from './pages/procurement/Agenda';
import Connectors from './pages/Connectors';
import SalesIndexImport from './pages/SalesIdexImport';
import SalesRanking from './pages/SalesRanking';
import ComparativeAnalysis from './pages/ComparativeAnalysis';
import UserManagement from './pages/admin/UserManagement';
import SystemVariablesConfig from './pages/procurement/SystemVariablesConfig';
import DirectReplenishment from './pages/procurement/DirectReplenishment';
import BodegonPropuesta from './pages/bodegones/BodegonPropuesta';
import BodegonDistribucion from './pages/bodegones/BodegonDistribucion';
import UCPendientes from './pages/bodegones/UCPendientes';
import ProveedoresBodegon from './pages/bodegones/ProveedoresBodegon';
import FFPropuesta from './pages/ff/FFPropuesta';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { apiAuthRefreshToken } from '@/api/apiAuthClient';
import Login from '@/pages/Login';
import { missingSupabaseEnvVars } from '@/api/supabaseClient';
import { useEffect } from 'react';


const ConfigurationRequired = ({ message }) => (
  <div className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
    <div className="mx-auto max-w-2xl rounded-xl border border-amber-200 bg-white p-6 shadow-sm">
      <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-700">
        Configuración local incompleta
      </p>
      <h1 className="text-2xl font-bold">No se puede conectar con Supabase</h1>
      <p className="mt-3 text-slate-600">
        {message} La aplicación ya no queda en blanco: completa la configuración local y reinicia el servidor de desarrollo.
      </p>
      <ol className="mt-5 list-decimal space-y-3 pl-5 text-sm text-slate-700">
        <li>Copia <code className="rounded bg-slate-100 px-1 py-0.5">.env.example</code> como <code className="rounded bg-slate-100 px-1 py-0.5">.env.local</code>.</li>
        <li>Define <code className="rounded bg-slate-100 px-1 py-0.5">VITE_SUPABASE_URL</code> y <code className="rounded bg-slate-100 px-1 py-0.5">VITE_SUPABASE_ANON_KEY</code>.</li>
        <li>Reinicia <code className="rounded bg-slate-100 px-1 py-0.5">npm run dev</code> para que Vite cargue las variables.</li>
      </ol>
      <div className="mt-5 rounded-lg bg-slate-950 p-4 text-sm text-slate-100">
        <p className="font-semibold">Variables faltantes:</p>
        <pre className="mt-2 whitespace-pre-wrap">{missingSupabaseEnvVars.join('\n')}</pre>
      </div>
    </div>
  </div>
);

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
  <Layout currentPageName={currentPageName}>{children}</Layout>
  : <>{children}</>;

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError } = useAuth();

  // Renueva el token al montar y cada 3 min (el token expira en ~5 min)
  useEffect(() => {
    apiAuthRefreshToken().catch(() => {});
    const id = setInterval(() => { apiAuthRefreshToken().catch(() => {}); }, 3 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError?.type === 'configuration_required') {
    return <ConfigurationRequired message={authError.message} />;
  }

  // Si no está autenticado, mostrar login
  if (authError?.type === 'auth_required') {
    return <Login />;
  }

  // Render the main app
  return (
    <>
    <Routes>
      <Route path="/" element={
        <LayoutWrapper currentPageName={mainPageKey}>
          <MainPage />
        </LayoutWrapper>
      } />
      {Object.entries(Pages).map(([path, Page]) => (
        <Route
          key={path}
          path={`/${path}`}
          element={
            <LayoutWrapper currentPageName={path}>
              <Page />
            </LayoutWrapper>
          }
        />
      ))}
      <Route path="/ImportConfig" element={<LayoutWrapper currentPageName="ImportConfig"><ImportConfig /></LayoutWrapper>} />
      <Route path="/Connectors" element={<LayoutWrapper currentPageName="Connectors"><Connectors /></LayoutWrapper>} />
      <Route path="/SalesIndexImport" element={<LayoutWrapper currentPageName="SalesIndexImport"><SalesIndexImport /></LayoutWrapper>} />
      <Route path="/SalesRanking" element={<LayoutWrapper currentPageName="SalesRanking"><SalesRanking /></LayoutWrapper>} />
      <Route path="/ComparativeAnalysis" element={<LayoutWrapper currentPageName="ComparativeAnalysis"><ComparativeAnalysis /></LayoutWrapper>} />
      <Route path="/procurement/Suppliers" element={<LayoutWrapper currentPageName="procurement/Suppliers"><Suppliers /></LayoutWrapper>} />
      <Route path="/procurement/Agenda" element={<LayoutWrapper currentPageName="procurement/Agenda"><Agenda /></LayoutWrapper>} />
      <Route path="/procurement/ProcurementDashboard" element={<LayoutWrapper currentPageName="procurement/ProcurementDashboard"><ProcurementDashboard /></LayoutWrapper>} />
      <Route path="/procurement/SupplierOffers" element={<LayoutWrapper currentPageName="procurement/SupplierOffers"><SupplierOffers /></LayoutWrapper>} />
      <Route path="/procurement/SupplierOfferDetail/:id" element={<LayoutWrapper currentPageName="procurement/SupplierOfferDetail"><SupplierOfferDetail /></LayoutWrapper>} />
      <Route path="/procurement/PurchaseOrders" element={<LayoutWrapper currentPageName="procurement/PurchaseOrders"><PurchaseOrders /></LayoutWrapper>} />
      <Route path="/procurement/PurchaseOrderDetail/:id" element={<LayoutWrapper currentPageName="procurement/PurchaseOrderDetail"><PurchaseOrderDetail /></LayoutWrapper>} />
      <Route path="/admin/UserManagement" element={<LayoutWrapper currentPageName="admin/UserManagement"><UserManagement /></LayoutWrapper>} />
      <Route path="/procurement/VariablesGlobales" element={<LayoutWrapper currentPageName="procurement/VariablesGlobales"><SystemVariablesConfig /></LayoutWrapper>} />
      <Route path="/procurement/DirectReplenishment" element={<LayoutWrapper currentPageName="procurement/DirectReplenishment"><DirectReplenishment /></LayoutWrapper>} />
      <Route path="/bodegones/Propuesta" element={<LayoutWrapper currentPageName="bodegones/Propuesta"><BodegonPropuesta /></LayoutWrapper>} />
      <Route path="/bodegones/Distribucion" element={<LayoutWrapper currentPageName="bodegones/Distribucion"><BodegonDistribucion /></LayoutWrapper>} />
      <Route path="/bodegones/UCPendientes" element={<LayoutWrapper currentPageName="bodegones/UCPendientes"><UCPendientes /></LayoutWrapper>} />
      <Route path="/bodegones/ProveedoresBodegon" element={<LayoutWrapper currentPageName="bodegones/ProveedoresBodegon"><ProveedoresBodegon /></LayoutWrapper>} />
      <Route path="/ff/Propuesta" element={<LayoutWrapper currentPageName="ff/Propuesta"><FFPropuesta /></LayoutWrapper>} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
    </>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App