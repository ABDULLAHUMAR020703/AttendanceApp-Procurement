import puppeteer from 'puppeteer';

type PrPdfData = {
  id: string;
  projectName: string;
  requestedBy: string;
  department: string;
  createdAt: string;
  status: string;
  itemName: string;
  itemDescription: string;
  quantity: string;
  unitPrice: string;
  total: string;
  totalAmount: string;
  budgetOrPoReference: string;
  approvals: Array<{ role: string; approverName: string; status: string; timestamp: string }>;
  notes: string;
};

type ProjectPdfData = {
  id: string;
  projectName: string;
  projectCode: string;
  customer: string;
  linkedPo: string;
  totalBudget: string;
  consumedAmount: string;
  remainingAmount: string;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  relatedPrs: Array<{ id: string; description: string; amount: string; status: string; createdAt: string }>;
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function pageShell(title: string, body: string, watermark?: string): string {
  const safeWatermark = watermark ? `<div class="watermark">${escapeHtml(watermark)}</div>` : '';
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 30px; font-size: 12px; }
      .header { border-bottom: 2px solid #e5e7eb; padding-bottom: 10px; margin-bottom: 12px; }
      .company { font-size: 18px; font-weight: 700; }
      .logo { color: #6b7280; font-size: 11px; margin-top: 3px; }
      .title { font-size: 24px; font-weight: 700; margin-top: 8px; }
      .section { margin-top: 14px; }
      .section h3 { margin: 0 0 8px 0; font-size: 14px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
      .kv { margin: 2px 0; }
      .k { font-weight: 700; }
      table { width: 100%; border-collapse: collapse; margin-top: 6px; }
      th, td { border: 1px solid #d1d5db; padding: 6px; text-align: left; vertical-align: top; }
      th { background: #f3f4f6; font-weight: 700; }
      .muted { color: #6b7280; }
      .footer { border-top: 1px solid #e5e7eb; margin-top: 16px; padding-top: 8px; font-size: 10px; color: #6b7280; }
      .watermark {
        position: fixed; top: 42%; left: 20%; transform: rotate(-30deg);
        font-size: 84px; color: rgba(239,68,68,0.12); font-weight: 700; z-index: -1;
      }
    </style>
  </head>
  <body>
    ${safeWatermark}
    ${body}
  </body>
</html>`;
}

async function renderHtmlToPdfBuffer(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', right: '12mm', bottom: '16mm', left: '12mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

export async function generatePRPdf(data: PrPdfData): Promise<Buffer> {
  const approvalRows =
    data.approvals.length === 0
      ? `<tr><td colspan="4" class="muted">No approvals found.</td></tr>`
      : data.approvals
          .map(
            (a) => `<tr>
              <td>${escapeHtml(roleLabel(a.role))}</td>
              <td>${escapeHtml(a.approverName)}</td>
              <td>${escapeHtml(a.status)}</td>
              <td>${escapeHtml(a.timestamp)}</td>
            </tr>`,
          )
          .join('');

  const watermark = data.status.toLowerCase() === 'pending' || data.status.toLowerCase() === 'rejected'
    ? data.status.toUpperCase()
    : undefined;

  const body = `
    <div class="header">
      <div class="company">Company Name</div>
      <div class="logo">Logo placeholder</div>
      <div class="title">Purchase Request</div>
    </div>

    <div class="section">
      <h3>1) Basic Info</h3>
      <div class="kv"><span class="k">PR ID:</span> ${escapeHtml(data.id)}</div>
      <div class="kv"><span class="k">Project Name:</span> ${escapeHtml(data.projectName)}</div>
      <div class="kv"><span class="k">Requested By:</span> ${escapeHtml(data.requestedBy)}</div>
      <div class="kv"><span class="k">Department:</span> ${escapeHtml(data.department)}</div>
      <div class="kv"><span class="k">Date Created:</span> ${escapeHtml(data.createdAt)}</div>
      <div class="kv"><span class="k">Status:</span> ${escapeHtml(data.status)}</div>
    </div>

    <div class="section">
      <h3>2) Items Table</h3>
      <table>
        <thead><tr><th>Item Name</th><th>Description</th><th>Quantity</th><th>Unit Price</th><th>Total</th></tr></thead>
        <tbody><tr>
          <td>${escapeHtml(data.itemName)}</td>
          <td>${escapeHtml(data.itemDescription)}</td>
          <td>${escapeHtml(data.quantity)}</td>
          <td>${escapeHtml(data.unitPrice)}</td>
          <td>${escapeHtml(data.total)}</td>
        </tr></tbody>
      </table>
    </div>

    <div class="section">
      <h3>3) Financial Summary</h3>
      <div class="kv"><span class="k">Total Amount:</span> ${escapeHtml(data.totalAmount)}</div>
      <div class="kv"><span class="k">Budget / PO Reference:</span> ${escapeHtml(data.budgetOrPoReference)}</div>
    </div>

    <div class="section">
      <h3>4) Approval Flow</h3>
      <table>
        <thead><tr><th>Role</th><th>Approver Name</th><th>Status</th><th>Timestamp</th></tr></thead>
        <tbody>${approvalRows}</tbody>
      </table>
    </div>

    <div class="section">
      <h3>5) Notes / Remarks</h3>
      <div>${escapeHtml(data.notes || '—')}</div>
    </div>

    <div class="footer">
      <div>Generated timestamp: ${escapeHtml(new Date().toLocaleString())}</div>
      <div>System name: Procurement Management System</div>
    </div>`;

  return await renderHtmlToPdfBuffer(pageShell(`PR ${data.id}`, body, watermark));
}

export async function generateProjectPdf(data: ProjectPdfData): Promise<Buffer> {
  const prsRows =
    data.relatedPrs.length === 0
      ? `<tr><td colspan="5" class="muted">No related purchase requests found.</td></tr>`
      : data.relatedPrs
          .map(
            (r) => `<tr>
              <td>${escapeHtml(r.id)}</td>
              <td>${escapeHtml(r.description)}</td>
              <td>${escapeHtml(r.amount)}</td>
              <td>${escapeHtml(r.status)}</td>
              <td>${escapeHtml(r.createdAt)}</td>
            </tr>`,
          )
          .join('');

  const body = `
    <div class="header">
      <div class="company">Company Name</div>
      <div class="logo">Logo placeholder</div>
      <div class="title">Project</div>
    </div>

    <div class="section">
      <h3>1) Basic Info</h3>
      <div class="kv"><span class="k">Project Name:</span> ${escapeHtml(data.projectName)}</div>
      <div class="kv"><span class="k">Project Code:</span> ${escapeHtml(data.projectCode)}</div>
      <div class="kv"><span class="k">Customer:</span> ${escapeHtml(data.customer)}</div>
      <div class="kv"><span class="k">Status:</span> ${escapeHtml(data.status)}</div>
      <div class="kv"><span class="k">Created By:</span> ${escapeHtml(data.createdBy)}</div>
      <div class="kv"><span class="k">Created At:</span> ${escapeHtml(data.createdAt)}</div>
      <div class="kv"><span class="k">Updated At:</span> ${escapeHtml(data.updatedAt)}</div>
    </div>

    <div class="section">
      <h3>2) Financial Summary</h3>
      <div class="kv"><span class="k">Linked PO:</span> ${escapeHtml(data.linkedPo)}</div>
      <div class="kv"><span class="k">Total Value / Budget:</span> ${escapeHtml(data.totalBudget)}</div>
      <div class="kv"><span class="k">Consumed Amount:</span> ${escapeHtml(data.consumedAmount)}</div>
      <div class="kv"><span class="k">Remaining Amount:</span> ${escapeHtml(data.remainingAmount)}</div>
    </div>

    <div class="section">
      <h3>3) Related Purchase Requests</h3>
      <table>
        <thead><tr><th>PR ID</th><th>Description</th><th>Amount</th><th>Status</th><th>Created At</th></tr></thead>
        <tbody>${prsRows}</tbody>
      </table>
    </div>

    <div class="footer">
      <div>Generated timestamp: ${escapeHtml(new Date().toLocaleString())}</div>
      <div>System name: Procurement Management System</div>
    </div>`;

  return await renderHtmlToPdfBuffer(pageShell(`Project ${data.projectCode}`, body));
}
