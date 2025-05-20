import { chromium } from 'playwright';
import { config } from '../config.js';
import { USER_AGENTS } from '../userAgents.js';
import { findLikelyButtons } from './heuristics.js';
import { saveEvidence } from './evidence.js';
import { suggestSelectorsWithGemini } from '../llm/domSelectorGemini.js';

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export async function runCartSimulation(url, actionList = ['add to cart', 'checkout']) {
  const browser = await chromium.launch({ headless: config.headless, slowMo: config.slowMo });
  const context = await browser.newContext({ userAgent: randomUA() });
  const page = await context.newPage();
  const evidenceDir = `${config.evidenceDir}/${Date.now()}_${Math.floor(Math.random()*1000)}`;
  let step = 0;
  let log = [];

  try {
    await page.goto(url, { timeout: config.timeout, waitUntil: 'domcontentloaded' });
    await saveEvidence({ page, step, evidenceDir, meta: { url, note: 'Initial load' } });

    for (const action of actionList) {
      step += 1;
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
              name += `:nth-child(${[...el.parentElement.children].indexOf(el)+1})`;
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

      let success = false;
      for (const sel of selectors) {
        try {
          await page.waitForSelector(sel, { timeout: 4000 });
          await page.click(sel, { delay: 50 });
          await saveEvidence({ page, step, evidenceDir, meta: { action, sel, note: 'Clicked' } });
          success = true;
          break;
        } catch (err) {
          log.push({ action, sel, error: err.message });
          continue;
        }
      }
      if (!success) {
        log.push({ action, error: 'No selectors worked' });
      }
      await page.waitForTimeout(2000);
    }

    step += 1;
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
