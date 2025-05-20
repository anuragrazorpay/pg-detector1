export function findLikelyButtons(elements, keywords = ['add to cart', 'buy', 'checkout', 'cart', 'pay']) {
  const candidates = [];
  for (const el of elements) {
    const text = (el.innerText || el.ariaLabel || '').toLowerCase();
    for (const kw of keywords) {
      if (text.includes(kw)) {
        candidates.push(el.selector);
        break;
      }
    }
  }
  return candidates;
}

