export const cpfDigits = (value: string) => value.replace(/\D/g, '');

export function isValidCpf(value: string) {
  if (!/^[\d.\-\s]+$/.test(value)) return false;
  const digits = cpfDigits(value);
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  for (let length = 9; length <= 10; length += 1) {
    const sum = [...digits.slice(0, length)].reduce((total, digit, index) => total + Number(digit) * (length + 1 - index), 0);
    const check = (sum * 10) % 11;
    if ((check === 10 ? 0 : check) !== Number(digits[length])) return false;
  }
  return true;
}

export function formatCpf(value: string) {
  return cpfDigits(value).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

export function validateEmployeeDraft(draft: { name: string; cpf: string; jobTitle: string; obraId: string }, companyId?: string) {
  const name = draft.name.trim().replace(/\s+/g, ' ');
  const jobTitle = draft.jobTitle.trim().replace(/\s+/g, ' ');
  const errors: Record<string, string> = {};
  if (!companyId?.trim()) errors.save = 'Sua conta não possui empresa vinculada. Solicite a revisão do acesso.';
  if (!name || name.length > 100) errors.name = 'Informe o nome completo, com até 100 caracteres.';
  if (!isValidCpf(draft.cpf)) errors.cpf = 'Informe um CPF válido com 11 dígitos.';
  if (!jobTitle || jobTitle.length > 100) errors.jobTitle = 'Informe o cargo, com até 100 caracteres.';
  if (!draft.obraId) errors.obraId = 'Selecione a obra de vínculo.';
  return { errors, data: { ...draft, name, jobTitle, cpf: formatCpf(draft.cpf) } };
}
