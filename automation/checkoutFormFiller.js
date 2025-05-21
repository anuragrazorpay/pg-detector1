import { config } from '../config.js';

/**
 * Attempts to autofill common checkout fields using config.testData.
 * @param {import('playwright').Page} page
 * @param {Object} testData - Autofill data from config.testData
 */
export async function fillCheckoutIfVisible(page, testData = config.testData) {
  const selectors = [
    // Email
    { field: 'email', queries: ['input[type="email"]', 'input[name*=email]', 'input[placeholder*=email]'] },
    // Name
    { field: 'name', queries: ['input[name*=name]', 'input[placeholder*=name]'] },
    // Password
    { field: 'password', queries: ['input[type="password"]', 'input[name*=password]', 'input[placeholder*=password]'] },
    // Phone
    { field: 'phone', queries: ['input[type="tel"]', 'input[name*=phone]', 'input[placeholder*=phone]'] },
    // Country Code
    { field: 'countryCode', queries: ['input[name*=countrycode]', 'input[placeholder*=countrycode]', 'select[name*=country]', 'select[placeholder*=country]'] },
    // Address Line 1
    { field: 'addressLine1', queries: ['input[name*=address1]', 'input[placeholder*=address1]', 'input[name*=address]', 'input[placeholder*=address]'] },
    // Address Line 2
    { field: 'addressLine2', queries: ['input[name*=address2]', 'input[placeholder*=address2]', 'textarea[name*=address]', 'textarea[placeholder*=address]'] },
    // City
    { field: 'city', queries: ['input[name*=city]', 'input[placeholder*=city]'] },
    // State
    { field: 'state', queries: ['input[name*=state]', 'input[placeholder*=state]'] },
    // Pincode/Zip
    { field: 'pincode', queries: ['input[name*=pin]', 'input[name*=zip]', 'input[placeholder*=pin]', 'input[placeholder*=zip]'] },
    // Country
    { field: 'country', queries: ['input[name*=country]', 'input[placeholder*=country]', 'select[name*=country]', 'select[placeholder*=country]'] }
  ];

  for (const { field, queries } of selectors) {
    for (const sel of queries) {
      const value = testData[field];
      if (!value) continue;
      try {
        // Handle select dropdowns for country, state, etc.
        const el = await page.$(sel);
        if (el) {
          const tagName = await el.evaluate(e => e.tagName);
          if (tagName === 'SELECT') {
            await el.selectOption({ label: value });
          } else {
            await el.fill(value);
          }
          break;
        }
      } catch {}
    }
  }
}
