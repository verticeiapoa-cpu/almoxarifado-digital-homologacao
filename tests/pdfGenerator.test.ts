import { describe, expect, it } from 'vitest';
import { generateEmployeeFicha } from '../src/utils/pdfGenerator';
import type { Delivery, Employee } from '../src/types';

describe('geração de PDF da ficha de EPI', () => {
  it('gera um PDF não vazio com uma entrega válida', async () => {
    const employee: Employee = {
      id: 'employee-a',
      name: 'EMPREGADO TESTE',
      cpf: '000.000.000-00',
      jobTitle: 'SERVENTE',
      obraId: 'obra-a',
      obraName: 'OBRA A',
      obraCno: '11.111.11111/11',
      companyId: 'wselent-default',
      isOutsourced: false,
      isActive: true,
    };

    const delivery: Delivery = {
      id: 'delivery-pdf',
      timestamp: '2026-10-05T00:00:00.000Z',
      responsibleUser: 'Administrador',
      companyId: 'wselent-default',
      obraId: 'obra-a',
      employeeHomeObraId: 'obra-a',
      employeeHomeObraName: 'OBRA A',
      employeeHomeObraCno: '11.111.11111/11',
      serviceObraId: 'obra-a',
      serviceObraName: 'OBRA A',
      stockObraId: 'obra-a',
      stockObraName: 'OBRA A',
      isFloatingEmployee: false,
      temporaryAssignmentId: '',
      temporaryAssignmentReason: '',
      employeeId: 'employee-a',
      employeeName: 'EMPREGADO TESTE',
      employeeCpf: '000.000.000-00',
      employeeJobTitle: 'SERVENTE',
      employeeObraName: 'OBRA A',
      employeeIsOutsourced: false,
      items: [{ materialId: 'material-a', stockId: 'obra-a__material-a', description: 'CAPACETE', ca: '123', quantity: 1 }],
      status: 'COMPLETED',
      signatureHash: 'a'.repeat(64),
      audit: {
        authUid: 'admin',
        authEmail: 'verticeiapoa@gmail.com',
        signedAt: '2026-10-05T00:00:00.000Z',
        signatureMethod: 'drawn-on-screen',
        consentText: 'Recebimento confirmado para teste automatizado da ficha.',
      },
      createdAt: '2026-10-05T00:00:00.000Z',
      updatedAt: '2026-10-05T00:00:00.000Z',
      createdBy: 'admin',
    };

    const blob = await generateEmployeeFicha(employee, [delivery]);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(1000);
  });
  it.each(['constructor', '__proto__', 'toString'])('gera ficha para obra com nome %s', async obraName => {
    const employee = { id: 'e', obraId: 'obra', obraName, name: 'NOME', cpf: '529.982.247-25', jobTitle: 'CARGO', isOutsourced: false } as Employee;
    const delivery = { id: 'd', obraId: 'obra', timestamp: '2026-10-05', employeeHomeObraName: obraName, items: [{ description: 'EPI', ca: '123', quantity: 1 }] } as Delivery;
    expect((await generateEmployeeFicha(employee, [delivery])).size).toBeGreaterThan(1000);
  });
  it('mantém textos longos e hash completo em múltiplas páginas', async () => {
    const employee = { id: 'e', obraId: 'obra', obraName: 'OBRA', name: 'NOME '.repeat(18), cpf: '529.982.247-25', jobTitle: 'CARGO '.repeat(16), isOutsourced: false } as Employee;
    const deliveries = Array.from({ length: 36 }, (_, i) => ({ id: `entrega-${i}`, obraId: 'obra', timestamp: '2026-10-05', signatureHash: 'abcdef0123456789'.repeat(4), items: [{ description: 'DESCRICAO COMPLETA '.repeat(12) + 'FINALUNICO', ca: '123', quantity: 1 }] } as Delivery));
    const content = await (await generateEmployeeFicha(employee, deliveries)).text();
    expect(content.match(/FINALUNICO/g)).toHaveLength(36);
    expect(content).toContain('abcdef0123456789'.repeat(4));
    expect((content.match(/\/Type \/Page\b/g) || []).length).toBeGreaterThan(1);
  });
  it('separa obras com o mesmo nome e identificadores diferentes', async () => {
    const employee = { id: 'e', obraId: 'obra', obraName: 'MESMO NOME', name: 'NOME', cpf: '529.982.247-25', jobTitle: 'CARGO' } as Employee;
    const deliveries = ['a', 'b'].map(id => ({ id, obraId: id, employeeHomeObraName: 'MESMO NOME', timestamp: '2026-10-05', items: [{ description: 'EPI', ca: '', quantity: 1 }] } as Delivery));
    const content = await (await generateEmployeeFicha(employee, deliveries)).text();
    expect((content.match(/\/Type \/Page\b/g) || []).length).toBe(2);
  });

});
