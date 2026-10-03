import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, Timestamp, where, writeBatch } from 'firebase/firestore';
import { CalendarClock, CircleOff, Plus, UserRoundCheck } from 'lucide-react';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import type { Employee, TemporaryAssignment } from '../types';
import { logError } from '../lib/logger';

const toLocalInput = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const toDate = (value: unknown) => {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate() as Date;
  return new Date(String(value));
};

export default function TemporaryAssignments({ employeeId, hasUnsavedChanges = false }: { employeeId?: string; hasUnsavedChanges?: boolean }) {
  const { profile, user, isAdmin, userObras, activeObraId } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [assignments, setAssignments] = useState<TemporaryAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(Boolean(employeeId));
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const tomorrow = useMemo(() => new Date(Date.now() + 48 * 60 * 60 * 1000), []);
  const [form, setForm] = useState({ employeeId: employeeId || '', hostObraId: '', startsAt: toLocalInput(new Date()), endsAt: toLocalInput(tomorrow), reason: '' });

  const load = async () => {
    if (!profile) return;
    setLoading(true);
    setLoadError('');
    try {
      const assignmentQuery = isAdmin || activeObraId === 'ALL'
        ? query(collection(db, 'temporaryAssignments'), where('companyId', '==', profile.companyId))
        : query(collection(db, 'temporaryAssignments'), where('companyId', '==', profile.companyId), where('hostObraId', '==', activeObraId));
      const assignmentSnapshot = await getDocs(employeeId
        ? query(collection(db, 'temporaryAssignments'), where('companyId', '==', profile.companyId), where('employeeId', '==', employeeId))
        : assignmentQuery);
      setAssignments(assignmentSnapshot.docs.map(item => ({ id: item.id, ...item.data() } as TemporaryAssignment)));
      if (isAdmin) {
        if (employeeId) {
          const snapshot = await getDoc(doc(db, 'employees', employeeId));
          setEmployees(snapshot.exists() ? [{ ...snapshot.data(), id: snapshot.id } as Employee] : []);
        } else {
        const employeeSnapshot = await getDocs(query(collection(db, 'employees'), where('companyId', '==', profile.companyId)));
        setEmployees(employeeSnapshot.docs.map(item => ({ id: item.id, ...item.data() } as Employee)).filter(item => item.isActive && (!employeeId || item.id === employeeId)));
        }
      }
    } catch (error) {
      logError('temporary-assignment-load-failed', error);
      setLoadError('Não foi possível carregar o cadastro e as alocações. Verifique as permissões de acesso e tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [profile?.companyId, isAdmin, activeObraId, employeeId]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile || !user || !isAdmin) return;
    if (loading || saving) return;
    if (loadError) { alert(loadError); return; }
    if (hasUnsavedChanges) { alert('Salve primeiro as alterações do cadastro e reabra a edição para autorizar a alocação temporária.'); return; }
    const employee = employees.find(item => item.id === (employeeId || form.employeeId));
    const hostObra = userObras.find(item => item.id === form.hostObraId);
    if (!employee) { alert('O funcionário não foi carregado. Reabra a edição do cadastro.'); return; }
    if (!employee.isActive) { alert('Reative o funcionário antes de autorizar uma alocação temporária.'); return; }
    if (!hostObra) { alert('Selecione uma obra temporária disponível.'); return; }
    if (employee.obraId === hostObra.id) {
      alert(`A obra temporária é igual à obra de vínculo salva: ${employee.obraName}. Escolha outra obra.`);
      return;
    }
    const start = new Date(form.startsAt);
    const end = new Date(form.endsAt);
    if (!(end > start)) {
      alert('A data final deve ser posterior à data inicial.');
      return;
    }
    setSaving(true);
    try {
      const reference = doc(collection(db, 'temporaryAssignments'));
      const now = new Date().toISOString();
      const assignmentData = {
        id: reference.id,
        companyId: profile.companyId,
        employeeId: employee.id,
        employeeName: employee.name,
        homeObraId: employee.obraId,
        homeObraName: employee.obraName,
        hostObraId: hostObra.id,
        hostObraName: hostObra.name,
        startsAt: Timestamp.fromDate(start),
        endsAt: Timestamp.fromDate(end),
        reason: form.reason.trim(),
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
        createdBy: user.uid,
      };
      const batch = writeBatch(db);
      assignments.filter(item => item.employeeId === employee.id && item.status === 'ACTIVE').forEach(item => {
        batch.update(doc(db, 'temporaryAssignments', item.id), { status: 'CANCELLED', updatedAt: now });
      });
      batch.set(reference, assignmentData);
      batch.set(doc(db, 'temporaryEmployeeAccess', employee.id), {
        id: employee.id,
        companyId: profile.companyId,
        employeeId: employee.id,
        assignmentId: reference.id,
        hostObraId: hostObra.id,
        startsAt: assignmentData.startsAt,
        endsAt: assignmentData.endsAt,
        active: true,
        updatedAt: now,
      });
      await batch.commit();
      setForm({ employeeId: employeeId || '', hostObraId: '', startsAt: toLocalInput(new Date()), endsAt: toLocalInput(tomorrow), reason: '' });
      setFormOpen(false);
      await load();
    } catch (error) {
      logError('temporary-assignment-save-failed', error);
      alert('Não foi possível criar a alocação temporária.');
    } finally {
      setSaving(false);
    }
  };

  const cancelAssignment = async (assignment: TemporaryAssignment) => {
    if (!isAdmin || !window.confirm('Cancelar esta alocação temporária? O histórico será preservado.')) return;
    const batch = writeBatch(db);
    batch.update(doc(db, 'temporaryAssignments', assignment.id), { status: 'CANCELLED', updatedAt: new Date().toISOString() });
    if (!assignments.some(item => item.employeeId === assignment.employeeId && item.id !== assignment.id && item.status === 'ACTIVE' && toDate(item.endsAt) > new Date())) {
      batch.update(doc(db, 'temporaryEmployeeAccess', assignment.employeeId), { active: false, updatedAt: new Date().toISOString() });
    }
    await batch.commit();
    await load();
  };

  const now = new Date();
  const visibleAssignments = assignments
    .filter(item => !employeeId || item.employeeId === employeeId)
    .map(item => ({ ...item, effectiveStatus: item.status === 'ACTIVE' && toDate(item.endsAt) < now ? 'EXPIRED' : item.status }))
    .sort((a, b) => toDate(b.startsAt).getTime() - toDate(a.startsAt).getTime());

  return (
    <div className="flex flex-col gap-6">
      {loadError && <div role="alert" className="p-4 rounded-lg bg-red-50 text-red-800">{loadError}<button type="button" className="secondary-action ml-2" onClick={load}>Tentar novamente</button></div>}
      {hasUnsavedChanges && <p role="status" className="p-4 bg-amber-50 text-amber-900">Há alterações cadastrais não salvas. Salve o cadastro antes de autorizar o período.</p>}
      <div className="flex justify-between items-end gap-3"><div><h2 className="text-2xl font-semibold tracking-tight text-slate-900">Funcionários flutuantes</h2><p className="text-sm text-slate-500 mt-1">Autorize o atendimento temporário sem alterar a obra de vínculo.</p></div>{isAdmin && !formOpen && <button onClick={() => setFormOpen(true)} className="primary-action"><Plus />Nova alocação</button>}</div>
      {isAdmin && formOpen && <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 sm:p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Alocação temporária</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {!employeeId && <div><label className="field-label">Funcionário *</label><select required value={form.employeeId} onChange={event => setForm(current => ({ ...current, employeeId: event.target.value }))} className="field-control"><option value="">Selecione...</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name} — vínculo: {employee.obraName}</option>)}</select></div>}
          <div><label className="field-label">Obra temporária *</label><select required value={form.hostObraId} onChange={event => setForm(current => ({ ...current, hostObraId: event.target.value }))} className="field-control"><option value="">Selecione...</option>{userObras.map(obra => <option key={obra.id} value={obra.id}>{obra.name}</option>)}</select></div>
          <div><label className="field-label">Início *</label><input required type="datetime-local" value={form.startsAt} onChange={event => setForm(current => ({ ...current, startsAt: event.target.value }))} className="field-control" /></div>
          <div><label className="field-label">Fim *</label><input required type="datetime-local" value={form.endsAt} onChange={event => setForm(current => ({ ...current, endsAt: event.target.value }))} className="field-control" /></div>
          <div className="md:col-span-2"><label className="field-label">Motivo *</label><textarea required minLength={5} maxLength={300} value={form.reason} onChange={event => setForm(current => ({ ...current, reason: event.target.value }))} className="field-control min-h-24" placeholder="Ex.: apoio emergencial na concretagem por dois dias" /></div>
        </div>
        <div className="flex justify-end gap-3 mt-5"><button type="button" onClick={() => setFormOpen(false)} className="secondary-action">Cancelar</button><button type="submit" disabled={saving || loading || Boolean(loadError) || hasUnsavedChanges} className="primary-action">{saving ? 'Salvando...' : loading ? 'Carregando...' : 'Autorizar período'}</button></div>
      </form>}
      {loading ? <div className="flex justify-center py-12"><div className="spinner" /></div> : visibleAssignments.length === 0 ? <div className="empty-card"><UserRoundCheck /><strong>Nenhuma alocação temporária</strong><span>Os funcionários continuam vinculados às suas obras de origem.</span></div> : <div className="temporary-list">{visibleAssignments.map(assignment => <article key={assignment.id} className="temporary-card"><span className="temporary-icon"><CalendarClock /></span><div><strong>{assignment.employeeName}</strong><p><b>Vínculo:</b> {assignment.homeObraName}</p><p><b>Temporária:</b> {assignment.hostObraName}</p><small>{toDate(assignment.startsAt).toLocaleString('pt-BR')} até {toDate(assignment.endsAt).toLocaleString('pt-BR')}</small><small>Motivo: {assignment.reason}</small></div><div className="temporary-status"><span data-status={assignment.effectiveStatus}>{assignment.effectiveStatus === 'ACTIVE' ? 'ATIVA' : assignment.effectiveStatus === 'EXPIRED' ? 'EXPIRADA' : 'CANCELADA'}</span>{isAdmin && assignment.effectiveStatus === 'ACTIVE' && <button onClick={() => cancelAssignment(assignment)} title="Cancelar alocação"><CircleOff /></button>}</div></article>)}</div>}
    </div>
  );
}
