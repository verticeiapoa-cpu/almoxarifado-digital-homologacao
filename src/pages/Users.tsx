import React, { useEffect, useState } from 'react';
import { db } from '../lib/firebase';
import { collection, query, getDocs, doc, setDoc, updateDoc, where } from 'firebase/firestore';
import { UserProfile, UserInvitation, UserRole } from '../types';
import { ADMIN_EMAIL, useAuth } from '../lib/AuthContext';
import { Users as UsersIcon, Shield, Building2, Edit2, Plus, X } from 'lucide-react';
import { cn } from '../components/Layout';
import { logError } from '../lib/logger';

export default function UsersPage() {
  const { profile, isAdmin, obras } = useAuth();
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [invitations, setInvitations] = useState<UserInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [isNewUserModalOpen, setIsNewUserModalOpen] = useState(false);

  // Form for pre-registering a new storekeeper / admin
  const [newUserData, setNewUserData] = useState({
    name: '',
    email: '',
    role: 'storekeeper' as UserRole,
    assignedObraIds: [] as string[],
  });

  const fetchUsers = async () => {
    try {
      setLoading(true);
      if (!profile) return;
      const q = query(collection(db, 'users'), where('companyId', '==', profile.companyId));
      const inviteQuery = query(collection(db, 'invitations'), where('companyId', '==', profile.companyId));
      const [snap, inviteSnap] = await Promise.all([getDocs(q), getDocs(inviteQuery)]);
      const list = snap.docs.map(d => ({ ...d.data() } as UserProfile));
      setUsersList(list);
      setInvitations(inviteSnap.docs.map(d => ({ ...d.data() } as UserInvitation)));
    } catch (err) {
      logError('users-load-failed', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchUsers();
    }
  }, [isAdmin, profile?.companyId]);

  if (!isAdmin) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
        <Shield className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <h3 className="text-lg font-semibold text-slate-800">Acesso Restrito</h3>
        <p className="text-slate-500 text-sm mt-1">
          Apenas administradores podem gerenciar usuários e permissões de almoxarifes.
        </p>
      </div>
    );
  }

  const handleToggleObra = (obraId: string, currentIds: string[], isNewModal: boolean = false) => {
    let updated: string[];
    if (currentIds.includes(obraId)) {
      updated = currentIds.filter(id => id !== obraId);
    } else {
      updated = [...currentIds, obraId];
    }

    if (isNewModal) {
      setNewUserData(prev => ({ ...prev, assignedObraIds: updated }));
    } else if (editingUser) {
      setEditingUser({ ...editingUser, assignedObraIds: updated });
    }
  };

  const handleSaveEdit = async () => {
    if (!editingUser) return;
    if (editingUser.email === ADMIN_EMAIL && editingUser.role !== 'admin') {
      alert('O administrador principal não pode ser rebaixado.');
      return;
    }
    try {
      const docRef = doc(db, 'users', editingUser.uid);
      const updatedProfile = {
        ...editingUser,
        updatedAt: new Date().toISOString()
      };
      await updateDoc(docRef, {
        name: updatedProfile.name,
        role: updatedProfile.role,
        assignedObraIds: updatedProfile.role === 'admin' ? ['ALL'] : updatedProfile.assignedObraIds,
        updatedAt: updatedProfile.updatedAt,
      });

      setUsersList(prev => prev.map(u => u.uid === editingUser.uid ? updatedProfile : u));
      setEditingUser(null);
    } catch (err) {
      logError('user-permissions-save-failed', err);
      alert("Erro ao atualizar permissões do usuário.");
    }
  };

  const handleCreatePreRegisteredUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserData.email) return;
    if (newUserData.role === 'storekeeper' && newUserData.assignedObraIds.length === 0) {
      alert('Selecione pelo menos uma obra para o almoxarife.');
      return;
    }

    try {
      const now = new Date().toISOString();
      const normalizedEmail = newUserData.email.toLowerCase().trim();
      const docRef = doc(db, 'invitations', normalizedEmail);
      
      const invitation: UserInvitation = {
        email: normalizedEmail,
        name: newUserData.name.trim() || newUserData.email.split('@')[0],
        companyId: profile?.companyId || 'wselent-default',
        companyName: profile?.companyName || 'Wselent Empreendimentos',
        role: newUserData.role,
        assignedObraIds: newUserData.role === 'admin' ? ['ALL'] : newUserData.assignedObraIds,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        createdBy: profile?.uid || '',
      };

      await setDoc(docRef, invitation);
      await fetchUsers();
      setIsNewUserModalOpen(false);
      setNewUserData({
        name: '',
        email: '',
        role: 'storekeeper',
        assignedObraIds: [],
      });
    } catch (err) {
      logError('user-invitation-create-failed', err);
      alert("Erro ao cadastrar usuário.");
    }
  };

  const handleRevokeInvitation = async (invitation: UserInvitation) => {
    if (!window.confirm(`Revogar o convite de ${invitation.email}?`)) return;
    try {
      await updateDoc(doc(db, 'invitations', invitation.email), {
        status: 'revoked',
        updatedAt: new Date().toISOString(),
      });
      await fetchUsers();
    } catch (err) {
      logError('user-invitation-revoke-failed', err);
      alert('Erro ao revogar o convite.');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Almoxarifes & Usuários</h2>
          <p className="text-sm text-slate-500 mt-1">
            Defina quem tem acesso ao sistema e quais canteiros de obras cada almoxarife pode gerenciar.
          </p>
        </div>
        <button
          onClick={() => setIsNewUserModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#2bb2c8] text-white rounded-lg font-medium hover:bg-[#2198ac] transition-colors shadow-sm self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          Convidar / Vincular Usuário
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-12">
          <div className="w-8 h-8 border-4 border-slate-200 border-t-[#2bb2c8] rounded-full animate-spin" />
        </div>
      ) : usersList.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
          <UsersIcon className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">Nenhum usuário cadastrado.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4 whitespace-nowrap">Usuário</th>
                  <th className="px-6 py-4 whitespace-nowrap">Perfil (Função)</th>
                  <th className="px-6 py-4 whitespace-nowrap">Obras Liberadas</th>
                  <th className="px-6 py-4 text-right whitespace-nowrap">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {usersList.map((u) => {
                  const isCurrentLogged = u.uid === profile?.uid;
                  const isUserAdmin = u.role === 'admin';
                  return (
                    <tr key={u.uid} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-900 flex items-center gap-2">
                          {u.name}
                          {isCurrentLogged && (
                            <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">Você</span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500">{u.email}</div>
                      </td>
                      <td className="px-6 py-4">
                        {isUserAdmin ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">
                            <Shield className="w-3 h-3" /> Administrador
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-cyan-100 text-cyan-800">
                            <Building2 className="w-3 h-3" /> Almoxarife
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {isUserAdmin || u.assignedObraIds?.includes('ALL') ? (
                          <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-1 rounded">
                            Todas as Obras da Empresa
                          </span>
                        ) : u.assignedObraIds?.length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {u.assignedObraIds.map(obraId => {
                              const obra = obras.find(o => o.id === obraId);
                              return (
                                <span key={obraId} className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                                  {obra ? obra.name : obraId}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded font-medium">
                            Nenhuma obra vinculada
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => setEditingUser(u)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                        >
                          <Edit2 className="w-3.5 h-3.5 text-slate-500" />
                          Gerenciar Acesso
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {invitations.some(invitation => invitation.status === 'pending') && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h3 className="font-semibold text-slate-900">Convites pendentes</h3>
            <p className="text-xs text-slate-500 mt-1">O acesso será ativado somente quando o e-mail convidado entrar com o Google.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {invitations.filter(invitation => invitation.status === 'pending').map(invitation => (
              <div key={invitation.email} className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">{invitation.name}</p>
                  <p className="text-xs text-slate-500">{invitation.email} · {invitation.role === 'admin' ? 'Administrador' : `${invitation.assignedObraIds.length} obra(s)`}</p>
                </div>
                <button type="button" onClick={() => handleRevokeInvitation(invitation)} className="text-xs font-medium text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg self-start sm:self-auto">
                  Revogar convite
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit User Permissions Modal */}
      {editingUser && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 border border-slate-200">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Gerenciar Acesso do Usuário</h3>
                <p className="text-xs text-slate-500 mt-0.5">{editingUser.name} ({editingUser.email})</p>
              </div>
              <button 
                onClick={() => setEditingUser(null)} 
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Perfil de Acesso</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setEditingUser({ ...editingUser, role: 'admin', assignedObraIds: ['ALL'] })}
                    className={cn(
                      "p-3 rounded-lg border text-left transition-all",
                      editingUser.role === 'admin' 
                        ? "border-[#2bb2c8] bg-[#f0fbfd] text-slate-900 ring-1 ring-[#2bb2c8]" 
                        : "border-slate-200 hover:bg-slate-50 text-slate-600"
                    )}
                  >
                    <div className="font-semibold text-sm flex items-center gap-1.5">
                      <Shield className="w-4 h-4 text-purple-600" /> Administrador
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Acesso a todas as obras, relatórios e controle de usuários.</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditingUser({ ...editingUser, role: 'storekeeper' })}
                    disabled={editingUser.email === ADMIN_EMAIL}
                    className={cn(
                      "p-3 rounded-lg border text-left transition-all",
                      editingUser.role === 'storekeeper' 
                        ? "border-[#2bb2c8] bg-[#f0fbfd] text-slate-900 ring-1 ring-[#2bb2c8]" 
                        : "border-slate-200 hover:bg-slate-50 text-slate-600",
                      editingUser.email === ADMIN_EMAIL && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    <div className="font-semibold text-sm flex items-center gap-1.5">
                      <Building2 className="w-4 h-4 text-cyan-600" /> Almoxarife
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Acesso restrito apenas aos canteiros selecionados abaixo.</p>
                  </button>
                </div>
              </div>

              {editingUser.role === 'storekeeper' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Canteiros de Obras Permitidos
                  </label>
                  {obras.length === 0 ? (
                    <p className="text-xs text-amber-600 bg-amber-50 p-2.5 rounded">
                      Cadastre obras na aba "Obras" para poder vincular aos almoxarifes.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-56 overflow-y-auto border border-slate-200 rounded-lg p-3">
                      {obras.map((obra) => {
                        const isAssigned = editingUser.assignedObraIds?.includes(obra.id);
                        return (
                          <label 
                            key={obra.id} 
                            className="flex items-center justify-between p-2 rounded hover:bg-slate-50 cursor-pointer text-sm"
                          >
                            <span className="font-medium text-slate-800">{obra.name}</span>
                            <input 
                              type="checkbox"
                              checked={isAssigned || false}
                              onChange={() => handleToggleObra(obra.id, editingUser.assignedObraIds || [], false)}
                              className="w-4 h-4 text-[#2bb2c8] border-slate-300 rounded focus:ring-[#2bb2c8]"
                            />
                          </label>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-xs text-slate-500 mt-1.5">
                    O almoxarife só conseguirá emitir fichas e ver colaboradores dos canteiros marcados acima.
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors text-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="px-5 py-2 bg-[#2bb2c8] text-white font-medium hover:bg-[#2198ac] rounded-lg transition-colors text-sm"
              >
                Salvar Permissões
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pre-register / Invite User Modal */}
      {isNewUserModalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <form onSubmit={handleCreatePreRegisteredUser} className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 border border-slate-200">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Novo Almoxarife / Usuário</h3>
                <p className="text-xs text-slate-500 mt-0.5">Cadastre o e-mail do colaborador para vincular suas obras previamente.</p>
              </div>
              <button 
                type="button"
                onClick={() => setIsNewUserModalOpen(false)} 
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nome Completo</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Carlos Almoxarifado"
                  value={newUserData.name}
                  onChange={(e) => setNewUserData({ ...newUserData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2bb2c8]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">E-mail Google do Usuário</label>
                <input
                  type="email"
                  required
                  placeholder="usuario@gmail.com ou email corporativo"
                  value={newUserData.email}
                  onChange={(e) => setNewUserData({ ...newUserData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2bb2c8]"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Quando esse e-mail fizer login pela primeira vez com o Google, já herdará os acessos configurados aqui.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Perfil</label>
                <select
                  value={newUserData.role}
                  onChange={(e) => setNewUserData({ ...newUserData, role: e.target.value as UserRole })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2bb2c8]"
                >
                  <option value="storekeeper">Almoxarife (Acesso a obras específicas)</option>
                  <option value="admin">Administrador (Acesso irrestrito a todas as obras)</option>
                </select>
              </div>

              {newUserData.role === 'storekeeper' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Selecione as Obras que ele irá atender:
                  </label>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto border border-slate-200 rounded-lg p-2.5">
                    {obras.map(obra => {
                      const isChecked = newUserData.assignedObraIds.includes(obra.id);
                      return (
                        <label key={obra.id} className="flex items-center justify-between p-1.5 rounded hover:bg-slate-50 cursor-pointer text-sm">
                          <span>{obra.name}</span>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleObra(obra.id, newUserData.assignedObraIds, true)}
                            className="w-4 h-4 text-[#2bb2c8] border-slate-300 rounded focus:ring-[#2bb2c8]"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsNewUserModalOpen(false)}
                className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-lg transition-colors text-sm"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-[#2bb2c8] text-white font-medium hover:bg-[#2198ac] rounded-lg transition-colors text-sm"
              >
                Cadastrar Usuário
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
