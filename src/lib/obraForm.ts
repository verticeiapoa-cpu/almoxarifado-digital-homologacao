export interface ObraDraft {
  name: string;
  cno: string;
  address: string;
}

export function validateObraDraft(draft: ObraDraft, companyId: string | undefined) {
  if (!companyId?.trim()) throw new Error('Seu cadastro não possui uma empresa vinculada. O administrador precisa revisar seu acesso.');
  const name = draft.name.trim();
  const address = draft.address.trim();
  const cno = draft.cno.trim();
  if (!name) throw new Error('Informe o nome da obra.');
  if (name.length > 120) throw new Error('O nome da obra deve ter no máximo 120 caracteres.');
  if (address.length > 200) throw new Error('O endereço deve ter no máximo 200 caracteres.');
  if (cno.length > 30) throw new Error('O CNO deve ter no máximo 30 caracteres. Confira se o preenchimento automático inseriu outro dado neste campo.');
  return { name, address, cno, companyId };
}

export function obraError(error: unknown, operation: 'list' | 'save' | 'status') {
  const code = error && typeof error === 'object' && 'code' in error
    ? String(error.code).replace(/^firestore\//, '') : '';
  const action = operation === 'list' ? 'consultar as obras' : operation === 'status' ? 'alterar a situação da obra' : 'salvar a obra';
  let message: string;
  if (code === 'permission-denied') message = `O banco recusou o acesso para ${action}. É necessário conferir as regras publicadas e o perfil de acesso desta conta.`;
  else if (code === 'resource-exhausted') message = `O limite de uso do banco de dados foi atingido ao ${action}.`;
  else if (['unavailable', 'deadline-exceeded', 'cancelled'].includes(code)) message = `A conexão não permitiu confirmar a operação de ${action}. Confira sua conexão e tente novamente.`;
  else if (code === 'unauthenticated') message = 'O banco não reconheceu a sessão. Entre novamente para confirmar seu acesso.';
  else if (code === 'invalid-argument') message = 'O banco recusou o formato de um dos dados. Confira os campos preenchidos.';
  else if (!code && error instanceof Error) message = error.message;
  else message = `Não foi possível ${action}. Veja os detalhes abaixo.`;
  return { message, code: code || 'validation', detail: error instanceof Error ? error.message : String(error) };
}
