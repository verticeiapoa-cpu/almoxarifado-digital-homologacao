// @vitest-environment jsdom
import React from 'react';
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import Employees from '../src/pages/Employees';
import NewDelivery from '../src/pages/NewDelivery';

const fixture = vi.hoisted(() => ({
  saved: [] as any[], failEmployees: false, profile:{companyId:'empresa-teste',role:'admin'},
  obra: {id:'obra-a',name:'OBRA TESTE',companyId:'empresa-teste',isActive:true},
  employee:{id:'emp-a',name:'FUNCIONARIO FICTICIO',cpf:'52998224725',jobTitle:'TESTE',obraId:'obra-a',obraName:'OBRA TESTE',companyId:'empresa-teste',isActive:true,isOutsourced:false},
  stocks:[
    {id:'obra-a__m1',materialId:'m1',materialDescription:'LUVA TESTE',ca:'111',quantity:2,unit:'PAR',obraId:'obra-a',companyId:'empresa-teste'},
    {id:'obra-a__m2',materialId:'m2',materialDescription:'LUVA TESTE',ca:'222',quantity:50,unit:'PAR',obraId:'obra-a',companyId:'empresa-teste'},
  ],
}));
vi.mock('../src/lib/AuthContext',()=>({useAuth:()=>({
  profile:fixture.profile,user:{uid:'qa'},isAdmin:true,activeObraId:'obra-a',activeObra:fixture.obra,userObras:[fixture.obra],
})}));
vi.mock('../src/lib/firebase',()=>({db:{},auth:{}}));
vi.mock('../src/lib/stockAlerts',()=>({queueLowStockAlert:vi.fn()}));
vi.mock('../src/lib/firestoreCommit',()=>({commitDocuments:vi.fn()}));
vi.mock('../src/utils/pdfGenerator',()=>({generateEmployeeFicha:async()=>new Blob(['test']),downloadPdf:vi.fn()}));
vi.mock('../src/lib/logger',()=>({logError:vi.fn(),logWarning:vi.fn()}));
vi.mock('../src/components/SignaturePad',()=>({SignaturePad:React.forwardRef((props:any,ref:any)=>{
  const [signed,setSigned]=React.useState(false);
  React.useImperativeHandle(ref,()=>({isEmpty:()=>!signed,clear:()=>setSigned(false),getSignatureDataUrl:()=>signed?'TEST-SIGNATURE':''}));
  return <button type="button" onClick={()=>{setSigned(true);props.onEnd?.();}}>Assinar em teste</button>;
})}));
vi.mock('firebase/firestore',()=>({
  collection:(_db:any,path:string)=>({path}),query:(ref:any,...filters:any[])=>({...ref,filters}),where:(field:string,op:string,value:any)=>({field,op,value}),
  doc:(parent:any,path?:string,id?:string)=>({id:id||'qa-id',path:id?`${path}/${id}`:`${parent.path}/qa-id`}),
  getDocs:async(q:any)=>{
    if(q.path==='employees'&&fixture.failEmployees)throw new Error('connection failure');
    const data=q.path==='employees'?[fixture.employee]:q.path==='inventoryStock'?fixture.stocks:[];
    return {docs:data.map(item=>({id:item.id,data:()=>item}))};
  },
  getDocsFromServer:vi.fn(),getDoc:vi.fn(),
  getDocFromServer:async(ref:any)=>({id:ref.id,exists:()=>true,data:()=>ref.path.startsWith('employees')?fixture.employee:fixture.obra}),
  serverTimestamp:()=> 'server-time',runTransaction:async(_db:any,callback:any)=>callback({
    get:async(ref:any)=>({id:ref.id,ref,exists:()=>true,data:()=>fixture.stocks.find(item=>item.id===ref.id)}),
    set:(ref:any,data:any)=>fixture.saved.push({path:ref.path,...data}), update:(ref:any,data:any)=>fixture.saved.push({path:ref.path,...data}),
  }),
  setDoc:async(ref:any,data:any)=>fixture.saved.push(data),updateDoc:vi.fn(),writeBatch:vi.fn(),Timestamp:{},
}));
beforeEach(()=>{fixture.saved=[];fixture.failEmployees=false;window.alert=vi.fn();});
afterEach(cleanup);
async function setupDelivery(){render(<NewDelivery/>);await screen.findByRole('option',{name:/FUNCIONARIO FICTICIO/});fireEvent.change(screen.getAllByRole('combobox')[0],{target:{value:'emp-a'}});await waitFor(()=>expect(screen.getByRole('button',{name:/Continuar/}).hasAttribute('disabled')).toBe(false));fireEvent.click(screen.getByRole('button',{name:/Continuar/}));await screen.findByLabelText('Equipamento de Proteção *');}
function setItem(quantity:number){fireEvent.change(screen.getByLabelText('Equipamento de Proteção *'),{target:{value:'obra-a__m1'}});fireEvent.change(screen.getByRole('spinbutton'),{target:{value:String(quantity)}});}

