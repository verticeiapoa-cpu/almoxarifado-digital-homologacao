import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Building2, ClipboardCheck, HardHat, History, PackagePlus, Shield, UserPlus, Users } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { logWarning } from '../lib/logger';

export default function Dashboard() {
  const { profile, user, isAdmin, activeObraId } = useAuth();
  const [summary, setSummary] = useState({ employees: 0, materials: 0, deliveries: 0, lowStock: 0 });
  const firstName = (profile?.name || user?.displayName || 'Responsável').split(' ')[0];

  useEffect(() => {
    const loadSummary = async () => {
      if (!profile) return;
      const employeeFilters = [where('companyId', '==', profile.companyId)];
      const deliveryFilters = [where('companyId', '==', profile.companyId)];
      const stockFilters = [where('companyId', '==', profile.companyId)];
      if (activeObraId !== 'ALL') {
        employeeFilters.push(where('obraId', '==', activeObraId));
        deliveryFilters.push(where('serviceObraId', '==', activeObraId));
        stockFilters.push(where('obraId', '==', activeObraId));
      }
      try {
        const [employees, materials, deliveries] = await Promise.all([
          getDocs(query(collection(db, 'employees'), ...employeeFilters)),
          getDocs(query(collection(db, 'inventoryStock'), ...stockFilters)),
          getDocs(query(collection(db, 'deliveries'), ...deliveryFilters)),
        ]);
        const lowStock = materials.docs.filter(item => {
          const data = item.data();
          return Number(data.minimumStock || 0) > 0 && Number(data.quantity || 0) <= Number(data.minimumStock || 0);
        }).length;
        const totalUnits = materials.docs.reduce((sum, item) => sum + Number(item.data().quantity || 0), 0);
        setSummary({ employees: employees.size, materials: totalUnits, deliveries: deliveries.size, lowStock });
      } catch (error) {
        logWarning('dashboard-load-failed', error);
      }
    };
    loadSummary();
  }, [profile, activeObraId]);

  const actions = [
    { to: '/delivery', title: 'Entregar EPI', subtitle: 'Registrar nova entrega', icon: HardHat, primary: true },
    { to: '/employees', title: 'Novo Funcionário', subtitle: 'Cadastrar e gerenciar', icon: UserPlus },
    ...(isAdmin ? [{ to: '/obras', title: 'Nova Obra', subtitle: 'Criar e configurar', icon: Building2 }] : []),
    { to: '/materials', title: 'Estoque de EPIs', subtitle: 'Consultar catálogo', icon: PackagePlus },
    { to: '/history', title: 'Consultar Histórico', subtitle: 'Entregas e fichas', icon: History },
    ...(isAdmin ? [{ to: '/users', title: 'Acessos', subtitle: 'Vincular almoxarifes', icon: Users }] : []),
  ];

  return (
    <div className="dashboard-page">
      <section className="dashboard-welcome">
        <div>
          <p className="dashboard-eyebrow">PAINEL OPERACIONAL</p>
          <h2>Olá, {firstName}!</h2>
          <p>Segurança em primeiro lugar.</p>
        </div>
        <ClipboardCheck className="dashboard-welcome-icon" />
      </section>

      <section>
        <h3 className="section-title">Acesso rápido</h3>
        <div className="quick-grid">
          {actions.map(({ to, title, subtitle, icon: Icon, primary }) => (
            <Link key={to} to={to} className={`quick-card${primary ? ' quick-card-primary' : ''}`}>
              <span className="quick-icon"><Icon /></span>
              <strong>{title}</strong>
              <small>{subtitle}</small>
            </Link>
          ))}
        </div>
      </section>

      {summary.lowStock > 0 && <Link to="/materials" className="dashboard-stock-alert"><AlertTriangle /><span><strong>{summary.lowStock} {summary.lowStock === 1 ? 'EPI precisa' : 'EPIs precisam'} de reposição</strong><small>Toque para consultar o estoque baixo.</small></span></Link>}

      <section>
        <div className="section-heading-row">
          <h3 className="section-title">Resumo do sistema</h3>
          <Link to="/materials">Ver estoque</Link>
        </div>
        <div className="summary-grid">
          <div className="summary-card"><Shield /><strong>{summary.materials}</strong><span>Unidades em estoque</span></div>
          <div className="summary-card"><Users /><strong>{summary.employees}</strong><span>Funcionários</span></div>
          <div className="summary-card"><ClipboardCheck /><strong>{summary.deliveries}</strong><span>Entregas registradas</span></div>
        </div>
      </section>
    </div>
  );
}
