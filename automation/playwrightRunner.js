import { chromium } from 'playwright';
import { config } from '../config.js';
import { USER_AGENTS } from '../userAgents.js';
import { findLikelyButtons } from './heuristics.js';
import { saveEvidence } from './evidence.js';
import { suggestSelectorsWithGemini } from '../llm/domSelectorGemini.js';
import { suggestOptionFillWithGemini } from '../llm/optionFillingGemini.js';
import { suggestPopupCloseWithGemini } from '../llm/popupHandlerGemini.js';

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// --- UNIVERSAL POPUP HANDLER ---
/**
 * Call this after any major navigation/click in your Playwright flow.
 * @param {import('playwright').Page} page
 */
async function autoClosePopups(page) {
  const popupsArr = await page.evaluate(() => {
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
    return Array.from(document.querySelectorAll(
      '[role="dialog"], .modal, .popup, .overlay, [aria-modal="true"], .dialog, .newsletter, .cookie'
    )).filter(el => {
      const style = window.getComputedStyle(el);
      return style && style.visibility !== 'hidden' && style.display !== 'none' && el.offsetHeight > 0 && el.offsetWidth > 0;
    }).map(el => ({
      tagName: el.tagName,
      innerText: el.innerText,
      id: el.id,
      class: el.className,
      selector: cssPath(el)
    }));
  });

  if (!popupsArr.length) return;

  const popupSelectors = await suggestPopupCloseWithGemini(popupsArr);
  for (const popupSel of popupSelectors) {
    try {
      await page.waitForSelector(popupSel, { timeout: 1500 });
      await page.click(popupSel, { delay: 50 });
    } catch (err) {
      // Ignore and continue
    }
  }
}

// --- MAIN WORKFLOW ---
export async function runCartSimulation(url, actionList = ['add to cart', 'checkout']) {
  const browser = await chromium.launch({ headless: config.headless, slowMo: config.slowMo });
  const context = await browser.newContext({ userAgent: randomUA() });
  const page = await context.newPage();
  const evidenceDir = `${config.evidenceDir}/${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  let step = 0;
  let log = [];

  try {
    await page.goto(url, { timeout: config.timeout, waitUntil: 'domcontentloaded' });
    await autoClosePopups(page);
    await saveEvidence({ page, step, evidenceDir, meta: { url, note: 'Initial load' } });

    for (const action of actionList) {
      step += 1;

      // POPUP HANDLING (before each main step)
      await autoClosePopups(page);

      // Gather all visible, interactive elements
      const elementsArr = await page.evaluate(() => {
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
        return Array.from(document.querySelectorAll('button, a, input[type=submit]')).filter(el => {
          const style = window.getComputedStyle(el);
          return style && style.visibility !== 'hidden' && style.display !== 'none' && el.offsetHeight > 0 && el.offsetWidth > 0;
        }).map(el => ({
          tagName: el.tagName,
          innerText: el.innerText,
          ariaLabel: el.getAttribute('aria-label'),
          id: el.id,
          class: el.className,
          selector: cssPath(el)
        }));
      });

      // LLM try
      let selectors = await suggestSelectorsWithGemini(elementsArr, action);
      log.push({ action, selectors, via: 'gemini' });

      // Heuristic fallback
      if (!selectors || !selectors.length) {
        selectors = findLikelyButtons(elementsArr);
        log.push({ action, selectors, via: 'heuristics' });
      }

      let addToCartSuccess = false;
      for (const sel of selectors) {
        try {
          await page.waitForSelector(sel, { timeout: 4000 });

          // Check if the button is disabled
          const isDisabled = await page.$eval(sel, el =>
            el.disabled ||
            el.getAttribute('aria-disabled') === 'true' ||
            el.classList.contains('disabled') ||
            window.getComputedStyle(el).pointerEvents === 'none'
          );

          if (isDisabled) {
            // 1. Extract option/select/swatch/text elements
            const optionsArr = await page.evaluate(() => {
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
              return Array.from(document.querySelectorAll(
                'select, input:not([type="hidden"]), [role="option"], .swatch, .variant, .option, .product-option'
              )).filter(el => {
                const style = window.getComputedStyle(el);
                return style && style.visibility !== 'hidden' && style.display !== 'none' && el.offsetHeight > 0 && el.offsetWidth > 0;
              }).map(el => ({
                tagName: el.tagName,
                type: el.type,
                innerText: el.innerText,
                ariaLabel: el.getAttribute('aria-label'),
                id: el.id,
                class: el.className,
                selector: cssPath(el)
              }));
            });

            // 2. Ask Gemini for what to fill/click
            const fillInstructions = await suggestOptionFillWithGemini(optionsArr);

            // 3. Fill/click each suggestion
            for (const opt of fillInstructions) {
              try {
                await page.waitForSelector(opt.selector, { timeout: 2000 });
                if (opt.type === 'select-one' || opt.tagName === 'SELECT') {
                  await page.selectOption(opt.selector, { label: opt.value });
                } else if (opt.type === 'radio' || opt.type === 'checkbox') {
                  await page.check(opt.selector);
                } else if (opt.type === 'text' || opt.tagName === 'INPUT') {
                  await page.fill(opt.selector, opt.value || 'test');
                } else {
                  await page.click(opt.selector);
                }
              } catch (err) {
                continue;
              }
            }
            // 4. Retry add to cart
            await autoClosePopups(page);
            await page.click(sel, { delay: 50 });
            addToCartSuccess = true;
            break;
          } else {
            await autoClosePopups(page);
            await page.click(sel, { delay: 50 });
            addToCartSuccess = true;
            break;
          }
        } catch (err) {
          log.push({ action, sel, error: err.message });
          continue;
        }
      }
      await saveEvidence({ page, step, evidenceDir, meta: { action, selectors, note: addToCartSuccess ? 'Success' : 'No selectors worked' } });
      if (!addToCartSuccess) {
        log.push({ action, error: 'No selectors worked' });
      }
      // Wait for cart/modal/checkout UI to appear, or page change
      await page.waitForTimeout(2000);
    }

    // At end, capture all scripts, iframes, network logs
    step += 1;
    await autoClosePopups(page);
    const scripts = await page.evaluate(() => Array.from(document.scripts).map(s => s.src));
    const iframes = await page.evaluate(() => Array.from(document.querySelectorAll('iframe')).map(f => f.src));
    await saveEvidence({ page, step, evidenceDir, meta: { scripts, iframes, log } });
    await browser.close();

    return { success: true, evidenceDir, scripts, iframes, log };
  } catch (err) {
    await browser.close();
    return { success: false, error: err.message, log };
  }
}
