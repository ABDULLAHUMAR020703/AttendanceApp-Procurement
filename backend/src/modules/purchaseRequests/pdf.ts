import PDFDocument from 'pdfkit';

type PdfApprovalRow = {
  role: string;
  approverName: string;
  status: string;
  timestamp: string | null;
};

type PurchaseRequestPdfInput = {
  prId: string;
  companyName: string;
  requestedBy: string;
  department: string;
  dateCreated: string;
  status: string;
  projectName: string;
  notes: string | null;
  item: {
    name: string;
    description: string;
    quantity: string;
    unitPrice: string;
    total: string;
  };
  financialSummary: {
    totalAmount: string;
    budgetOrPoReference: string;
  };
  approvals: PdfApprovalRow[];
};

function roleLabel(role: string): string {
  const r = role.toLowerCase();
  if (r === 'team_lead') return 'Team Lead';
  if (r === 'pm') return 'PM';
  if (r === 'finance') return 'Finance';
  if (r === 'gm') return 'GM';
  if (r === 'admin') return 'Admin';
  return role;
}

function statusLabel(status: string): string {
  const s = status.toLowerCase();
  if (s === 'approved') return 'Approved';
  if (s === 'rejected') return 'Rejected';
  if (s === 'pending') return 'Pending';
  return status;
}

function drawSectionTitle(doc: PDFKit.PDFDocument, title: string) {
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827').text(title);
  doc.moveDown(0.2);
}

function drawKeyValue(doc: PDFKit.PDFDocument, key: string, value: string) {
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(`${key}: `, { continued: true });
  doc.font('Helvetica').fillColor('#374151').text(value);
}

export async function generatePurchaseRequestPdf(input: PurchaseRequestPdfInput): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#111827').text(input.companyName || 'Company Name');
    doc.font('Helvetica').fontSize(10).fillColor('#6B7280').text('Logo placeholder');
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#111827').text('Purchase Request');

    // Optional watermark
    const wm = input.status.toLowerCase();
    if (wm === 'pending' || wm === 'rejected') {
      const label = wm === 'pending' ? 'PENDING' : 'REJECTED';
      doc.save();
      doc.rotate(-35, { origin: [300, 420] });
      doc.font('Helvetica-Bold').fontSize(70).fillColor(wm === 'pending' ? '#F59E0B' : '#EF4444').opacity(0.1);
      doc.text(label, 110, 380);
      doc.restore();
      doc.opacity(1);
    }

    drawSectionTitle(doc, '1) Basic Info');
    drawKeyValue(doc, 'PR ID', input.prId);
    drawKeyValue(doc, 'Project Name', input.projectName);
    drawKeyValue(doc, 'Requested By', input.requestedBy);
    drawKeyValue(doc, 'Department', input.department);
    drawKeyValue(doc, 'Date Created', input.dateCreated);
    drawKeyValue(doc, 'Status', statusLabel(input.status));

    drawSectionTitle(doc, '2) Items');
    const headers = ['Item Name', 'Description', 'Quantity', 'Unit Price', 'Total'];
    const colX = [50, 140, 330, 400, 480];
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827');
    headers.forEach((h, idx) => doc.text(h, colX[idx]!, doc.y));
    doc.moveDown(0.8);
    const y = doc.y;
    doc.font('Helvetica').fontSize(10).fillColor('#374151');
    doc.text(input.item.name, colX[0]!, y, { width: 85 });
    doc.text(input.item.description, colX[1]!, y, { width: 180 });
    doc.text(input.item.quantity, colX[2]!, y, { width: 60 });
    doc.text(input.item.unitPrice, colX[3]!, y, { width: 70 });
    doc.text(input.item.total, colX[4]!, y, { width: 70 });

    drawSectionTitle(doc, '3) Financial Summary');
    drawKeyValue(doc, 'Total Amount', input.financialSummary.totalAmount);
    drawKeyValue(doc, 'Budget / PO Reference', input.financialSummary.budgetOrPoReference);

    drawSectionTitle(doc, '4) Approval Flow');
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text('Role', 50, doc.y);
    doc.text('Approver Name', 160, doc.y);
    doc.text('Status', 350, doc.y);
    doc.text('Timestamp', 430, doc.y);
    doc.moveDown(0.8);
    doc.font('Helvetica').fillColor('#374151');
    for (const a of input.approvals) {
      const rowY = doc.y;
      doc.text(roleLabel(a.role), 50, rowY, { width: 100 });
      doc.text(a.approverName, 160, rowY, { width: 180 });
      doc.text(statusLabel(a.status), 350, rowY, { width: 70 });
      doc.text(a.timestamp ?? '—', 430, rowY, { width: 120 });
      doc.moveDown(0.6);
    }
    if (input.approvals.length === 0) {
      doc.text('No approvals found.');
    }

    drawSectionTitle(doc, '5) Notes / Remarks');
    doc.font('Helvetica').fontSize(10).fillColor('#374151').text(input.notes?.trim() || '—');

    // Footer
    doc.moveDown(1.2);
    doc.font('Helvetica').fontSize(9).fillColor('#6B7280').text(`Generated: ${new Date().toLocaleString()}`);
    doc.text('System: Procurement Management System');

    doc.end();
  });
}
