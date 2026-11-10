import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeftRight, Building2, ClipboardCheck, FileSpreadsheet, HardHat, History, PackagePlus, Shield, UserPlus, Users } from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { logWarning } from '../lib/logger';
import type { InventoryStock } from '../types';
import { fetchMovements } from '../lib/reportData';
import { buildDataScope } from '../lib/reports';
import { formatDateTime, formatSignedQuantity, type MovementView } from '../lib/movements';
import { compareBySeverity, stockLevel, summarizeStocks } from '../lib/stockStatus';
import { MovementTypeBadge, StockLevelBadge } from '../components/StockUi';

export default function Dashboard() {
  const { profile, user, isAdmin, activeObraId, obras } = useAuth();
  const [summary, setSummary] = useState({ employees: 0, materials: 0, deliveries: 0, lowStock: 0 });
  const [stocks, setStocks] = useState<InventoryStock[]>([]);
  const [recent, setRecent] = useState<MovementView[]>([]);
  const [recentError, setRecentError] = useState(false);
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
        setStocks(materials.docs.map(item => ({ ...item.data(), id: item.id } as InventoryStock)));
      } catch (error) {
        logWarning('dashboard-load-failed', error);
      }
    };
    loadSummary();
  }, [profile, activeObraId]);

  // Movimentações recentes (somente leitura, dentro do escopo de obras do usuário).
  useEffect(() => {
    if (!profile || !activeObraId) { setRecent([]); return; }
    let cancelled = false;
    setRecentError(false);
    fetchMovements(db, buildDataScope(profile, obras), activeObraId, { max: 6 })
      .then(result => { if (!cancelled) setRecent(result.rows); })
      .catch(error => { logWarning('dashboard-recent-movements-failed', error); if (!cancelled) { setRecent([]); setRecentError(true); } });
    return () => { cancelled = true; };
  }, [profile, obras, activeObraId]);

  const stockSummary = useMemo(() => summarizeStocks(stocks), [stocks]);
  const attention = useMemo(() => stocks.filter(stock => stockLevel(stock) !== 'ok').sort(compareBySeverity).slice(0, 8), [stocks]);
  const perObra = useMemo(() => {
    const groups = new Map<string, { name: string; items: InventoryStock[] }>();
    stocks.forEach(stock => {
      const group = groups.get(stock.obraId) ?? { name: stock.obraName, items: [] };
      group.items.push(stock);
      groups.set(stock.obraId, group);
    });
    return [...groups.entries()].map(([id, group]) => ({ id, name: group.name, ...summarizeStocks(group.items) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [stocks]);

  const actions = [
    { to: '/delivery', title: 'Entregar EPI', subtitle: 'Registrar nova entrega', icon: HardHat, primary: true },
    { to: '/employees', title: 'Novo Funcionário', subtitle: 'Cadastrar e gerenciar', icon: UserPlus },
    ...(isAdmin ? [{ to: '/obras', title: 'Nova Obra', subtitle: 'Criar e configurar', icon: Building2 }] : []),
    { to: '/materials', title: 'Estoque de EPIs', subtitle: 'Consultar catálogo', icon: PackagePlus },
    { to: '/history', title: 'Consultar Histórico', subtitle: 'Entregas e fichas', icon: History },
    { to: '/movements', title: 'Movimentações', subtitle: 'Entradas, entregas e ajustes', icon: ArrowLeftRight },
    { to: '/reports', title: 'Relatórios', subtitle: 'Exportar em CSV', icon: FileSpreadsheet },
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

      {activeObraId !== '' && <section aria-label="Indicadores de estoque">
        <div className="section-heading-row">
          <h3 className="section-title">Estoque {activeObraId === 'ALL' ? 'de todas as obras' : 'da obra atual'}</h3>
          <Link to="/materials">Ver estoque</Link>
        </div>
        <div className="kpi-grid">
          <div className="kpi-card"><strong>{stockSummary.items}</strong><span>Itens cadastrados</span></div>
          <div className="kpi-card"><strong>{stockSummary.units}</strong><span>Unidades em estoque</span></div>
          <div className={`kpi-card${stockSummary.belowMinimum > 0 ? ' kpi-card-warn' : ''}`}><strong>{stockSummary.belowMinimum}</strong><span>Abaixo do mínimo</span></div>
          <div className={`kpi-card${stockSummary.byLevel.out + stockSummary.byLevel.critical > 0 ? ' kpi-card-danger' : ''}`}><strong>{stockSummary.byLevel.out + stockSummary.byLevel.critical}</strong><span>Críticos ou sem saldo</span></div>
        </div>
      </section>}

      {activeObraId !== '' && <section aria-label="Itens que precisam de atenção">
        <h3 className="section-title">Precisam de atenção</h3>
        <div className="panel-card">
          {attention.length === 0 ? <p className="panel-empty">Nenhum item abaixo do mínimo ou sem saldo.</p> : attention.map(stock => (
            <div key={stock.id} className="panel-row">
              <div className="panel-row-main"><strong>{stock.materialDescription}</strong><small>{activeObraId === 'ALL' ? `${stock.obraName} · ` : ''}{stock.quantity} {stock.unit} · mínimo {stock.minimumStock}</small></div>
              <StockLevelBadge level={stockLevel(stock)} />
            </div>
          ))}
        </div>
      </section>}

      {isAdmin && activeObraId === 'ALL' && perObra.length > 0 && <section aria-label="Indicadores por obra">
        <h3 className="section-title">Por obra</h3>
        <div className="panel-card">
          {perObra.map(obra => (
            <div key={obra.id} className="panel-row">
              <div className="panel-row-main"><strong>{obra.name}</strong><small>{obra.items} itens · {obra.units} unidades</small></div>
              <small className={obra.belowMinimum > 0 ? 'qty-out' : 'text-slate-500'}>{obra.belowMinimum} abaixo do mínimo</small>
            </div>
          ))}
        </div>
      </section>}

      {activeObraId !== '' && <section aria-label="Movimentações recentes">
        <div className="section-heading-row">
          <h3 className="section-title">Movimentações recentes</h3>
          <Link to="/movements">Ver todas</Link>
        </div>
        <div className="panel-card">
          {recentError ? <p className="panel-empty">Não foi possível carregar as movimentações agora.</p>
            : recent.length === 0 ? <p className="panel-empty">Nenhuma movimentação registrada.</p>
            : recent.map(row => (
              <div key={row.id} className="panel-row">
                <div className="panel-row-main"><strong>{row.materialDescription || 'Item não identificado'}</strong><small>{formatDateTime(row.createdAt) || 'Sem data'}</small></div>
                <div className="flex items-center gap-2"><MovementTypeBadge type={row.type} label={row.typeLabel} /><span className={row.quantity === null ? '' : row.quantity > 0 ? 'qty-in' : 'qty-out'}>{formatSignedQuantity(row.quantity)}</span></div>
              </div>
            ))}
        </div>
      </section>}

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
