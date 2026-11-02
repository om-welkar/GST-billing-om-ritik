import assert from 'assert';
import * as utils from '../src/utils.js';

console.log('--- STARTING COMPREHENSIVE GST BILLING AUDIT TEST (V2) ---');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
    failed++;
  }
}

// 1. GSTIN Checksum and state decoding
test('GSTIN validation & state decoding', () => {
  // Valid Delhi GSTIN with check digit '4'
  const gstinDelhi = '07AAAAA0000A1Z4';
  assert.strictEqual(utils.getStateCode(gstinDelhi), '07');
  const decoded = utils.decodeGstin(gstinDelhi);
  assert.strictEqual(decoded.stateCode, '07');
  assert.strictEqual(decoded.pan, 'AAAAA0000A');
  assert.strictEqual(utils.gstinChecksumOk(gstinDelhi), true);

  // Invalid checksum (wrong check char '9')
  assert.strictEqual(utils.gstinChecksumOk('07AAAAA0000A1Z9'), false);
});

// 2. Intra-state vs Inter-state determination
test('Intra-state vs Inter-state supply', () => {
  const profileDelhi = { gstin: '07AAAAA0000A1Z4', state: 'Delhi' };
  // Supplier Delhi to Buyer Delhi -> false (Intra-state)
  assert.strictEqual(utils.isInterstateSupply('07AAAAA0000A1Z4', profileDelhi), false);
  // Supplier Maharashtra (27) to Buyer Delhi (07) -> true (Inter-state)
  assert.strictEqual(utils.isInterstateSupply('27AAAAA0000A1Z5', profileDelhi), true);
});

// 3. Union Territory detection
test('Union Territory without legislature', () => {
  assert.strictEqual(utils.isUnionTerritoryWithoutLegislature('04'), true); // Chandigarh
  assert.strictEqual(utils.isUnionTerritoryWithoutLegislature('38'), true); // Ladakh
  assert.strictEqual(utils.isUnionTerritoryWithoutLegislature('35'), true); // Andaman & Nicobar
  assert.strictEqual(utils.isUnionTerritoryWithoutLegislature('31'), true); // Lakshadweep
  assert.strictEqual(utils.isUnionTerritoryWithoutLegislature('26'), true); // Dadra & Nagar Haveli and Daman & Diu
  assert.strictEqual(utils.isUnionTerritoryWithoutLegislature('07'), false); // Delhi (has legislature)
  assert.strictEqual(utils.isUnionTerritoryWithoutLegislature('27'), false); // Maharashtra (state)
});

// 4. Line item tax calculation - Tax Exclusive
test('Line item tax - Tax Exclusive (18%)', () => {
  const item = {
    quantity: 2,
    rate: 1000,
    taxPercent: 18,
    discount: 0
  };
  const tax = utils.calculateLineItemTax(item, false);
  assert.strictEqual(tax.amount, 2000);
  assert.strictEqual(tax.afterDiscount, 2000);
  assert.strictEqual(tax.taxAmount, 360);
  assert.strictEqual(tax.total, 2360);
});

// 5. Line item tax calculation - Tax Inclusive
test('Line item tax - Tax Inclusive (18%)', () => {
  const item = {
    quantity: 1,
    rate: 118,
    taxPercent: 18,
    discount: 0
  };
  const tax = utils.calculateLineItemTax(item, true);
  assert.strictEqual(Math.round(tax.afterDiscount * 100) / 100, 100);
  assert.strictEqual(Math.round(tax.taxAmount * 100) / 100, 18);
  assert.strictEqual(tax.total, 118);
});

// 6. Configurable GST Rates (0%, 0.1%, 0.25%, 1.5%, 3%, 5%, 12%, 18%, 28%)
test('Configurable GST Rates', () => {
  const rates = [0, 0.1, 0.25, 1.5, 3, 5, 12, 18, 28];
  for (const r of rates) {
    const item = { quantity: 1, rate: 1000, taxPercent: r };
    const tax = utils.calculateLineItemTax(item, false);
    const expectedTax = Math.round(1000 * (r / 100) * 100) / 100;
    assert.strictEqual(Math.round(tax.taxAmount * 100) / 100, expectedTax);
  }
});

// 7. Discounts: Fixed Net, Percent, Unit, With-tax
test('Discount calculations on line items', () => {
  // Percent discount: 10% off 1000 = 100 discount
  const discPercent = utils.resolveLineDiscount({
    quantity: 2,
    rate: 500,
    discount: 10,
    discountType: 'percent',
    taxPercent: 18
  }, false);
  assert.strictEqual(discPercent, 100);

  // Fixed net discount: 150 off net 1000
  const discFixed = utils.resolveLineDiscount({
    quantity: 2,
    rate: 500,
    discount: 150,
    discountType: 'fixed',
    discountBase: 'net',
    taxPercent: 18
  }, false);
  assert.strictEqual(discFixed, 150);

  // Fixed per unit discount: 50 per unit * 2 units = 100
  const discUnit = utils.resolveLineDiscount({
    quantity: 2,
    rate: 500,
    discount: 50,
    discountType: 'fixed',
    discountBase: 'unit',
    taxPercent: 18
  }, false);
  assert.strictEqual(discUnit, 100);
});

