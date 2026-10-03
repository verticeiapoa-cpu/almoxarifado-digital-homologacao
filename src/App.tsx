/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { lazy, Suspense, type ReactNode } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { LogIn, LogOut } from 'lucide-react';

const NewDelivery = lazy(() => import('./pages/NewDelivery'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const More = lazy(() => import('./pages/More'));
const History = lazy(() => import('./pages/History'));
const Employees = lazy(() => import('./pages/Employees'));
const Materials = lazy(() => import('./pages/Materials'));
const Obras = lazy(() => import('./pages/Obras'));
const UsersPage = lazy(() => import('./pages/Users'));
const AlertSettings = lazy(() => import('./pages/AlertSettings'));
const TemporaryAssignments = lazy(() => import('./pages/TemporaryAssignments'));

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, profile, loading, accessError, signIn, signOut, refreshProfile } = useAuth();
  
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Carregando...</div>;
  }

  if (user && !profile) {
    return <main className="login-shell"><section className="login-card">
      <h1 className="text-xl font-semibold">Login Google confirmado</h1>
      <p className="login-description" role="alert">{accessError || 'Seu perfil de acesso ainda não foi carregado.'}</p>
      <button onClick={refreshProfile} className="login-primary-button">Tentar carregar meu acesso</button>
      <button onClick={signOut} className="login-secondary-button">Sair e usar outra conta</button>
    </section></main>;
  }
  
  if (!user || !profile) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <div className="login-logo">
            <svg viewBox="0 0 32 24" fill="currentColor">
              <path d="M 2 4 L 11 20 L 16 13 L 21 20 L 30 4 L 25 4 L 19 14 L 16 10 L 13 14 L 7 4 Z" />
            </svg>
            <strong>WSELENT</strong>
          </div>
          <div className="login-message"><span>SEGURANÇA HOJE.</span><strong>RESULTADOS SEMPRE.</strong></div>
          <p className="login-description">
            {accessError || 'Faça login para registrar e consultar entregas do almoxarifado.'}
          </p>
          {user ? (
            <button onClick={signOut} className="login-secondary-button">
              <LogOut className="w-4 h-4" /> Sair e usar outra conta
            </button>
          ) : (
            <button onClick={signIn} className="login-primary-button">
              <LogIn className="w-4 h-4" /> Entrar com Google
            </button>
          )}
        </div>
      </div>
    );
  }
  
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Carregando módulo...</div>}>
          <Routes>
            <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
              <Route index element={<Dashboard />} />
              <Route path="delivery" element={<NewDelivery />} />
              <Route path="history" element={<History />} />
              <Route path="employees" element={<Employees />} />
              <Route path="materials" element={<Materials />} />
              <Route path="obras" element={<Obras />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="settings/stock-alerts" element={<AlertSettings />} />
              <Route path="temporary-assignments" element={<Navigate to="/employees" replace />} />
              <Route path="more" element={<More />} />
            </Route>
          </Routes>
        </Suspense>
      </HashRouter>
    </AuthProvider>
  );
}
