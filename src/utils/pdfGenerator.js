// src/utils/pdfGenerator.js
import PDFDocument from 'pdfkit';

/**
 * Simple helper: convert a readable stream (PDFKit doc) into a Buffer.
 * Resolves when 'end' is emitted, rejects on 'error'.
 */
const streamToBuffer = (stream) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.once('end', () => resolve(Buffer.concat(chunks)));
    stream.once('error', (err) => reject(err));
  });


export const generateInvoicePdfBuffer = async (invoiceData = {}) => {
  const {
    invoiceNumber = `INV-${Date.now()}`,
    date = new Date().toISOString(),
    user = { name: '', email: '' },
    planName = '',
    amount, // in paise
    amountRupees,
    items = [],
    notes = '',
  } = invoiceData;

  const formatPaise = (p) => {
    if (p == null) return '₹0.00';
    const rupees = Number(p) / 100;
    if (!Number.isFinite(rupees)) return '₹0.00';
    return `₹${rupees.toFixed(2)}`;
  };

  // compute total (paise)
  const totalPaise = (amount != null)
    ? Number(amount)
    : (items && items.length
      ? items.reduce((s, it) => s + (Number(it.unitAmountPaise || 0) * (Number(it.qty || 1))), 0)
      : (amountRupees ? Math.round(Number(amountRupees) * 100) : 0));

  if (!Number.isFinite(totalPaise)) {
    throw new Error('Invalid total amount for invoice');
  }

  // Create the PDF document stream
  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  try {
    // Header
    doc.fontSize(20).text('Invoice', { align: 'center' });
    doc.moveDown(0.5);

    doc.fontSize(10).text(`Invoice No: ${invoiceNumber}`, { align: 'right' });
    doc.text(`Date: ${new Date(date).toLocaleDateString()}`, { align: 'right' });
    doc.moveDown(1);

    // From
    doc.fontSize(11).fillColor('#000').text('From:');
    doc.fontSize(10).text('Prydan (Your Company)');
    doc.text('no-reply@prydan.com');
    doc.moveDown(0.8);

    // Bill To
    doc.fontSize(11).text('Bill To:');
    doc.fontSize(10).text(user.name || '-');
    doc.text(user.email || '-');
    doc.moveDown(0.8);

    // separator
    doc.moveTo(doc.x, doc.y).lineTo(545, doc.y).stroke();

    doc.moveDown(0.8);

    // Table header
    doc.fontSize(11).text('Description', 50, doc.y, { continued: true });
    doc.text('Qty', 350, doc.y, { width: 50, align: 'right', continued: true });
    doc.text('Amount', 450, doc.y, { width: 90, align: 'right' });
    doc.moveDown(0.4);

    // Items or single plan
    if (items && items.length > 0) {
      items.forEach((it) => {
        const desc = it.description || '';
        const qty = Number(it.qty || 1);
        const amt = formatPaise(it.unitAmountPaise || 0);
        doc.fontSize(10).text(desc, 50, doc.y, { continued: true });
        doc.text(String(qty), 350, doc.y, { width: 50, align: 'right', continued: true });
        doc.text(amt, 450, doc.y, { width: 90, align: 'right' });
        doc.moveDown(0.3);
      });
    } else {
      doc.fontSize(10).text(planName || 'Subscription', 50, doc.y, { continued: true });
      doc.text('1', 350, doc.y, { width: 50, align: 'right', continued: true });
      if (amount != null) {
        doc.text(formatPaise(amount), 450, doc.y, { width: 90, align: 'right' });
      } else if (amountRupees != null) {
        doc.text(`₹${Number(amountRupees).toFixed(2)}`, 450, doc.y, { width: 90, align: 'right' });
      } else {
        doc.text('₹0.00', 450, doc.y, { width: 90, align: 'right' });
      }
      doc.moveDown(0.4);
    }

    doc.moveDown(1);

    // Total
    doc.fontSize(11).text('Total', 350, doc.y, { continued: true });
    doc.text(formatPaise(totalPaise), 450, doc.y, { width: 90, align: 'right' });

    doc.moveDown(1.5);

    if (notes) {
      doc.fontSize(10).text('Notes:', { underline: true });
      doc.fontSize(9).text(notes);
      doc.moveDown(1);
    }

    doc.moveDown(2);
    doc.fontSize(9).fillColor('#666').text('Thank you for your payment!', { align: 'center' });

    // Finalize PDF and collect buffer
    doc.end();
    const buffer = await streamToBuffer(doc);
    return buffer;
  } catch (err) {
    // ensure doc is ended if an error happened before doc.end() call
    try { doc.end(); } catch (_) {}
    throw err;
  }
};

export default { generateInvoicePdfBuffer };
