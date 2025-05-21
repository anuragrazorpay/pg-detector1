// automation/heuristics.js

// Heuristic scoring for Add to Cart / Checkout / Buy Now / Place Order buttons
const CHECKOUT_TEXTS = [
  "checkout", "buy now", "place order", "pay", "go to checkout", "continue to checkout",
  "proceed", "proceed to pay", "order now", "pay now", "continue to payment", "payment", "review order"
];

function findLikelyButtons(elementsArr) {
  if (!elementsArr || !Array.isArray(elementsArr)) return [];

  // 1. Strong match: visible button/anchor/input with checkout/trigger text
  let strong = elementsArr.filter(el =>
    el.tagName && /button|input|a/i.test(el.tagName) &&
    CHECKOUT_TEXTS.some(txt => (el.innerText || '').toLowerCase().includes(txt) ||
      (el.ariaLabel || '').toLowerCase().includes(txt) ||
      (el.class || '').toLowerCase().includes(txt) ||
      (el.id || '').toLowerCase().includes(txt)
    )
  ).map(el => el.selector);

  // 2. Modal/overlay/drawer context: try any visible actionable in popups
  let modalCandidates = elementsArr.filter(el =>
    (el.class || '').toLowerCase().match(/modal|drawer|overlay|popup|sheet|flyout/) &&
    /button|input|a/i.test(el.tagName)
  ).map(el => el.selector);

  // 3. Fallback: any visible button or input submit
  let anyVisible = elementsArr.filter(el =>
    /button|input|a/i.test(el.tagName)
  ).map(el => el.selector);

  // Deduplicate, keep order: strong > modal > visible
  return Array.from(new Set([
    ...strong,
    ...modalCandidates,
    ...anyVisible
  ])).filter(Boolean);
}

export { findLikelyButtons };
