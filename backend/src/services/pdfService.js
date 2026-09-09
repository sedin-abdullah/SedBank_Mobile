/**
 * PDF documents (pdf-lib): repayment schedule, account statement and the
 * No-Dues Certificate issued on closure.
 *
 * Everything is drawn with the standard 14 fonts, so there are no font assets to
 * ship and no licensing to worry about. Currency is written as "Rs." rather than
 * the rupee glyph because WinAnsi (the standard-font encoding) cannot encode "₹".
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import dayjs from 'dayjs';

const A4 = [595.28, 841.89];
const MARGIN = 44;

const BRAND = rgb(0.11, 0.31, 0.85);
const INK = rgb(0.12, 0.14, 0.19);
const MUTED = rgb(0.42, 0.45, 0.52);
const RULE = rgb(0.85, 0.87, 0.91);
const ZEBRA = rgb(0.965, 0.97, 0.98);

/** WinAnsi-safe money formatting. */
const money = (value) =>
  `Rs. ${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const date = (value) => (value ? dayjs(value).format('DD MMM YYYY') : '-');

/** Strips characters the standard fonts cannot encode. */
const safe = (text) => String(text ?? '').replace(/[^\x20-\x7E]/g, '');

class PdfBuilder {
  constructor(doc, fonts) {
    this.doc = doc;
    this.fonts = fonts;
    this.page = null;
    this.y = 0;
    this.addPage();
  }

  addPage() {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - MARGIN;
    return this.page;
  }

  /** Reserves vertical space, paginating when the page runs out. */
  need(height) {
    if (this.y - height < MARGIN + 30) {
      this.addPage();
      return true;
    }
    return false;
  }

  text(value, { x = MARGIN, size = 10, font = 'regular', color = INK, dy = 0 } = {}) {
    this.page.drawText(safe(value), { x, y: this.y + dy, size, font: this.fonts[font], color });
  }

  right(value, { x = A4[0] - MARGIN, size = 10, font = 'regular', color = INK, dy = 0 } = {}) {
    const str = safe(value);
    const width = this.fonts[font].widthOfTextAtSize(str, size);
    this.page.drawText(str, { x: x - width, y: this.y + dy, size, font: this.fonts[font], color });
  }

  move(amount) {
    this.y -= amount;
  }

  rule(color = RULE) {
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: A4[0] - MARGIN, y: this.y },
      thickness: 0.75,
      color,
    });
  }

  /** Branded header block, drawn on the first page of every document. */
  header(title, subtitle = '') {
    this.page.drawRectangle({
      x: 0,
      y: A4[1] - 84,
      width: A4[0],
      height: 84,
      color: BRAND,
    });
    this.page.drawText('SedBank', {
      x: MARGIN,
      y: A4[1] - 46,
      size: 20,
      font: this.fonts.bold,
      color: rgb(1, 1, 1),
    });
    this.page.drawText(safe('Digital Lending Platform'), {
      x: MARGIN,
      y: A4[1] - 64,
      size: 9,
      font: this.fonts.regular,
      color: rgb(0.85, 0.89, 1),
    });

    const titleWidth = this.fonts.bold.widthOfTextAtSize(safe(title), 13);
    this.page.drawText(safe(title), {
      x: A4[0] - MARGIN - titleWidth,
      y: A4[1] - 46,
      size: 13,
      font: this.fonts.bold,
      color: rgb(1, 1, 1),
    });

    if (subtitle) {
      const subWidth = this.fonts.regular.widthOfTextAtSize(safe(subtitle), 9);
      this.page.drawText(safe(subtitle), {
        x: A4[0] - MARGIN - subWidth,
        y: A4[1] - 64,
        size: 9,
        font: this.fonts.regular,
        color: rgb(0.85, 0.89, 1),
      });
    }

    this.y = A4[1] - 84 - 28;
  }

  /** Two-column label/value grid. */
  keyValues(pairs, columns = 2) {
    const colWidth = (A4[0] - MARGIN * 2) / columns;

    for (let i = 0; i < pairs.length; i += columns) {
      this.need(34);
      const slice = pairs.slice(i, i + columns);

      slice.forEach(([label], index) => {
        this.page.drawText(safe(label.toUpperCase()), {
          x: MARGIN + index * colWidth,
          y: this.y,
          size: 7.5,
          font: this.fonts.bold,
          color: MUTED,
        });
      });

      this.move(13);

      slice.forEach(([, value], index) => {
        this.page.drawText(safe(value), {
          x: MARGIN + index * colWidth,
          y: this.y,
          size: 10.5,
          font: this.fonts.regular,
          color: INK,
        });
      });

      this.move(19);
    }
  }

  sectionTitle(title) {
    this.need(30);
    this.move(6);
    this.text(title, { size: 11.5, font: 'bold' });
    this.move(8);
    this.rule();
    this.move(14);
  }

  /**
   * Table with right-aligned numeric columns.
   * @param {Array<{label:string,width:number,align?:'left'|'right'}>} columns
   */
  table(columns, rows) {
    const drawHead = () => {
      this.page.drawRectangle({
        x: MARGIN,
        y: this.y - 4,
        width: A4[0] - MARGIN * 2,
        height: 18,
        color: ZEBRA,
      });
      let x = MARGIN + 6;
      columns.forEach((col) => {
        const label = safe(col.label.toUpperCase());
        if (col.align === 'right') {
          const w = this.fonts.bold.widthOfTextAtSize(label, 7.5);
          this.page.drawText(label, { x: x + col.width - w - 12, y: this.y, size: 7.5, font: this.fonts.bold, color: MUTED });
        } else {
          this.page.drawText(label, { x, y: this.y, size: 7.5, font: this.fonts.bold, color: MUTED });
        }
        x += col.width;
      });
      this.move(20);
    };

    drawHead();

    rows.forEach((row, index) => {
      if (this.need(18)) drawHead();

      if (index % 2 === 1) {
        this.page.drawRectangle({
          x: MARGIN,
          y: this.y - 4,
          width: A4[0] - MARGIN * 2,
          height: 16,
          color: ZEBRA,
        });
      }

      let x = MARGIN + 6;
      columns.forEach((col, colIndex) => {
        const value = safe(row[colIndex]);
        const font = col.bold ? this.fonts.bold : this.fonts.regular;
        if (col.align === 'right') {
          const w = font.widthOfTextAtSize(value, 8.5);
          this.page.drawText(value, { x: x + col.width - w - 12, y: this.y, size: 8.5, font, color: INK });
        } else {
          this.page.drawText(value, { x, y: this.y, size: 8.5, font, color: INK });
        }
        x += col.width;
      });

      this.move(16);
    });
  }

  /** Footer + page numbers, applied to every page at the end. */
  finish(note) {
    const pages = this.doc.getPages();
    pages.forEach((page, index) => {
      page.drawLine({
        start: { x: MARGIN, y: MARGIN + 22 },
        end: { x: A4[0] - MARGIN, y: MARGIN + 22 },
        thickness: 0.75,
        color: RULE,
      });
      page.drawText(safe(note), {
        x: MARGIN,
        y: MARGIN + 8,
        size: 7.5,
        font: this.fonts.regular,
        color: MUTED,
      });
      const label = `Page ${index + 1} of ${pages.length}`;
      const w = this.fonts.regular.widthOfTextAtSize(label, 7.5);
      page.drawText(label, {
        x: A4[0] - MARGIN - w,
        y: MARGIN + 8,
        size: 7.5,
        font: this.fonts.regular,
        color: MUTED,
      });
    });
  }
}

async function newBuilder() {
  const doc = await PDFDocument.create();
  doc.setCreator('SedBank');
  doc.setProducer('SedBank (demo)');

  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  return new PdfBuilder(doc, fonts);
}

const FOOTER =
  'SedBank is a demonstration application. All data shown is simulated and has no legal or financial standing.';

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

/** Full amortisation schedule with per-installment status. */
export async function buildSchedulePdf({ loan, borrower, schedule }) {
  const b = await newBuilder();
  b.header('Repayment Schedule', loan.loanNo);

  b.keyValues([
    ['Borrower', borrower?.name ?? '-'],
    ['Loan account', loan.loanNo],
    ['Sanctioned amount', money(loan.sanctionedAmount)],
    ['Interest rate', `${loan.roi}% p.a. (reducing balance)`],
    ['Tenure', `${loan.tenureMonths} months`],
    ['Monthly EMI', money(loan.emiAmount)],
    ['Disbursed on', date(loan.disbursedAt)],
    ['Maturity date', date(loan.maturityDate)],
  ]);

  b.sectionTitle('Installment schedule');

  b.table(
    [
      { label: '#', width: 34 },
      { label: 'Due date', width: 92 },
      { label: 'Opening', width: 84, align: 'right' },
      { label: 'Principal', width: 76, align: 'right' },
      { label: 'Interest', width: 70, align: 'right' },
      { label: 'EMI', width: 78, align: 'right' },
      { label: 'Status', width: 74, align: 'right' },
    ],
    schedule.map((emi) => [
      String(emi.installmentNo),
      date(emi.dueDate),
      money(emi.openingBalance),
      money(emi.principal),
      money(emi.interest),
      money(emi.totalAmount),
      emi.status.replace(/_/g, ' '),
    ])
  );

  const totals = schedule.reduce(
    (acc, emi) => ({
      principal: acc.principal + emi.principal,
      interest: acc.interest + emi.interest,
      total: acc.total + emi.totalAmount,
    }),
    { principal: 0, interest: 0, total: 0 }
  );

  b.move(4);
  b.rule();
  b.move(14);
  b.text('Totals', { font: 'bold' });
  b.right(
    `Principal ${money(totals.principal)}   Interest ${money(totals.interest)}   Payable ${money(totals.total)}`,
    { font: 'bold' }
  );

  b.finish(FOOTER);
  return Buffer.from(await b.doc.save());
}

/** Account statement: loan summary, ledger totals and the payment history. */
export async function buildStatementPdf({ loan, borrower, schedule, payments }) {
  const b = await newBuilder();
  b.header('Account Statement', loan.loanNo);

  b.keyValues([
    ['Borrower', borrower?.name ?? '-'],
    ['Statement date', dayjs().format('DD MMM YYYY')],
    ['Loan account', loan.loanNo],
    ['Status', loan.status.replace(/_/g, ' ')],
    ['Sanctioned amount', money(loan.sanctionedAmount)],
    ['Amount disbursed', money(loan.disbursedAmount)],
    ['Interest rate', `${loan.roi}% p.a.`],
    ['EMI', money(loan.emiAmount)],
  ]);

  b.sectionTitle('Ledger summary');
  b.keyValues([
    ['Principal repaid', money(loan.principalPaid)],
    ['Interest paid', money(loan.interestPaid)],
    ['Late fees paid', money(loan.penaltyPaid)],
    ['Total paid to date', money(loan.totalPaid)],
    ['Principal outstanding', money(loan.principalOutstanding)],
    ['Amount overdue', money(loan.overdueAmount)],
    ['Days past due', String(loan.dpd || 0)],
    ['Installments paid', `${schedule.filter((e) => e.status === 'paid').length} of ${loan.tenureMonths}`],
  ]);

  b.sectionTitle('Payment history');

  if (!payments.length) {
    b.text('No payments have been received on this account yet.', { color: MUTED });
    b.move(18);
  } else {
    b.table(
      [
        { label: 'Receipt', width: 96 },
        { label: 'Date', width: 88 },
        { label: 'Type', width: 84 },
        { label: 'Mode', width: 78 },
        { label: 'Principal', width: 72, align: 'right' },
        { label: 'Interest', width: 64, align: 'right' },
        { label: 'Amount', width: 76, align: 'right' },
      ],
      payments.map((p) => [
        p.paymentNo,
        date(p.paidAt),
        p.type.replace(/_/g, ' '),
        p.mode.replace(/_/g, ' '),
        money(p.principalComponent),
        money(p.interestComponent),
        money(p.amount),
      ])
    );

    b.move(4);
    b.rule();
    b.move(14);
    b.text('Total received', { font: 'bold' });
    b.right(money(payments.reduce((sum, p) => sum + p.amount, 0)), { font: 'bold' });
    b.move(18);
  }

  b.sectionTitle('Outstanding installments');
  const open = schedule.filter((emi) => !['paid', 'waived'].includes(emi.status));

  if (!open.length) {
    b.text('All installments have been settled. Nothing is outstanding.', { color: MUTED });
  } else {
    b.table(
      [
        { label: '#', width: 34 },
        { label: 'Due date', width: 100 },
        { label: 'EMI', width: 96, align: 'right' },
        { label: 'Late fee', width: 90, align: 'right' },
        { label: 'Paid', width: 90, align: 'right' },
        { label: 'Status', width: 88, align: 'right' },
      ],
      open.map((emi) => [
        String(emi.installmentNo),
        date(emi.dueDate),
        money(emi.totalAmount),
        money(emi.penalty),
        money(emi.amountPaid),
        emi.status.replace(/_/g, ' '),
      ])
    );
  }

  b.finish(FOOTER);
  return Buffer.from(await b.doc.save());
}

/** No-Dues Certificate, issued once a loan is fully settled. */
export async function buildNocPdf({ loan, borrower }) {
  const b = await newBuilder();
  b.header('No Dues Certificate', loan.loanNo);

  b.move(10);
  b.text('TO WHOMSOEVER IT MAY CONCERN', { size: 12, font: 'bold' });
  b.move(28);

  const closedOn = date(loan.closedAt);
  const lines = [
    `This is to certify that the ${loan.status === 'foreclosed' ? 'foreclosed' : 'closed'} loan account`,
    `${loan.loanNo}, held by ${borrower?.name ?? 'the borrower'}, has been fully repaid and`,
    `settled as on ${closedOn}.`,
    '',
    `A ${loan.tenureMonths}-month personal loan of ${money(loan.sanctionedAmount)} was disbursed on`,
    `${date(loan.disbursedAt)} at an interest rate of ${loan.roi}% per annum. Total repayments`,
    `received against this account amount to ${money(loan.totalPaid)}.`,
    '',
    'SedBank confirms that no amount remains outstanding against this loan account,',
    'and that all charges relating to it have been settled in full. No dues of any',
    'nature are pending from the borrower in respect of this facility.',
  ];

  lines.forEach((line) => {
    if (line) b.text(line, { size: 11 });
    b.move(19);
  });

  b.move(10);
  b.sectionTitle('Account summary');
  b.keyValues([
    ['Loan account', loan.loanNo],
    ['Borrower', borrower?.name ?? '-'],
    ['Sanctioned amount', money(loan.sanctionedAmount)],
    ['Total repaid', money(loan.totalPaid)],
    ['Disbursed on', date(loan.disbursedAt)],
    ['Closed on', closedOn],
    ['Closure reason', loan.closureReason || 'Loan fully repaid'],
    ['Outstanding balance', money(0)],
  ]);

  b.move(30);
  b.text('Authorised digitally by SedBank', { size: 10, font: 'bold' });
  b.move(15);
  b.text(`Certificate reference: NOC-${String(loan.loanNo).replace(/[^A-Z0-9]/gi, '')}-${dayjs().format('YYYYMMDD')}`, {
    size: 9,
    color: MUTED,
  });
  b.move(13);
  b.text('This certificate is system-generated and does not require a physical signature.', {
    size: 9,
    color: MUTED,
  });

  b.finish(FOOTER);
  return Buffer.from(await b.doc.save());
}

export default { buildSchedulePdf, buildStatementPdf, buildNocPdf };
