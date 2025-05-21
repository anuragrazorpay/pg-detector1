// automation/popupHandler.js

/**
 * Collects all visible popup/modal/overlay elements and returns minimal info.
 * Used for LLM suggestion and for debug evidence.
 */
export async function getAllVisiblePopups(page) {
  return await page.evaluate(() => {
    function cssPath(el) {
      if (!el) return '';
      let path = '';
      while (el.parentElement) {
        let name = el.tagName.toLowerCase();
        if (el.id) {
          name += `#${el.id}`;
          path = name + (path ? '>' + path : '');
          break;
        }
        const sibs = Array.from(el.parentElement.children).filter(e => e.tagName === el.tagName);
        if (sibs.length > 1) {
          name += `:nth-child(${[...el.parentElement.children].indexOf(el) + 1})`;
        }
        path = name + (path ? '>' + path : '');
        el = el.parentElement;
      }
      return path;
    }
    // Extended list: modals, popups, overlays, drawers, sheets, cookies, newsletters, banners
    const popupSelectors = [
      '[role="dialog"]', '[aria-modal="true"]', '.modal', '.popup', '.drawer', '.sheet', '.flyout',
      '.overlay', '.dialog', '.newsletter', '.cookie', '.banner', '.side-modal', '.bottom-sheet',
      '[data-testid*="modal"]', '[data-testid*="popup"]', '[data-testid*="overlay"]'
    ];
    const allPopups = Array.from(document.querySelectorAll(popupSelectors.join(',')))
      .filter(el => {
        const style = window.getComputedStyle(el);
        return style && style.visibility !== 'hidden' && style.display !== 'none' && el.offsetHeight > 0 && el.offsetWidth > 0;
      })
      .map(el => ({
        tagName: el.tagName,
        id: el.id,
        class: el.className,
        innerText: (el.innerText || '').slice(0, 200), // crop for evidence
        selector: cssPath(el)
      }));
    return allPopups;
  });
}
