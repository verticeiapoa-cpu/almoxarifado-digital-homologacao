import { jsPDF } from 'jspdf';
import { Delivery, Employee } from '../types';

export async function generateEmployeeFicha(employee: Employee, deliveries: Delivery[]): Promise<Blob> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const groups = new Map<string, Delivery[]>();
  const sorted = [...deliveries].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  for (const delivery of sorted) {
    const key = delivery.employeeHomeObraId || delivery.obraId || delivery.employeeHomeObraName || delivery.employeeObraName || employee.obraId;
    groups.set(key, [...(groups.get(key) || []), delivery]);
  }
  if (groups.size === 0) groups.set(employee.obraId || 'empty', []);
  const columns = [10, 30, 44, 116, 134, 166, 183, 200];
  let y = 10;
  let firstPage = true;
  const text = (value: string, width: number): string[] => doc.splitTextToSize(value || '-', width);
  const field = (label: string, value: string) => {
    doc.setFontSize(8);
    const lines = text(`${label}: ${value || '-'}`, 186);
    const height = Math.max(7, lines.length * 4 + 3);
    doc.rect(10, y, 190, height);
    doc.text(lines, 12, y + 4, { lineHeightFactor: 1.4 });
    y += height;
  };
  const header = (snapshot: Delivery | undefined) => {
    if (!firstPage) doc.addPage();
    firstPage = false;
    y = 10;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(43, 178, 200);
    doc.text('WSELENT', 10, y + 6);
    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text('FICHA DE EPI', 200, y + 6, { align: 'right' });
    y += 12;
    doc.setFont('helvetica', 'normal');
    field('NOME DO EMPREGADO', snapshot?.employeeName || employee.name);
    field('CPF', snapshot?.employeeCpf || employee.cpf);
    field('CARGO', snapshot?.employeeJobTitle || employee.jobTitle);
    field('VÍNCULO', (snapshot?.employeeIsOutsourced ?? employee.isOutsourced) ? 'TERCEIRIZADO' : 'PRÓPRIO');
    field('OBRA (VÍNCULO)', snapshot?.employeeHomeObraName || snapshot?.employeeObraName || employee.obraName);
    field('CNO', snapshot?.employeeHomeObraCno || employee.obraCno || '-');
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.rect(10, y, 190, 12);
    ['DATA', 'QUANT.', 'EQUIPAMENTO DE PROTEÇÃO', 'CA', 'ASSINATURA DO FUNCIONÁRIO', 'DEVOL. DATA', 'VISTO'].forEach((label, i) => {
      const width = columns[i + 1] - columns[i];
      doc.text(text(label, width - 3), columns[i] + width / 2, y + 4, { align: 'center', lineHeightFactor: 1.3 });
      if (i > 0) doc.line(columns[i], y, columns[i], y + 12);
    });
    y += 12;
    doc.setFont('helvetica', 'normal');
  };

  for (const obraDeliveries of groups.values()) {
    const snapshot = obraDeliveries.at(-1);
    header(snapshot);
    for (const delivery of obraDeliveries) {
      for (const item of delivery.items) {
        doc.setFontSize(8);
        const description = item.description + (delivery.isFloatingEmployee
          ? ` [ENTREGA: ${delivery.serviceObraName || '-'} | ESTOQUE: ${delivery.stockObraName || '-'}]` : '');
        const descriptionLines = text(description, 68);
        const caLines = text(item.ca || '-', 14);
        const dataHeight = Math.max(14, Math.max(descriptionLines.length, caLines.length) * 4 + 3);
        doc.setFontSize(6);
        const referenceLines = text(`Entrega: ${delivery.id} | SHA-256: ${delivery.signatureHash || 'não informado'}`, 186);
        const height = dataHeight + referenceLines.length * 3 + 3;
        if (y + height > 278) header(snapshot);
        // Historical descriptions can be longer than a page: preserve them in continuation rows.
        let remaining = [...descriptionLines];
        do {
          const capacity = Math.max(1, Math.floor((278 - y - referenceLines.length * 3 - 6) / 4));
          const lines = remaining.splice(0, capacity);
          const rowDataHeight = Math.max(14, Math.max(lines.length, caLines.length) * 4 + 3);
          const rowHeight = rowDataHeight + referenceLines.length * 3 + 3;
          doc.rect(10, y, 190, rowHeight);
          columns.slice(1, -1).forEach(x => doc.line(x, y, x, y + rowDataHeight));
          doc.setFontSize(8);
          doc.text(new Date(delivery.timestamp).toLocaleDateString('pt-BR'), 20, y + 5, { align: 'center' });
          doc.text(String(item.quantity), 37, y + 5, { align: 'center' });
          doc.text(lines, 46, y + 5, { lineHeightFactor: 1.4 });
          doc.text(caLines, 118, y + 5, { lineHeightFactor: 1.4 });
          if (delivery.signatureUrl) {
            try {
              const image = doc.getImageProperties(delivery.signatureUrl);
              const imageWidth = Math.min(28, (rowDataHeight - 4) * image.width / image.height);
              const imageHeight = imageWidth * image.height / image.width;
              doc.addImage(delivery.signatureUrl, 'PNG', 150 - imageWidth / 2, y + (rowDataHeight - imageHeight) / 2, imageWidth, imageHeight);
            } catch {
              doc.setFontSize(6);
              doc.text('Assinatura indisponível', 136, y + 5);
            }
          }
          doc.line(10, y + rowDataHeight, 200, y + rowDataHeight);
          doc.setFontSize(6);
          doc.text(referenceLines, 12, y + rowDataHeight + 3, { lineHeightFactor: 1.4 });
          y += rowHeight;
          if (remaining.length > 0) header(snapshot);
        } while (remaining.length > 0);
      }
    }
    if (obraDeliveries.length === 0) { doc.setFontSize(9); doc.text('Nenhuma entrega registrada.', 12, y + 8); }
  }
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page++) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100);
    doc.text(`Página ${page} de ${total} | Gerado em ${new Date().toLocaleString('pt-BR')}`, 10, 287);
  }
  return doc.output('blob');
}

export function downloadPdf(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Chrome/Android may start consuming the Blob after the synthetic click.
  // Revoking it immediately can race the download and result in no file.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
