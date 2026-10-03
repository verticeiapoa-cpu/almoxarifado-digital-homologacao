import React, { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../lib/firebase';
import { collection, query, getDocs, limit, orderBy, startAfter, where, type DocumentData, type QueryConstraint, type QueryDocumentSnapshot } from 'firebase/firestore';
import { Delivery, Employee } from '../types';
import { FileText, Download, Building2, Search } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import { logError } from '../lib/logger';

interface EmployeeFicha {
  employee: Employee;
  deliveries: Delivery[];
  totalItems: number;
  lastUpdate: string | null;
}

export default function History() {
  const { activeObraId, activeObra, profile, isAdmin } = useAuth();
  const [employeeFichas, setEmployeeFichas] = useState<EmployeeFicha[]>([]);
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(25);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreDeliveries, setHasMoreDeliveries] = useState(false);
  const [error, setError] = useState('');
  const deliveryCursorsRef = useRef<Array<QueryDocumentSnapshot<DocumentData> | null>>([]);
  const deliveriesRef = useRef<Delivery[]>([]);
  const contextKeyRef = useRef('');
  const [historyPage, setHistoryPage] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      if (!profile || (!isAdmin && !activeObraId)) return;
      const contextKey = `${profile.companyId}:${activeObraId}`;
      const isLoadMore = historyPage > 0 && contextKeyRef.current === contextKey;
      if (!isLoadMore) {
        contextKeyRef.current = contextKey;
        deliveryCursorsRef.current = [];
        deliveriesRef.current = [];
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      setError('');
      try {
        const employeeConstraints = [where('companyId', '==', profile.companyId)];
        if (activeObraId !== 'ALL') employeeConstraints.push(where('obraId', '==', activeObraId));
        const empSnap = await getDocs(query(collection(db, 'employees'), ...employeeConstraints));
        const buildDeliveryQuery = (field?: string, cursor?: QueryDocumentSnapshot<DocumentData> | null) => {
          const constraints: QueryConstraint[] = [where('companyId', '==', profile.companyId)];
          if (field) constraints.push(where(field, '==', activeObraId));
          constraints.push(orderBy('serverCreatedAt', 'desc'));
          if (cursor) constraints.push(startAfter(cursor));
          constraints.push(limit(50));
          return query(collection(db, 'deliveries'), ...constraints);
        };
        const deliverySnapshots = activeObraId === 'ALL'
          ? [await getDocs(buildDeliveryQuery(undefined, deliveryCursorsRef.current[0]))]
          : await Promise.all([
              getDocs(buildDeliveryQuery('obraId', deliveryCursorsRef.current[0])),
              getDocs(buildDeliveryQuery('serviceObraId', deliveryCursorsRef.current[1])),
            ]);
        const employees = empSnap.docs.map(d => ({ id: d.id, ...d.data() } as Employee));
        const deliveriesMap = new Map<string, Delivery>(deliveriesRef.current.map(delivery => [delivery.id, delivery]));
        deliverySnapshots.forEach(snapshot => snapshot.docs.forEach(item => deliveriesMap.set(item.id, { id: item.id, ...item.data() } as Delivery)));
        const deliveries = [...deliveriesMap.values()];
        deliveriesRef.current = deliveries;
        deliveryCursorsRef.current = deliverySnapshots.map(snapshot => snapshot.size === 50 ? snapshot.docs[snapshot.docs.length - 1] : null);
        setHasMoreDeliveries(deliverySnapshots.some(snapshot => snapshot.size === 50));
        const employeesById = new Map(employees.map(employee => [employee.id, employee]));
        const deliveriesByEmployee = new Map<string, Delivery[]>();

        for (const delivery of deliveries) {
          const current = deliveriesByEmployee.get(delivery.employeeId) || [];
          current.push(delivery);
          deliveriesByEmployee.set(delivery.employeeId, current);
        }

        const grouped = Array.from(deliveriesByEmployee.entries()).map(([employeeId, employeeDeliveries]) => {
          const sorted = [...employeeDeliveries].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          const latest = sorted[0];
          const liveEmployee = employeesById.get(employeeId);
          const employee: Employee = liveEmployee || {
            id: employeeId,
            name: latest.employeeName,
            cpf: latest.employeeCpf,
            jobTitle: latest.employeeJobTitle,
            obraId: latest.obraId || '',
            obraName: latest.employeeObraName,
            companyId: latest.companyId,
            isOutsourced: latest.employeeIsOutsourced,
            isActive: false,
          };

          return {
            employee,
            deliveries: employeeDeliveries,
            totalItems: employeeDeliveries.reduce(
              (total, delivery) => total + delivery.items.reduce(
                (subtotal, item) => subtotal + (typeof item.quantity === 'number' ? item.quantity : 1),
                0
              ),
              0
            ),
            lastUpdate: latest.timestamp,
          };
        });

        grouped.sort((a, b) => new Date(b.lastUpdate || 0).getTime() - new Date(a.lastUpdate || 0).getTime());
        setEmployeeFichas(grouped);
      } catch (err) {
        logError('history-load-failed', err);
        setError('Ocorreu um erro ao carregar o histórico de fichas. Confira as regras e os índices do Firestore.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    };

    fetchData();
  }, [activeObraId, profile, isAdmin, historyPage]);

  const displayedFichas = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    const filtered = !term ? employeeFichas : employeeFichas.filter(({ employee }) =>
      [employee.name, employee.cpf, employee.jobTitle, employee.obraName]
        .some(value => value?.toLocaleLowerCase('pt-BR').includes(term))
    );
    return filtered.slice(0, visibleCount);
  }, [employeeFichas, search, visibleCount]);

  const filteredCount = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR');
    if (!term) return employeeFichas.length;
    return employeeFichas.filter(({ employee }) =>
      [employee.name, employee.cpf, employee.jobTitle, employee.obraName]
        .some(value => value?.toLocaleLowerCase('pt-BR').includes(term))
    ).length;
  }, [employeeFichas, search]);

  useEffect(() => {
    setVisibleCount(25);
  }, [search, employeeFichas]);

  const handleDownload = async (ficha: EmployeeFicha) => {
    try {
      const { generateEmployeeFicha, downloadPdf } = await import('../utils/pdfGenerator');
      const blob = await generateEmployeeFicha(ficha.employee, ficha.deliveries);
      downloadPdf(blob, `Ficha-EPI-${ficha.employee.name.replace(/\s+/g, '-')}.pdf`);
    } catch (downloadError) {
      logError('history-pdf-generation-failed', downloadError);
      alert('Erro ao gerar a Ficha de EPI.');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Fichas de EPI (Histórico)</h2>
            {activeObra && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-cyan-100 text-cyan-800">
                <Building2 className="w-3 h-3" /> {activeObra.name}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-1">Histórico imutável, agrupado por funcionário, inclusive para cadastros inativos.</p>
        </div>
        <label className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Buscar nome, CPF, cargo ou obra"
            className="w-full min-h-[44px] pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2bb2c8]"
          />
        </label>
      </div>

      {error && <div className="bg-red-50 text-red-600 p-4 rounded-lg text-sm border border-red-100">{error}</div>}

      {loading ? (
        <div className="flex justify-center items-center py-12"><div className="w-8 h-8 border-4 border-slate-200 border-t-[#2bb2c8] rounded-full animate-spin" /></div>
      ) : displayedFichas.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">Nenhuma ficha encontrada.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 whitespace-nowrap">Funcionário</th>
                  <th className="px-6 py-4 whitespace-nowrap">Cargo / Obra atual</th>
                  <th className="px-6 py-4 text-center whitespace-nowrap">EPIs recebidos</th>
                  <th className="px-6 py-4 whitespace-nowrap">Última retirada</th>
                  <th className="px-6 py-4 text-right whitespace-nowrap">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {displayedFichas.map(ficha => (
                  <tr key={ficha.employee.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900">{ficha.employee.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">CPF: {ficha.employee.cpf || '-'}</div>
                      {!ficha.employee.isActive && <span className="inline-flex mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-200 text-slate-600">CADASTRO INATIVO</span>}
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-slate-900">{ficha.employee.jobTitle}</div>
                      <div className="text-xs text-slate-500">{ficha.employee.obraName || '-'}</div>
                      {ficha.deliveries.some(delivery => delivery.isFloatingEmployee) && <span className="inline-flex mt-1 mr-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan-100 text-cyan-800">HISTÓRICO FLUTUANTE</span>}
                      <span className={`inline-flex mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${ficha.employee.isOutsourced ? 'bg-orange-100 text-orange-800' : 'bg-green-100 text-green-800'}`}>
                        {ficha.employee.isOutsourced ? 'TERCEIRIZADO' : 'PRÓPRIO'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center"><span className="inline-flex px-2.5 py-0.5 rounded-full bg-[#f0fbfd] text-[#2198ac] font-medium text-xs">{ficha.totalItems} itens</span></td>
                    <td className="px-6 py-4 text-slate-700">{ficha.lastUpdate ? new Date(ficha.lastUpdate).toLocaleDateString('pt-BR') : '-'}</td>
                    <td className="px-6 py-4 text-right">
                      <button onClick={() => handleDownload(ficha)} className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-[#2bb2c8] hover:bg-[#f0fbfd] rounded-lg">
                        <Download className="w-4 h-4" /> Baixar Ficha
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(visibleCount < filteredCount || hasMoreDeliveries) && (
            <div className="flex items-center justify-center gap-3 border-t border-slate-200 bg-slate-50 px-4 py-4">
              <span className="text-xs text-slate-500">
                Exibindo {displayedFichas.length} de {filteredCount}{hasMoreDeliveries ? '+' : ''}
              </span>
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => {
                  setVisibleCount(current => current + 25);
                  if (hasMoreDeliveries) setHistoryPage(current => current + 1);
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                {loadingMore ? 'Carregando...' : 'Carregar mais'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