// 8. Invoice totals computation: Intra-state (CGST + SGST split)
test('Invoice totals - Intra-state CGST + SGST split', () => {
  const opts = {
    profile: { country: 'India', state: 'Delhi', gstin: '07AAAAA0000A1Z4' },
    client: { country: 'India', state: 'Delhi', gstin: '07BBBBB0000B1Z4' },
    details: { placeOfSupply: '07 - Delhi' },
    items: [
      { name: 'Item 1', quantity: 2, rate: 1000, taxPercent: 18, discount: 0 }
    ],
    showGST: true,
    taxInclusive: false
  };
  const totals = utils.computeInvoiceTotals(opts);
  assert.strictEqual(totals.taxableAmount, 2000);
  assert.strictEqual(totals.cgst, 180);
  assert.strictEqual(totals.sgst, 180);
  assert.strictEqual(totals.utgst, 0);
  assert.strictEqual(totals.igst, 0);
  assert.strictEqual(totals.totalTaxAmount, 360);
  assert.strictEqual(totals.total, 2360);
});

// 9. Invoice totals computation: Inter-state (IGST)
test('Invoice totals - Inter-state IGST', () => {
  const opts = {
    profile: { country: 'India', state: 'Delhi', gstin: '07AAAAA0000A1Z4' },
    client: { country: 'India', state: 'Maharashtra', gstin: '27BBBBB0000B1Z4' },
    details: { placeOfSupply: '27 - Maharashtra' },
    items: [
      { name: 'Item 1', quantity: 2, rate: 1000, taxPercent: 18, discount: 0 }
    ],
    showGST: true,
    taxInclusive: false
  };
  const totals = utils.computeInvoiceTotals(opts);
  assert.strictEqual(totals.taxableAmount, 2000);
  assert.strictEqual(totals.cgst, 0);
  assert.strictEqual(totals.sgst, 0);
  assert.strictEqual(totals.igst, 360);
  assert.strictEqual(totals.totalTaxAmount, 360);
  assert.strictEqual(totals.total, 2360);
});

// 10. Intra-UT Supply (UTGST)
test('Invoice totals - Intra-UT UTGST', () => {
  const opts = {
    profile: { country: 'India', state: 'Chandigarh', gstin: '04AAAAA0000A1Z4' },
    client: { country: 'India', state: 'Chandigarh', gstin: '04BBBBB0000B1Z4' },
    details: { placeOfSupply: '04 - Chandigarh' },
    items: [
      { name: 'Item 1', quantity: 1, rate: 1000, taxPercent: 18 }
    ],
    showGST: true
  };
  const totals = utils.computeInvoiceTotals(opts);
  assert.strictEqual(totals.cgst, 90);
  assert.strictEqual(totals.sgst, 0);
  assert.strictEqual(totals.utgst, 90);
  assert.strictEqual(totals.igst, 0);
  assert.strictEqual(totals.total, 1180);
});

// 11. Decimal precision and round-off
test('Round-off to nearest rupee', () => {
  const opts = {
    profile: { country: 'India', state: 'Delhi' },
    client: { country: 'India', state: 'Delhi' },
    details: { placeOfSupply: 'Delhi' },
    items: [
      { name: 'Item 1', quantity: 1, rate: 100.40, taxPercent: 18 }
    ],
    showGST: true,
    invoiceOptions: { showRoundOff: true }
  };
  const totals = utils.computeInvoiceTotals(opts);
  // 100.40 + 18.07 = 118.47 -> roundOff = -0.47 -> total = 118
  assert.strictEqual(totals.total, 118);
  assert.strictEqual(totals.roundOff, -0.47);
});

// 12. Reverse Charge Mechanism (RCM)
test('Reverse Charge Mechanism (RCM)', () => {
  const opts = {
    profile: { country: 'India', state: 'Delhi' },
    client: { country: 'India', state: 'Delhi' },
    details: { placeOfSupply: 'Delhi' },
    items: [
      { name: 'Legal Service', quantity: 1, rate: 10000, taxPercent: 18 }
    ],
    showGST: true,
    invoiceOptions: { reverseCharge: true }
  };
  const totals = utils.computeInvoiceTotals(opts);
  // Under RCM, buyer remits tax, supplier collects taxable value only
  assert.strictEqual(totals.taxableAmount, 10000);
  assert.strictEqual(totals.cgst, 0);
  assert.strictEqual(totals.sgst, 0);
  assert.strictEqual(totals.total, 10000);
});

// 13. Number to Words (Indian format: Rupees and Paise, Lakhs and Crores)
test('Number to words (Indian numbering system)', () => {
  const words1 = utils.numberToWords(1234567.50);
  assert.strictEqual(words1, 'Twelve Lakh Thirty Four Thousand Five Hundred and Sixty Seven Rupees and Fifty Paise Only');

  const wordsZero = utils.numberToWords(0);
  assert.strictEqual(wordsZero, 'Zero Rupees Only');

  const wordsCrore = utils.numberToWords(15000000);
  assert.strictEqual(wordsCrore, 'One Crore Fifty Lakh Rupees Only');
});

console.log(`\nTEST RESULTS: ${passed} passed, ${failed} failed`);
