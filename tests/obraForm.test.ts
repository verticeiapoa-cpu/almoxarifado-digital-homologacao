import { describe, expect, it } from 'vitest';
import { obraError, validateObraDraft } from '../src/lib/obraForm';

describe('cadastro de obras', () => {
  it('aceita nome e campos opcionais vazios com a empresa autenticada', () => {
    expect(validateObraDraft({ name: '  OBRA TESTE  ', cno: '', address: '' }, 'empresa-a'))
      .toEqual({ name: 'OBRA TESTE', cno: '', address: '', companyId: 'empresa-a' });
  });
  it('nunca substitui uma empresa ausente por wselent-default', () => {
    expect(() => validateObraDraft({ name: 'OBRA', cno: '', address: '' }, undefined)).toThrow('empresa vinculada');
  });
  it.each([
    [{ name: ' ', cno: '', address: '' }, 'nome'],
    [{ name: 'A'.repeat(121), cno: '', address: '' }, '120'],
    [{ name: 'OBRA', cno: '9'.repeat(31), address: '' }, 'CNO'],
    [{ name: 'OBRA', cno: '', address: 'A'.repeat(201) }, 'endereço'],
  ])('identifica o campo recusado pelas validações publicadas', (draft, message) => {
    expect(() => validateObraDraft(draft, 'empresa-a')).toThrow(message);
  });
  it('mantém o motivo real de permissão negada', () => {
    expect(obraError(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }), 'save'))
      .toMatchObject({ code: 'permission-denied', detail: 'Missing or insufficient permissions.' });
  });
  it('distingue limite de uso de erro de acesso', () => {
    expect(obraError({ code: 'resource-exhausted' }, 'list').message).toContain('limite de uso');
  });
  it('não chama uma falha de consulta de lista vazia', () => {
    expect(obraError({ code: 'unavailable' }, 'list').message).toContain('conexão');
  });
  it('preserva a indicação exata do campo inválido', () => {
    expect(obraError(new Error('Confira o CNO.'), 'save').message).toBe('Confira o CNO.');
  });
});
