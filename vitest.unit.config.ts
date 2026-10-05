import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: { environment: 'node', include: ['tests/inventory.test.ts', 'tests/firestoreCommit.test.ts', 'tests/obraForm.test.ts', 'tests/employeeForm.test.ts', 'tests/stockAlert.test.ts', 'tests/pdfGenerator.test.ts', 'tests/deliveryForm.test.tsx'] },
});
