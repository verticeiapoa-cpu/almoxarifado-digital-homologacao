import { Employee, Department, Material } from './types';

export const mockEmployees: Employee[] = [
  { 
    id: '1', 
    name: 'YOEL JOSE COVA', 
    cpf: '000.000.000-00',
    jobTitle: 'PEDREIRO I',
    obraId: 'obra-1',
    obraName: 'OBRA MATRIZ',
    isOutsourced: false,
    isActive: true 
  }
];

export const mockDepartments: Department[] = [
  { id: '1', name: 'ALVENARIA', isActive: true },
  { id: '2', name: 'ADMINISTRATIVO', isActive: true },
];

export const mockMaterials: Material[] = [
  { id: '1', ca: '36982', description: 'CALÇADO DE SEGURANÇA Nº 42', isActive: true },
  { id: '2', ca: '29792', description: 'CAPACETE', isActive: true },
  { id: '3', ca: '37977', description: 'CINTO DE SEGURANÇA TIPO PARAQUEDISTA', isActive: true },
  { id: '4', ca: '10931', description: 'CREME PROTETOR', isActive: true },
  { id: '5', ca: '37900', description: 'LUVA DE LÁTEX', isActive: true },
  { id: '6', ca: '46803', description: 'LUVA DE POLIAMIDA COM BANHO NÍTRICO', isActive: true },
  { id: '7', ca: '19176', description: 'ÓCULOS DE PROTEÇÃO', isActive: true },
  { id: '8', ca: '35981', description: 'PROTETOR AURICULAR', isActive: true },
  { id: '9', ca: '38503', description: 'RESPIRADOR PFF2', isActive: true },
  { id: '10', ca: '-', description: 'CALÇA TAM GG', isActive: true },
  { id: '11', ca: '-', description: 'CAMISETA TAM G', isActive: true },
];
