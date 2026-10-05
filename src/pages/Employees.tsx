import React, { useEffect, useRef, useState } from 'react';
import { db } from '../lib/firebase';
import { collection, query, getDocs, doc, setDoc, updateDoc, where } from 'firebase/firestore';
import { Employee, Obra } from '../types';
import { Users, Plus, UserX, UserCheck, Edit2, Building2 } from 'lucide-react';
import { cn } from '../components/Layout';
import { useAuth } from '../lib/AuthContext';
import { logError } from '../lib/logger';
import TemporaryAssignments from './TemporaryAssignments';
import { cpfDigits, validateEmployeeDraft } from '../lib/employeeForm';

export default function Employees() {
  const { activeObraId, activeObra, profile, userObras, isAdmin } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const obras: Obra[] = userObras;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [savedMessage, setSavedMessage] = useState('');
  const fetchSequence = useRef(0);
  const saving = useRef(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [initialForm, setInitialForm] = useState<string>('');

  const [formData, setFormData] = useState({
    name: '',
    cpf: '',
    jobTitle: '',
    obraId: activeObraId !== 'ALL' ? activeObraId : '',
    isOutsourced: false,
  });

  const fetchData = async () => {
    if (!profile || (!isAdmin && !activeObraId)) return;
    const sequence = ++fetchSequence.current;
    setLoading(true);
    setLoadError('');
    setEmployees([]);
    try {
      const constraints = [where('companyId', '==', profile.companyId)];
      if (activeObraId !== 'ALL') constraints.push(where('obraId', '==', activeObraId));
      const empQ = query(collection(db, 'employees'), ...constraints);
      const empSnap = await getDocs(empQ);
      if (sequence !== fetchSequence.current) return;
      setEmployees(empSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee)));
    } catch (err) {
      logError('employees-load-failed', err);
      if (sequence === fetchSequence.current) setLoadError('Não foi possível carregar os funcionários. Verifique a conexão e tente novamente.');
    } finally {
      if (sequence === fetchSequence.current) setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [profile, activeObraId, isAdmin]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormErrors(current => ({ ...current, [name]: '', save: '' }));
    
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData(prev => ({ ...prev, [name]: checked }));
    } else if (name === 'obraId') {
      setFormData(prev => ({ ...prev, [name]: value }));
    } else {
      setFormData(prev => ({ ...prev, [name]: value.toUpperCase() }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving.current || !profile) return;
    const { errors, data } = validateEmployeeDraft(formData, profile.companyId);
    if (!obras.some(obra => obra.id === data.obraId)) errors.obraId = 'Selecione uma obra disponível para sua conta.';
    if (employees.some(employee => employee.id !== editingId && cpfDigits(employee.cpf) === cpfDigits(data.cpf))) {
      errors.cpf = 'Este CPF já está cadastrado na lista de funcionários desta obra. Edite ou reative o cadastro existente.';
    }
    setFormErrors(errors);
    if (Object.keys(errors).length) return;
    saving.current = true;
    setSavedMessage('');
    setIsSubmitting(true);
    try {
      const selectedObra = obras.find(o => o.id === formData.obraId);
      
      const docRef = editingId ? doc(db, 'employees', editingId) : doc(collection(db, 'employees'));
      const employeeData = {
        ...formData,
        ...data,
        obraName: selectedObra ? selectedObra.name : '',
        obraCno: selectedObra?.cno || '',
        companyId: profile.companyId,
        id: docRef.id,
        updatedAt: new Date().toISOString(),
      };
      if (editingId) {
        await updateDoc(docRef, employeeData);
      } else {
        await setDoc(docRef, {
          ...employeeData,
          isActive: true,
          createdAt: new Date().toISOString(),
        });
      }
      
      resetForm();
      setSavedMessage('Funcionário salvo com sucesso.');
      await fetchData();
    } catch (err) {
      logError('employee-save-failed', err);
      const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
      setFormErrors({ save: code === 'permission-denied'
        ? 'Seu acesso não permite salvar esse cadastro. Confira a obra e as permissões com o administrador.'
        : 'Não foi possível confirmar o salvamento. Os dados continuam no formulário; confira a conexão antes de tentar novamente.' });
    } finally {
      setIsSubmitting(false);
      saving.current = false;
    }
  };

  const openForm = () => {
    setFormErrors({});
    setSavedMessage('');
    setIsFormOpen(true);
    window.history.pushState(
      { ...(window.history.state || {}), wselentForm: 'employees' },
      '',
      window.location.href,
    );
  };

  const closeForm = () => {
    const shouldReturn = window.history.state?.wselentForm === 'employees';
    setIsFormOpen(false);
    setEditingId(null);
    if (shouldReturn) window.history.back();
  };

  useEffect(() => {
    const onPopState = () => {
      if (window.history.state?.wselentForm !== 'employees' && isFormOpen) {
        setIsFormOpen(false);
        setEditingId(null);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [isFormOpen]);

  const handleEdit = (employee: Employee) => {
    setInitialForm(JSON.stringify({ name: employee.name, cpf: employee.cpf || '', jobTitle: employee.jobTitle, obraId: employee.obraId || '', isOutsourced: employee.isOutsourced || false }));
    setFormData({
      name: employee.name,
      cpf: employee.cpf || '',
      jobTitle: employee.jobTitle,
      obraId: employee.obraId || '',
      isOutsourced: employee.isOutsourced || false,
    });
    setEditingId(employee.id);
    openForm();
  };

  const handleToggleActive = async (employee: Employee) => {
    const nextStatus = !employee.isActive;
    if (!window.confirm(`${nextStatus ? 'Reativar' : 'Inativar'} este funcionário? O histórico será preservado.`)) return;
    try {
      await updateDoc(doc(db, 'employees', employee.id), {
        isActive: nextStatus,
        updatedAt: new Date().toISOString(),
      });
      await fetchData();
    } catch (err) {
      logError('employee-status-update-failed', err);
      alert('Erro ao alterar o status do funcionário.');
    }
  };

  const resetForm = () => {
    setFormErrors({});
    setFormData({
      name: '',
      cpf: '',
      jobTitle: '',
      obraId: activeObraId !== 'ALL' ? activeObraId : '',
      isOutsourced: false,
    });
    closeForm();
  };

  const displayedEmployees = employees.filter(emp => {
    if (activeObraId === 'ALL') return true;
    return emp.obraId === activeObraId;
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Funcionários</h2>
            {activeObra && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-cyan-100 text-cyan-800">
                <Building2 className="w-3 h-3" /> {activeObra.name}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-1">Gerencie os funcionários cadastrados no sistema.</p>
        </div>
        {!isFormOpen && (
          <button 
            onClick={openForm}
            className="flex items-center gap-2 px-4 py-2 bg-[#2bb2c8] text-white rounded-lg font-medium hover:bg-[#2198ac] transition-colors shadow-sm self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            Novo Funcionário
          </button>
        )}
      </div>

      {savedMessage && <p role="status" className="p-3 rounded-lg bg-emerald-50 text-emerald-800">{savedMessage}</p>}
      {loadError && <div role="alert" className="p-4 rounded-lg bg-red-50 text-red-800">{loadError}<button type="button" onClick={fetchData} className="secondary-action ml-2">Tentar novamente</button></div>}
      {isFormOpen && (
        <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <h3 className="text-lg font-medium text-slate-900 mb-4">
            {editingId ? 'Editar Funcionário' : 'Cadastrar Funcionário'}
          </h3>
          {formErrors.save && <p role="alert" className="mb-4 text-sm text-red-700">{formErrors.save}</p>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="md:col-span-2">
              <label htmlFor="employee-name" className="block text-sm font-medium text-slate-700 mb-1">Nome Completo *</label>
              <input id="employee-name" required maxLength={100} aria-invalid={!!formErrors.name} aria-describedby={formErrors.name ? 'employee-name-error' : undefined} name="name" value={formData.name} onChange={handleInputChange} className="w-full px-3 py-2.5 sm:py-2 min-h-[44px] bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2bb2c8]" />
              {formErrors.name && <p id="employee-name-error" className="mt-1 text-sm text-red-700">{formErrors.name}</p>}
            </div>
            <div>
              <label htmlFor="employee-cpf" className="block text-sm font-medium text-slate-700 mb-1">CPF *</label>
              <input id="employee-cpf" required maxLength={14} inputMode="numeric" autoComplete="off" aria-invalid={!!formErrors.cpf} aria-describedby={formErrors.cpf ? 'employee-cpf-error' : undefined} name="cpf" value={formData.cpf} onChange={handleInputChange} className="w-full px-3 py-2.5 sm:py-2 min-h-[44px] bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2bb2c8]" />
              {formErrors.cpf && <p id="employee-cpf-error" className="mt-1 text-sm text-red-700">{formErrors.cpf}</p>}
            </div>
            <div>
              <label htmlFor="employee-job" className="block text-sm font-medium text-slate-700 mb-1">Cargo *</label>
              <input id="employee-job" required maxLength={100} aria-invalid={!!formErrors.jobTitle} name="jobTitle" value={formData.jobTitle} onChange={handleInputChange} className="w-full px-3 py-2.5 sm:py-2 min-h-[44px] bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2bb2c8]" />
              {formErrors.jobTitle && <p className="mt-1 text-sm text-red-700">{formErrors.jobTitle}</p>}
            </div>
            <div>
              <label htmlFor="employee-obra" className="block text-sm font-medium text-slate-700 mb-1">Obra de vínculo / CNO *</label>
              <select id="employee-obra" required aria-invalid={!!formErrors.obraId} name="obraId" value={formData.obraId} onChange={handleInputChange} className="w-full px-3 py-2.5 sm:py-2 min-h-[44px] bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2bb2c8]">
                <option value="">Selecione a obra...</option>
                {obras.map(obra => (
                  <option key={obra.id} value={obra.id}>{obra.name}</option>
                ))}
              </select>
              {formErrors.obraId && <p className="mt-1 text-sm text-red-700">{formErrors.obraId}</p>}
            </div>
            <div className="flex items-center mt-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" name="isOutsourced" checked={formData.isOutsourced} onChange={handleInputChange} className="w-4 h-4 text-[#2bb2c8] border-slate-300 rounded focus:ring-[#2bb2c8]" />
                <span className="text-sm font-medium text-slate-700">Funcionário Terceirizado?</span>
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={resetForm} className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors">Cancelar</button>
            <button type="submit" disabled={isSubmitting} className="px-6 py-2 bg-[#2bb2c8] text-white rounded-lg font-medium hover:bg-[#2198ac] transition-colors disabled:opacity-70">
              {isSubmitting ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      )}

      {isFormOpen && editingId && isAdmin && <section className="employee-temporary"><p className="text-sm text-slate-600 mb-4">A alocação temporária abaixo não altera a obra de vínculo nem o CNO.</p><TemporaryAssignments key={editingId} employeeId={editingId} hasUnsavedChanges={JSON.stringify(formData) !== initialForm} /></section>}

      {loading ? (
        <div className="flex justify-center items-center py-12">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-[#2bb2c8] rounded-full animate-spin" />
        </div>
      ) : loadError ? null : displayedEmployees.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
          <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">Nenhum funcionário encontrado.</p>
          {activeObra && (
            <p className="text-xs text-slate-400 mt-1">Nenhum colaborador vinculado a esta obra específica.</p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 whitespace-nowrap">Nome / CPF</th>
                  <th className="px-6 py-4 whitespace-nowrap">Cargo</th>
                  <th className="px-6 py-4 whitespace-nowrap">Obra / Vínculo</th>
                  <th className="px-6 py-4 whitespace-nowrap">Status</th>
                  <th className="px-6 py-4 text-right whitespace-nowrap">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {displayedEmployees.map(emp => (
                  <tr key={emp.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900">{emp.name}</div>
                      <div className="text-xs text-slate-500">CPF: {emp.cpf || '-'}</div>
                    </td>
                    <td className="px-6 py-4 text-slate-700">{emp.jobTitle}</td>
                    <td className="px-6 py-4">
                      <div className="text-slate-900">{emp.obraName || '-'}</div>
                      <div className="text-xs mt-0.5">
                        {emp.isOutsourced ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-800">TERCEIRIZADO</span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-800">PRÓPRIO</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        'inline-flex px-2 py-1 rounded text-[10px] font-semibold',
                        emp.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                      )}>
                        {emp.isActive ? 'ATIVO' : 'INATIVO'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button onClick={() => handleEdit(emp)} className="p-2 text-slate-500 hover:text-blue-600 rounded-lg transition-colors"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={() => handleToggleActive(emp)} className={cn('p-2 rounded-lg transition-colors', emp.isActive ? 'text-slate-500 hover:text-red-600' : 'text-emerald-600 hover:text-emerald-700')} title={emp.isActive ? 'Inativar' : 'Reativar'}>
                        {emp.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
