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
});