describe('validações de entrega em componente isolado',()=>{
  it('bloqueia continuar sem funcionário',async()=>{render(<NewDelivery/>);await screen.findByRole('option',{name:/FUNCIONARIO FICTICIO/});await waitFor(()=>expect(screen.getByRole('button',{name:/Continuar/}).hasAttribute('disabled')).toBe(false));fireEvent.click(screen.getByRole('button',{name:/Continuar/}));expect(await screen.findByText('Selecione um colaborador')).toBeTruthy();});
  it.each([0,-1,1.5,10000])('bloqueia quantidade inválida %s',async(q)=>{await setupDelivery();setItem(q);fireEvent.click(screen.getByRole('button',{name:/Continuar/}));expect(await screen.findByText(/quantidades inteiras entre 1 e 9999|Saldo insuficiente para LUVA TESTE/)).toBeTruthy();});
  it('bloqueia retirada maior que o saldo',async()=>{await setupDelivery();setItem(3);fireEvent.click(screen.getByRole('button',{name:/Continuar/}));expect(await screen.findByText('Saldo insuficiente para LUVA TESTE')).toBeTruthy();});
  it('bloqueia descrição avulsa sem vínculo ao estoque',async()=>{await setupDelivery();fireEvent.change(screen.getByLabelText('Equipamento de Proteção *'),{target:{value:'ITEM AVULSO'}});fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'1'}});fireEvent.click(screen.getByRole('button',{name:/Continuar/}));expect(await screen.findByText(/Selecione EPIs existentes/)).toBeTruthy();});
  it('soma linhas repetidas antes de validar saldo',async()=>{await setupDelivery();setItem(2);fireEvent.click(screen.getByRole('button',{name:'Adicionar Item'}));const fields=screen.getAllByLabelText('Equipamento de Proteção *');fireEvent.change(fields[1],{target:{value:'obra-a__m1'}});fireEvent.change(screen.getAllByRole('spinbutton')[1],{target:{value:'1'}});fireEvent.click(screen.getByRole('button',{name:/Continuar/}));expect(await screen.findByText('Saldo insuficiente para LUVA TESTE')).toBeTruthy();});
  it('exige assinatura e confirmação do recebimento',async()=>{await setupDelivery();setItem(1);fireEvent.click(screen.getByRole('button',{name:/Continuar/}));fireEvent.click(screen.getByRole('button',{name:'Salvar Ficha de EPI'}));expect(await screen.findByText('Assinatura é obrigatória')).toBeTruthy();expect(screen.getByText('O colaborador deve confirmar o recebimento')).toBeTruthy();});
});
describe('regressão dos defeitos corrigidos',()=>{
  it('recusa CPF ABC e campos em branco sem salvar',async()=>{render(<Employees/>);fireEvent.click(screen.getByRole('button',{name:'Novo Funcionário'}));fireEvent.change(document.querySelector('input[name=name]')!,{target:{value:'   '}});fireEvent.change(document.querySelector('input[name=cpf]')!,{target:{value:'ABC'}});fireEvent.change(document.querySelector('input[name=jobTitle]')!,{target:{value:'   '}});fireEvent.click(screen.getByRole('button',{name:'Salvar',exact:true}));expect(await screen.findByText('Informe um CPF válido com 11 dígitos.')).toBeTruthy();expect(fixture.saved).toHaveLength(0);});
  it('seleciona o segundo saldo com descrição repetida pelo código',async()=>{await setupDelivery();fireEvent.change(screen.getByLabelText('Equipamento de Proteção *'),{target:{value:'obra-a__m2'}});expect((screen.getByLabelText('CA do equipamento') as HTMLInputElement).value).toBe('222');expect((screen.getByLabelText('CA do equipamento') as HTMLInputElement).readOnly).toBe(true);});
  it('a revisão mostra descrição, CA e quantidade dos EPIs',async()=>{await setupDelivery();setItem(2);fireEvent.click(screen.getByRole('button',{name:/Continuar/}));expect(screen.getByRole('table').textContent).toContain('LUVA TESTE');expect(screen.getByRole('table').textContent).toContain('2 PAR');expect(screen.getByRole('table').textContent).toContain('111');});
  it('erro de consulta exibe mensagem e opção de tentar novamente',async()=>{fixture.failEmployees=true;render(<Employees/>);expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.queryByText('Nenhum funcionário encontrado.')).toBeNull();fixture.failEmployees=false;fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));expect(await screen.findByText('FUNCIONARIO FICTICIO')).toBeTruthy();});
  it('voltar sem editar conserva assinatura e consentimento',async()=>{await setupDelivery();setItem(1);fireEvent.click(screen.getByRole('button',{name:/Continuar/}));fireEvent.click(screen.getByRole('button',{name:'Assinar em teste'}));fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Voltar'}));fireEvent.click(screen.getByRole('button',{name:/Continuar/}));expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Salvar Ficha de EPI'}));expect(screen.queryByText('Assinatura é obrigatória')).toBeNull();await screen.findByText('Ficha de EPI Registrada!');});
  it('alterar quantidade exige nova assinatura e consentimento',async()=>{await setupDelivery();setItem(1);fireEvent.click(screen.getByRole('button',{name:/Continuar/}));fireEvent.click(screen.getByRole('button',{name:'Assinar em teste'}));fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Voltar'}));fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'2'}});fireEvent.click(screen.getByRole('button',{name:/Continuar/}));expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);fireEvent.click(screen.getByRole('button',{name:'Salvar Ficha de EPI'}));expect(await screen.findByText('Assinatura é obrigatória')).toBeTruthy();expect(fixture.saved).toHaveLength(0);});
  it('salva a entrega e movimenta exatamente o segundo saldo escolhido',async()=>{await setupDelivery();fireEvent.change(screen.getByLabelText('Equipamento de Proteção *'),{target:{value:'obra-a__m2'}});fireEvent.change(screen.getByRole('spinbutton'),{target:{value:'3'}});fireEvent.click(screen.getByRole('button',{name:/Continuar/}));fireEvent.click(screen.getByRole('button',{name:'Assinar em teste'}));fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Salvar Ficha de EPI'}));await screen.findByText('Ficha de EPI Registrada!');expect(fixture.saved.find(item=>item.path.startsWith('deliveries')).items[0]).toMatchObject({stockId:'obra-a__m2',ca:'222',quantity:3});expect(fixture.saved.find(item=>item.path==='inventoryStock/obra-a__m2').quantity).toBe(47);expect(fixture.saved.some(item=>item.path==='inventoryStock/obra-a__m1')).toBe(false);});
  it('falha de carregamento bloqueia entrega e permite retentar',async()=>{fixture.failEmployees=true;render(<NewDelivery/>);expect(await screen.findByRole('alert')).toBeTruthy();expect(screen.getByRole('button',{name:/Continuar/}).hasAttribute('disabled')).toBe(true);fixture.failEmployees=false;fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));await screen.findByRole('option',{name:/FUNCIONARIO FICTICIO/});});
});
