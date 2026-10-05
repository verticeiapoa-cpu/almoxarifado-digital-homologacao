import { describe, expect, it } from 'vitest';
import { isValidCpf, validateEmployeeDraft } from '../src/lib/employeeForm';
const draft = { name: '  TESTE   AUTOMATIZADO  ', cpf: '52998224725', jobTitle: '  TECNICO  ', obraId: 'obra-a' };
describe('cadastro de funcionário', () => {
  it.each(['', 'ABC', '00000000000', '11111111111', '52998224724', '5299822472', '529982247250'])('recusa CPF inválido %s', value => expect(isValidCpf(value)).toBe(false));
  it.each(['52998224725', '529.982.247-25'])('aceita CPF com dígitos verificadores válidos %s', value => expect(isValidCpf(value)).toBe(true));
  it('normaliza texto e CPF antes de salvar', () => {
    const result = validateEmployeeDraft(draft, 'company');
    expect(result.errors).toEqual({});
    expect(result.data).toMatchObject({ name: 'TESTE AUTOMATIZADO', jobTitle: 'TECNICO', cpf: '529.982.247-25' });
  });
  it('recusa campos em branco e empresa ausente', () => expect(validateEmployeeDraft({ ...draft, name: ' ', jobTitle: ' ', obraId: '' }).errors).toMatchObject({ name: expect.any(String), jobTitle: expect.any(String), obraId: expect.any(String), save: expect.any(String) }));
  it('limita o tamanho dos campos', () => expect(validateEmployeeDraft({ ...draft, name: 'A'.repeat(101), jobTitle: 'A'.repeat(101) }, 'company').errors).toMatchObject({ name: expect.any(String), jobTitle: expect.any(String) }));
});
