/**
 * CASABE KONNECT R4 - PHASE 5: RECEIPTS & INVOICES COMPONENTS
 * React components for generating and displaying receipts and invoices
 * 
 * Components:
 * - ReceiptTemplate: Payment receipt generator
 * - InvoiceTemplate: Shipment invoice generator
 * - ReceiptPDFGenerator: Convert receipt HTML to PDF
 * - InvoicePDFGenerator: Convert invoice HTML to PDF
 * 
 * Features:
 * - Actual box dimensions (from database)
 * - Itemized line items
 * - QR code generation
 * - Print-safe CSS
 * - SMS/WhatsApp plain text versions
 * - PDF export
 */

"use strict";

// ─────────────────────────────────────────────────────────
// PAYMENT RECEIPT TEMPLATE
// ─────────────────────────────────────────────────────────

var PaymentReceiptTemplate = {
  /**
   * Generate plain text receipt for SMS/WhatsApp
   * Format: Compact, no special formatting
   */
  generatePlainText: function(data) {
    var lines = [];
    lines.push("===============================================");
    lines.push("CASABE KONNECT - PAYMENT RECEIPT");
    lines.push("===============================================");
    lines.push("");
    lines.push("Receipt #: " + data.receiptNumber);
    lines.push("Date: " + data.receiptDate + " " + data.receiptTime);
    lines.push("Order #: " + data.orderId);
    lines.push("");
    lines.push("-----------------------------------------------");
    lines.push("PAYMENT DETAILS");
    lines.push("-----------------------------------------------");
    lines.push("Amount: " + data.amountDisplay);
    lines.push("Method: " + data.paymentMethod);
    if (data.paymentReference) {
      lines.push("Reference: " + data.paymentReference);
    }
    lines.push("");
    lines.push("-----------------------------------------------");
    lines.push("PAYER INFO");
    lines.push("-----------------------------------------------");
    lines.push("Name: " + data.payerName);
    if (data.payerEmail) lines.push("Email: " + data.payerEmail);
    if (data.payerPhone) lines.push("Phone: " + data.payerPhone);
    lines.push("");
    lines.push("-----------------------------------------------");
    lines.push("TRANSACTION VERIFIED");
    lines.push("-----------------------------------------------");
    lines.push("Thank you for your payment!");
    lines.push("Keep this receipt for your records.");
    lines.push("");
    lines.push("casabe.example.com");
    lines.push("===============================================");
    
    return lines.join("\n");
  },
  
  /**
   * Generate HTML receipt for printing/email
   */
  generateHTML: function(data) {
    var qrDataURL = data.qrCodeDataURL || '';
    
    var html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Receipt #${data.receiptNumber}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', monospace;
      background: #f5f5f5;
      padding: 20px;
    }
    .receipt-container {
      max-width: 400px;
      margin: 0 auto;
      background: white;
      padding: 20px;
      border: 1px solid #ddd;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      border-bottom: 2px solid #333;
      padding-bottom: 10px;
      margin-bottom: 15px;
    }
    .header h1 {
      font-size: 16px;
      font-weight: bold;
      letter-spacing: 1px;
    }
    .header p {
      font-size: 12px;
      color: #666;
      margin-top: 5px;
    }
    .section {
      margin-bottom: 15px;
    }
    .section-title {
      font-size: 11px;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px dashed #999;
      padding-bottom: 5px;
      margin-bottom: 8px;
    }
    .field {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      margin-bottom: 4px;
    }
    .field-label { font-weight: bold; }
    .field-value { text-align: right; }
    .amount-box {
      border: 2px solid #333;
      padding: 10px;
      text-align: center;
      margin: 10px 0;
      background: #f9f9f9;
    }
    .amount-label {
      font-size: 10px;
      color: #666;
      text-transform: uppercase;
    }
    .amount-value {
      font-size: 24px;
      font-weight: bold;
      color: #000;
    }
    .qr-code {
      text-align: center;
      margin: 15px 0;
    }
    .qr-code img {
      width: 120px;
      height: 120px;
      border: 1px solid #ddd;
    }
    .footer {
      text-align: center;
      border-top: 2px solid #333;
      padding-top: 10px;
      margin-top: 15px;
      font-size: 10px;
      color: #666;
    }
    .footer p { margin-bottom: 3px; }
    
    /* Print styles */
    @media print {
      body { padding: 0; background: white; }
      .receipt-container { max-width: 100%; box-shadow: none; border: none; }
    }
  </style>
</head>
<body>
  <div class="receipt-container">
    <div class="header">
      <h1>CASABE KONNECT</h1>
      <p>Payment Receipt</p>
    </div>
    
    <div class="section">
      <div class="section-title">Receipt Information</div>
      <div class="field">
        <span class="field-label">Receipt #:</span>
        <span class="field-value">${data.receiptNumber}</span>
      </div>
      <div class="field">
        <span class="field-label">Date/Time:</span>
        <span class="field-value">${data.receiptDate} ${data.receiptTime}</span>
      </div>
      <div class="field">
        <span class="field-label">Order #:</span>
        <span class="field-value">${data.orderId}</span>
      </div>
    </div>
    
    <div class="section">
      <div class="section-title">Payment Details</div>
      <div class="amount-box">
        <div class="amount-label">Amount Paid</div>
        <div class="amount-value">${data.amountDisplay}</div>
      </div>
      <div class="field">
        <span class="field-label">Method:</span>
        <span class="field-value">${data.paymentMethod}</span>
      </div>
      ${data.paymentReference ? `
      <div class="field">
        <span class="field-label">Reference:</span>
        <span class="field-value">${data.paymentReference}</span>
      </div>
      ` : ''}
    </div>
    
    <div class="section">
      <div class="section-title">Payer Information</div>
      <div class="field">
        <span class="field-label">Name:</span>
        <span class="field-value">${data.payerName}</span>
      </div>
      ${data.payerEmail ? `
      <div class="field">
        <span class="field-label">Email:</span>
        <span class="field-value">${data.payerEmail}</span>
      </div>
      ` : ''}
      ${data.payerPhone ? `
      <div class="field">
        <span class="field-label">Phone:</span>
        <span class="field-value">${data.payerPhone}</span>
      </div>
      ` : ''}
    </div>
    
    ${qrDataURL ? `
    <div class="qr-code">
      <img src="${qrDataURL}" alt="QR Code" />
    </div>
    ` : ''}
    
    <div class="footer">
      <p>Thank you for your payment!</p>
      <p>Keep this receipt for your records.</p>
      <p style="margin-top: 8px; color: #999;">casabe.example.com</p>
    </div>
    ${data.disclaimer && data.disclaimer.text ? `
    <div class="inv-disclaimer" style="margin-top:0.18in;padding-top:0.1in;border-top:1pt solid #ccc;font-size:7pt;color:#555;line-height:1.5;">
      ${data.disclaimer.title ? `<div style="font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:3pt;color:#333;">${data.disclaimer.title}</div>` : ''}
      <div>${data.disclaimer.text}</div>
    </div>` : ''}
  </div>
</body>
</html>
    `;
    
    return html;
  }
};

// ─────────────────────────────────────────────────────────
// SHIPMENT INVOICE TEMPLATE
// ─────────────────────────────────────────────────────────

var ShipmentInvoiceTemplate = {
  /**
   * Generate plain text invoice for SMS/WhatsApp
   */
  generatePlainText: function(data) {
    var lines = [];
    lines.push("===============================================");
    lines.push("CASABE KONNECT - SHIPMENT INVOICE");
    lines.push("===============================================");
    lines.push("");
    lines.push("Invoice #: " + data.invoiceNumber);
    lines.push("Date: " + data.invoiceDate);
    lines.push("Order #: " + data.orderId);
    lines.push("");
    lines.push("----------------------------------------------");
    lines.push("SHIPPER INFORMATION");
    lines.push("----------------------------------------------");
    lines.push("Name: " + data.shipperName);
    if (data.shipperAddress) lines.push("Address: " + data.shipperAddress);
    if (data.shipperPhone) lines.push("Phone: " + data.shipperPhone);
    if (data.shipperEmail) lines.push("Email: " + data.shipperEmail);
    lines.push("");
    lines.push("----------------------------------------------");
    lines.push("RECIPIENT INFORMATION");
    lines.push("----------------------------------------------");
    lines.push("Name: " + data.recipientName);
    if (data.recipientAddress) lines.push("Address: " + data.recipientAddress);
    if (data.recipientPhone) lines.push("Phone: " + data.recipientPhone);
    if (data.recipientEmail) lines.push("Email: " + data.recipientEmail);
    lines.push("");
    lines.push("----------------------------------------------");
    lines.push("SHIPMENT DETAILS");
    lines.push("----------------------------------------------");
    lines.push("Service: " + (data.serviceType || "Cargo Shipment"));
    lines.push("Pickup Location: " + (data.pickupLocation || "Office"));
    if (data.dropoffAddress) lines.push("Dropoff: " + data.dropoffAddress);
    lines.push("Number of Boxes: " + data.numBoxes);
    if (data.totalWeightLbs) {
      lines.push("Total Weight: " + data.totalWeightLbs + " lbs");
    }
    lines.push("");
    lines.push("----------------------------------------------");
    lines.push("ITEMS");
    lines.push("----------------------------------------------");
    if (data.items && data.items.length > 0) {
      data.items.forEach(function(item, idx) {
        lines.push((idx + 1) + ". " + item.description);
        lines.push("   Price: " + item.priceDisplay + " x " + item.quantity);
        lines.push("   Subtotal: " + item.subtotalDisplay);
      });
    }
    lines.push("");
    lines.push("----------------------------------------------");
    lines.push("SUMMARY");
    lines.push("----------------------------------------------");
    lines.push("Subtotal: " + data.subtotalDisplay);
    if (data.shippingCostDisplay) {
      lines.push("Shipping: " + data.shippingCostDisplay);
    }
    if (data.taxDisplay) {
      lines.push("Tax: " + data.taxDisplay);
    }
    if (data.discountDisplay) {
      lines.push("Discount: -" + data.discountDisplay);
    }
    lines.push("TOTAL: " + data.totalDisplay);
    lines.push("");
    if (data.notes) {
      lines.push("NOTES:");
      lines.push(data.notes);
      lines.push("");
    }
    lines.push("===============================================");
    lines.push("casabe.example.com");
    lines.push("===============================================");
    
    return lines.join("\n");
  },
  
  /**
   * Generate HTML invoice for printing/email
   */
  generateHTML: function(data) {
    var qrDataURL = data.qrCodeDataURL || '';
    
    // Format items table
    var itemsHTML = '';
    if (data.items && data.items.length > 0) {
      itemsHTML = `
      <table class="items-table">
        <thead>
          <tr>
            <th style="text-align: left; width: 50%">Description</th>
            <th style="text-align: center; width: 15%">Qty</th>
            <th style="text-align: right; width: 17.5%">Unit Price</th>
            <th style="text-align: right; width: 17.5%">Total</th>
          </tr>
        </thead>
        <tbody>
      `;
      
      data.items.forEach(function(item, idx) {
        itemsHTML += `
          <tr>
            <td>${item.description}</td>
            <td style="text-align: center">${item.quantity}</td>
            <td style="text-align: right">${item.priceDisplay}</td>
            <td style="text-align: right">${item.subtotalDisplay}</td>
          </tr>
        `;
      });
      
      itemsHTML += `
        </tbody>
      </table>
      `;
    }
    
    // Format summary
    var summaryHTML = `
    <div class="summary">
      <div class="summary-row">
        <span>Subtotal:</span>
        <span>${data.subtotalDisplay}</span>
      </div>
    `;
    
    if (data.shippingCostDisplay) {
      summaryHTML += `
      <div class="summary-row">
        <span>Shipping:</span>
        <span>${data.shippingCostDisplay}</span>
      </div>
      `;
    }
    
    if (data.taxDisplay) {
      summaryHTML += `
      <div class="summary-row">
        <span>Tax:</span>
        <span>${data.taxDisplay}</span>
      </div>
      `;
    }
    
    if (data.discountDisplay) {
      summaryHTML += `
      <div class="summary-row">
        <span>Discount:</span>
        <span>-${data.discountDisplay}</span>
      </div>
      `;
    }
    
    summaryHTML += `
      <div class="summary-row total">
        <span>TOTAL:</span>
        <span>${data.totalDisplay}</span>
      </div>
    </div>
    `;
    
    var html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Invoice #${data.invoiceNumber}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', monospace;
      background: #f5f5f5;
      padding: 20px;
    }
    .invoice-container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      padding: 30px;
      border: 1px solid #ddd;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #333;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .header-left h1 {
      font-size: 24px;
      font-weight: bold;
      margin-bottom: 5px;
    }
    .header-left p {
      font-size: 12px;
      color: #666;
    }
    .header-right {
      text-align: right;
    }
    .invoice-meta {
      font-size: 13px;
      margin-bottom: 8px;
    }
    .invoice-meta strong { display: inline-block; width: 80px; }
    .section {
      margin-bottom: 25px;
    }
    .section-title {
      font-size: 12px;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid #999;
      padding-bottom: 8px;
      margin-bottom: 10px;
    }
    .section-content {
      font-size: 12px;
      line-height: 1.6;
    }
    .field { margin-bottom: 4px; }
    .field strong { display: inline-block; width: 100px; }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin: 15px 0;
      font-size: 12px;
    }
    .items-table thead {
      background: #f5f5f5;
      border-bottom: 2px solid #333;
    }
    .items-table th {
      padding: 8px;
      font-weight: bold;
      text-align: left;
    }
    .items-table td {
      padding: 8px;
      border-bottom: 1px solid #ddd;
    }
    .items-table tbody tr:nth-child(even) {
      background: #fafafa;
    }
    .summary {
      width: 100%;
      max-width: 400px;
      margin-left: auto;
      margin-top: 20px;
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      padding: 6px 0;
      border-bottom: 1px solid #ddd;
    }
    .summary-row.total {
      border-top: 2px solid #333;
      border-bottom: 2px solid #333;
      font-weight: bold;
      font-size: 14px;
      padding: 10px 0;
    }
    .qr-code {
      text-align: center;
      margin: 20px 0;
    }
    .qr-code img {
      width: 150px;
      height: 150px;
      border: 1px solid #ddd;
    }
    .notes {
      margin-top: 20px;
      padding: 10px;
      background: #f9f9f9;
      border-left: 3px solid #333;
      font-size: 11px;
      line-height: 1.5;
    }
    .footer {
      text-align: center;
      border-top: 2px solid #333;
      padding-top: 15px;
      margin-top: 30px;
      font-size: 10px;
      color: #666;
    }
    
    /* Print styles */
    @media print {
      body { padding: 0; background: white; }
      .invoice-container { box-shadow: none; border: none; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="invoice-container">
    <div class="header">
      <div class="header-left">
        <h1>CASABE KONNECT</h1>
        <p>Shipment Invoice</p>
      </div>
      <div class="header-right">
        <div class="invoice-meta">
          <strong>Invoice #:</strong> ${data.invoiceNumber}
        </div>
        <div class="invoice-meta">
          <strong>Date:</strong> ${data.invoiceDate}
        </div>
        <div class="invoice-meta">
          <strong>Order #:</strong> ${data.orderId}
        </div>
      </div>
    </div>
    
    <div class="section">
      <div class="section-title">Shipper Information</div>
      <div class="section-content">
        <div class="field"><strong>Name:</strong> ${data.shipperName}</div>
        ${data.shipperAddress ? `<div class="field"><strong>Address:</strong> ${data.shipperAddress}</div>` : ''}
        ${data.shipperPhone ? `<div class="field"><strong>Phone:</strong> ${data.shipperPhone}</div>` : ''}
        ${data.shipperEmail ? `<div class="field"><strong>Email:</strong> ${data.shipperEmail}</div>` : ''}
      </div>
    </div>
    
    <div class="section">
      <div class="section-title">Recipient Information</div>
      <div class="section-content">
        <div class="field"><strong>Name:</strong> ${data.recipientName}</div>
        ${data.recipientAddress ? `<div class="field"><strong>Address:</strong> ${data.recipientAddress}</div>` : ''}
        ${data.recipientPhone ? `<div class="field"><strong>Phone:</strong> ${data.recipientPhone}</div>` : ''}
        ${data.recipientEmail ? `<div class="field"><strong>Email:</strong> ${data.recipientEmail}</div>` : ''}
      </div>
    </div>
    
    <div class="section">
      <div class="section-title">Shipment Details</div>
      <div class="section-content">
        <div class="field"><strong>Service:</strong> ${data.serviceType || "Cargo Shipment"}</div>
        <div class="field"><strong>Pickup:</strong> ${data.pickupLocation || "Office"}</div>
        ${data.dropoffAddress ? `<div class="field"><strong>Dropoff:</strong> ${data.dropoffAddress}</div>` : ''}
        <div class="field"><strong>Number of Boxes:</strong> ${data.numBoxes}</div>
        ${data.totalWeightLbs ? `<div class="field"><strong>Total Weight:</strong> ${data.totalWeightLbs} lbs</div>` : ''}
      </div>
    </div>
    
    ${itemsHTML}
    
    ${summaryHTML}
    
    ${qrDataURL ? `
    <div class="qr-code">
      <img src="${qrDataURL}" alt="Invoice QR Code" />
    </div>
    ` : ''}
    
    ${data.notes ? `
    <div class="notes">
      <strong>Notes:</strong><br/>
      ${data.notes}
    </div>
    ` : ''}
    
    <div class="footer">
      <p>Thank you for your business!</p>
      <p style="margin-top: 8px;">casabe.example.com</p>
    </div>
    ${data.disclaimer && data.disclaimer.text ? `
    <div class="inv-disclaimer" style="margin-top:0.18in;padding-top:0.1in;border-top:1pt solid #ccc;font-size:7pt;color:#555;line-height:1.5;">
      ${data.disclaimer.title ? `<div style="font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:3pt;color:#333;">${data.disclaimer.title}</div>` : ''}
      <div>${data.disclaimer.text}</div>
    </div>` : ''}
  </div>
</body>
</html>
    `;
    
    return html;
  }
};

// ─────────────────────────────────────────────────────────
// PDF GENERATOR UTILITIES
// ─────────────────────────────────────────────────────────

var PDFGenerators = {
  /**
   * Convert HTML to PDF using html2canvas + jsPDF (requires external libs)
   * Alternative: Server-side rendering with headless browser
   */
  htmlToPDF: function(htmlContent, filename) {
    // This is a placeholder - real implementation would use:
    // - html2pdf library (lightweight)
    // - or server-side rendering with Puppeteer/wkhtmltopdf
    
    var blob = new Blob([htmlContent], { type: 'text/html' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename || 'document.pdf';
    link.click();
    URL.revokeObjectURL(url);
  },
  
  /**
   * Print HTML receipt/invoice
   */
  printHTML: function(htmlContent) {
    var win = window.open('', 'print', 'height=600,width=800');
    win.document.write(htmlContent);
    win.document.close();
    win.focus();
    win.print();
  }
};

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PaymentReceiptTemplate: PaymentReceiptTemplate,
    ShipmentInvoiceTemplate: ShipmentInvoiceTemplate,
    PDFGenerators: PDFGenerators
  };
}
