import { jsPDF } from 'jspdf';
import { Delivery, Employee } from '../types';

export async function generateEmployeeFicha(employee: Employee, deliveries: Delivery[]): Promise<Blob> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });
  
  // Custom Cyan Color
  const primaryColor: [number, number, number] = [43, 178, 200]; // #2bb2c8
  
  // Aggregate and sort items chronologically
  const sortedDeliveries = [...deliveries].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  
  // Group by permanent work assignment. Temporary service locations never rewrite the employee's legal/home allocation.
  const deliveriesByObra = sortedDeliveries.reduce((acc, d) => {
    const obra = d.employeeHomeObraName || d.employeeObraName || employee.obraName || 'NÃO INFORMADA';
    if (!acc[obra]) acc[obra] = [];
    acc[obra].push(d);
    return acc;
  }, {} as Record<string, Delivery[]>);

  let isFirstPage = true;

  for (const [obraName, obraDeliveries] of Object.entries(deliveriesByObra)) {
    const allItems = [];
    for (const d of obraDeliveries) {
      for (const item of d.items) {
        allItems.push({
          date: new Date(d.timestamp).toLocaleDateString('pt-BR'),
          quantity: typeof item.quantity === 'number' ? item.quantity : 1,
          description: d.isFloatingEmployee ? `${item.description} [ENTREGA: ${d.serviceObraName || '-'} | ESTOQUE: ${d.stockObraName || '-'}]` : item.description,
          ca: item.ca,
          signatureUrl: d.signatureUrl,
          signatureHash: d.signatureHash,
          deliveryId: d.id
        });
      }
    }

    const rowsPerPage = 35;
    const totalPages = Math.max(1, Math.ceil(allItems.length / rowsPerPage));

    for (let page = 0; page < totalPages; page++) {
      if (!isFirstPage) doc.addPage();
      isFirstPage = false;
      
      // Use the immutable employee snapshot captured in the latest delivery of this obra.
      const snapshot = obraDeliveries[obraDeliveries.length - 1];
      const snapshotName = snapshot.employeeName || employee.name;
      const snapshotCpf = snapshot.employeeCpf || employee.cpf || '-';
      const snapshotJobTitle = snapshot.employeeJobTitle || employee.jobTitle;
      const snapshotIsOutsourced = snapshot.employeeIsOutsourced ?? employee.isOutsourced;

      // -- DRAW HEADER --
      doc.setDrawColor(0);
      doc.setLineWidth(0.3);
      doc.rect(10, 10, 190, 30);
      
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...primaryColor);
      doc.text('WSELENT', 20, 18);
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text('EMPREENDIMENTOS', 20, 22);
  
      doc.line(10, 24, 200, 24);
      
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0);
      
      doc.text(`NOME DO EMPREGADO: ${snapshotName}`.slice(0, 78), 12, 28);
      doc.line(140, 24, 140, 30); 
      doc.text(`CPF: ${snapshotCpf}`, 142, 28);
      doc.line(10, 30, 200, 30);
      
      doc.text(`CARGO: ${snapshotJobTitle}`.slice(0, 78), 12, 34);
      doc.line(140, 30, 140, 35); 
      const vinculoText = snapshotIsOutsourced ? 'TERCEIRIZADO' : 'PRÓPRIO';
      doc.text(`VÍNCULO: ${vinculoText}`, 142, 34);
      doc.line(10, 35, 200, 35);
  
      const cno = snapshot.employeeHomeObraCno || employee.obraCno || '-';
      doc.text(`OBRA (VÍNCULO): ${obraName} | CNO: ${cno}`.slice(0, 105), 12, 39);
  
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('FICHA DE EPI', 105, 46, { align: 'center' });
  
      // TABLE HEADER
      const startY = 50;
      doc.rect(10, startY, 190, 12);
      doc.line(10, startY + 6, 200, startY + 6);
      
      doc.text('RECEBIMENTO', 85, startY + 4, { align: 'center' });
      doc.line(160, startY, 160, startY + 12);
      doc.text('DEVOLUÇÃO', 180, startY + 4, { align: 'center' });
      
      doc.setFontSize(8);
      doc.text('DATA', 18, startY + 10, { align: 'center' });
      doc.line(26, startY + 6, 26, startY + 12);
      
      doc.text('QUANT', 34, startY + 10, { align: 'center' });
      doc.line(42, startY + 6, 42, startY + 12);
      
      doc.text('EQUIPAMENTO PROTEÇÃO', 80, startY + 10, { align: 'center' });
      doc.line(118, startY + 6, 118, startY + 12);
      
      doc.text('C A', 125, startY + 10, { align: 'center' });
      doc.line(132, startY + 6, 132, startY + 12);
      
      doc.text('ASSINATURA FUNCIONÁRIO', 146, startY + 10, { align: 'center' });
      
      doc.text('DATA', 168, startY + 10, { align: 'center' });
      doc.line(176, startY + 6, 176, startY + 12);
      
      doc.text('VISTO', 188, startY + 10, { align: 'center' });
  
      // TABLE ROWS
      const rowHeight = 6;
      let currentY = startY + 12;
      
      doc.setFont('helvetica', 'normal');
      
      const startIndex = page * rowsPerPage;
      const endIndex = startIndex + rowsPerPage;
      
      for (let i = startIndex; i < endIndex; i++) {
        doc.rect(10, currentY, 190, rowHeight);
        
        doc.line(26, currentY, 26, currentY + rowHeight);
        doc.line(42, currentY, 42, currentY + rowHeight);
        doc.line(118, currentY, 118, currentY + rowHeight);
        doc.line(132, currentY, 132, currentY + rowHeight);
        doc.line(160, currentY, 160, currentY + rowHeight);
        doc.line(176, currentY, 176, currentY + rowHeight);
        
        if (i < allItems.length) {
          const item = allItems[i];
          
          doc.text(item.date, 18, currentY + 4, { align: 'center' });
          doc.text(item.quantity.toString().padStart(2, '0'), 34, currentY + 4, { align: 'center' });
          const description = doc.splitTextToSize(item.description, 72)[0] || '';
          doc.text(description.length < item.description.length ? `${description.slice(0, -1)}…` : description, 44, currentY + 4);
          doc.text(item.ca || '-', 125, currentY + 4, { align: 'center' });
          
          if (item.signatureUrl) {
            try {
              doc.addImage(item.signatureUrl, 'PNG', 133, currentY + 0.5, 26, rowHeight - 1);
            } catch (e) {
              doc.setFontSize(5);
              doc.text('Erro Ass.', 146, currentY + 4, { align: 'center' });
              doc.setFontSize(8);
            }
          }
        }
        
        currentY += rowHeight;
      }
  
      doc.setFontSize(6);
      doc.setTextColor(150, 150, 150);
      const pageItems = allItems.slice(startIndex, Math.min(endIndex, allItems.length));
      const integrityRefs = pageItems
        .map(item => item.signatureHash?.slice(0, 10))
        .filter(Boolean)
        .join(', ');
      doc.text(`Página ${page + 1} de ${totalPages} - Obra: ${obraName} - Gerado em ${new Date().toLocaleString('pt-BR')}`, 10, currentY + 4);
      if (integrityRefs) doc.text(`Referências de integridade SHA-256: ${integrityRefs}`, 10, currentY + 7);
    }
  }

  return doc.output('blob');
}

export function downloadPdf(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
