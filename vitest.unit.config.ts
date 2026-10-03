import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['tests/inventory.test.ts', 'tests/firestoreCommit.test.ts', 'tests/obraForm.test.ts'] },
});
