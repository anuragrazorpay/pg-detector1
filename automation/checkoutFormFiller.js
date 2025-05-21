/**
 * Attempts to autofill common checkout fields.
 * @param {import('playwright').Page} page
 * @param {Object} testData - From config.testData
 */
export async function fillCheckoutIfVisible(page, testData) {
  const selectors = [
    { field: 'email',   queries: ['input[type="email"]', 'input[name*=email]', 'input[placeholder*=email]'] },
    { field: 'name',    queries: ['input[name*=name]', 'input[placeholder*=name]'] },
    { field: 'phone',   queries: ['input[type="tel"]', 'input[name*=phone]', 'input[placeholder*=phone]'] },
    { field: 'addressLine1', queries: ['input[name*=address]', 'input[placeholder*=address]'] },
    { field: 'city',    queries: ['input[name*=city]', 'input[placeholder*=city]'] },
    { field: 'state',   queries: ['input[name*=state]', 'input[placeholder*=state]'] },
    { field: 'pincode', queries: ['input[name*=pin]', 'input[name*=zip]', 'input[placeholder*=pin]', 'input[placeholder*=zip]'] }
  ];
  for (const { field, queries } of selectors) {
    for (const sel of queries) {
      const value = testData[field];
      if (!value) continue;
      try {
        const input = await page.$(sel);
        if (input) {
          await input.fill(value);
          break;
        }
      } catch {}
    }
  }
}
