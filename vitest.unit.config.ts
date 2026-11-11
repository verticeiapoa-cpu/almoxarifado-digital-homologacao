import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: { environment: 'node', include: ['tests/inventory.test.ts', 'tests/firestoreCommit.test.ts', 'tests/obraForm.test.ts', 'tests/employeeForm.test.ts', 'tests/stockAlert.test.ts', 'tests/pdfGenerator.test.ts', 'tests/deliveryForm.test.tsx', 'tests/stockStatus.test.ts', 'tests/movements.test.ts', 'tests/csv.test.ts', 'tests/reports.test.ts', 'tests/operations.test.ts', 'tests/operationReports.test.ts'] },
});
