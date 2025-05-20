import { chromium } from 'playwright';
import { config } from '../config.js';
import { USER_AGENTS } from '../userAgents.js';
import { findLikelyButtons } from './heuristics.js';
import { saveEvidence } from './evidence.js';
import { suggestSelectorsWithGemini } from '../llm/domSelectorGemini.js';
import { suggestOptionFillWithGemini } from '../llm/optionFillingGemini.js';
import { suggestPopupCloseWithGemini } from '../llm/popupHandlerGemini.js';
import { suggestLoginStrategyWithGemini } from '../llm/loginHandlerGemini.js';
import { detectAndHandleCaptcha } from './captchaHandler.js';
import { suggestNextActionWithVisionLLM } from '../llm/visionFallbackGemini.js';
import axios from 'axios';
import fs from 'fs';

// --- Proxy Rotation ---
const PROXIES = process.env.PROXIES
  ? process.env.PROXIES.split(',').map(x => x.trim()).filter(Boolean)
  : [];

function randomProxy(usedProxies = []) {
  if (!PROXIES.length) return null;
  const unused = PROXIES.filter(p => !usedProxies.includes(p));
  if (!unused.length) return PROXIES[Math.floor(Math.random() * PROXIES.length)];
  return unused[Math.random() * unused.length | 0];
}

// --- Webhook for n8n: send on both success and failure ---
const WEBHOOK_URL = process.env.HITL_WEBHOOK_URL || 'https://your-n8n-instance/webhook/pg-detector-result';

async function sendWebhook(payload) {
  try {
    await axios.post(WEBHOOK_URL, payload, { timeout: 5000 });
  } catch (err) {
    const errorLog = {
      time: new Date().toISOString(),
      webhook: WEBHOOK_URL,
      payload,
      error: err.message,
    };
    fs.appendFileSync('./evidence/webhook_errors.log', JSON.stringify(errorLog) + '\n');
  }
}

// --- Ensure evidence directory exists ---
if (!fs.existsSync(config.evidenceDir)) fs.mkdirSync(config.evidenceDir, { recursive: true });

// --- Robust waiting for selectors with retries ---
async function waitForStable(selector, page, retries = 3, timeout = 8000) {
  for (let i = 0; i < retries; i++) {
    try {
      await page.waitForSelector(selector, { timeout, state: 'visible' });
      return true;
    } catch {
      if (i === retries - 1) throw new Error(`Selector ${selector} not found after retries`);
    }
  }
}

// --- Universal Popup Handler ---
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
      await waitForStable(popupSel, page, 2, 2000);
      await page.click(popupSel, { delay: 50 });
    } catch (err) {}
  }
}

// --- Payment Gateway Detection (20+ Indian/global PGs) ---
function detectPaymentGateways({ scripts, iframes }) {
  const patterns = [
    { name: "Razorpay", regex: /razorpay|checkout\.razorpay/i },
    { name: "PayU", regex: /payu|payu\.in|secure\.payu/i },
    { name: "Stripe", regex: /stripe|js\.stripe|checkout\.stripe/i },
    { name: "CCAvenue", regex: /ccavenue|secure\.ccavenue/i },
    { name: "Cashfree", regex: /cashfree|checkout\.cashfree/i },
    { name: "Billdesk", regex: /billdesk|pguat\.billdesk|eazy\.billdesk/i },
    { name: "Paytm", regex: /paytm|securegw\.paytm|merchant\.paytm/i },
    { name: "PhonePe", regex: /phonepe|pg\.phonepe|payments\.phonepe/i },
    { name: "Amazon Pay", regex: /amazonpay|pay\.amazon\.in|amazon\.co\.in\/payment/i },
    { name: "Mobikwik", regex: /mobikwik|wallet\.mobikwik/i },
    { name: "Pine Labs", regex: /pinelabs|plutus|plutus-cloud/i },
    { name: "Airtel Payments Bank", regex: /airtelpay|airtelbank/i },
    { name: "Google Pay (GPay)", regex: /googlepay|gpay|pay\.google\.com/i },
    { name: "Juspay", regex: /juspay|juspay\.io|expresscheckout/i },
    { name: "Worldline (Ingenico)", regex: /worldline|ingenico/i },
    { name: "HDFC Payment Gateway", regex: /hdfcbank|paymentgateway\.hdfcbank/i },
    { name: "ICICI Payment Gateway", regex: /icicibank|icicipayments/i },
    { name: "Axis Bank Payment Gateway", regex: /axisbank|paymentgateway\.axisbank/i },
    { name: "PayPal", regex: /paypal|www\.paypalobjects\.com|paypal\.com/i },
    { name: "BharatQR", regex: /bharatqr/i },
    { name: "Flexmoney", regex: /flexmoney|instantemi|checkout\.flexmoney/i },
    { name: "OneCard", regex: /getonecard|onecard|one\.card/i },
    { name: "Square", regex: /squareup|square\.com|squarecdn/i },
    { name: "ZestMoney", regex: /zestmoney/i },
    { name: "Instamojo", regex: /instamojo|checkout\.instamojo/i },
    { name: "Paykun", regex: /paykun|checkout\.paykun/i },
    { name: "UPI", regex: /upi|pay\.upi|upi\.pay|vpa=/i },
    { name: "SBI ePay", regex: /sbiepay|sbi\.co\.in\/epay/i },
    { name: "Atom", regex: /atomtech|atom\.in/i },
    { name: "Direcpay", regex: /direcpay/i },
    { name: "EBS", regex: /ebs|ebs\.in|ebssecure/i },
    { name: "PayGlocal", regex: /payglocal/i },
    { name: "FSS", regex: /fssnet|fss\.co\.in/i },
    { name: "Avenues", regex: /avenues|avenues\.in/i },
    // Add more as needed!
  ];
  const found = [];
  const allSources = (scripts || []).concat(iframes || []);
  for (const { name, regex } of patterns) {
    if (allSources.some(src => regex.test(src))) found.push(name);
  }
  return found;
}

// --- Tier 4 Autofill ---
async function autofillCheckoutFields(page) {
  // Only fill visible, non-disabled fields if they exist.
  const autofillData = {
    'email': 'utube.115111@gmail.com',
    'name': 'John Doe',
    'phone': '9090119090',
    'address': 'Splendid Lakedews, Vittasandra Main Rd, Begur, Bengaluru, Karnataka 560068',
    'password': 'utube115111@',
    'country code': '+91'
  };
  const fieldSelectors = [
    { type: 'email', keys: ['email'] },
    { type: 'text', keys: ['name', 'full name'] },
    { type: 'tel', keys: ['phone', 'mobile', 'contact'] },
    { type: 'text', keys: ['address', 'addr', 'street'] },
    { type: 'password', keys: ['password'] },
    { type: 'text', keys: ['country code', 'country'] }
  ];
  // Find all visible, fillable input fields.
  const fields = await page.evaluate(() => {
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
    return Array.from(document.querySelectorAll('input, textarea')).filter(el => {
      const style = window.getComputedStyle(el);
      return style && style.visibility !== 'hidden' && style.display !== 'none' && el.offsetHeight > 0 && el.offsetWidth > 0 && !el.disabled;
    }).map(el => ({
      tagName: el.tagName,
      type: el.type,
      name: el.name || '',
      id: el.id || '',
      placeholder: el.placeholder || '',
      selector: cssPath(el)
    }));
  });
  // Try to match and fill each field
  for (const f of fields) {
    for (const fs of fieldSelectors) {
      if (
        (f.type === fs.type || fs.type === 'text') &&
        fs.keys.some(k =>
          (f.name && f.name.toLowerCase().includes(k)) ||
          (f.id && f.id.toLowerCase().includes(k)) ||
          (f.placeholder && f.placeholder.toLowerCase().includes(k))
        )
      ) {
        const value = autofillData[fs.keys[0]];
        if (value) {
          try { await page.fill(f.selector, value); } catch {}
          break;
        }
      }
    }
  }
}

// --- OTP Detection ---
async function detectOTP(page) {
  const otpSelectors = [
    'input[autocomplete="one-time-code"]',
    'input[type="tel"][maxlength="6"]',
    'input[type="text"][maxlength="6"]',
    'input[placeholder*="OTP"]',
    'input[placeholder*="otp"]'
  ];
  for (const sel of otpSelectors) {
    const found = await page.$(sel);
    if (found) return sel;
  }
  return null;
}

// --- Main Exported Function ---
export async function runCartSimulation(url, actionList = ['add to cart', 'checkout'], runContext = {}) {
  let usedProxies = [];
  let proxyRetryCount = 0;
  const maxProxyRetries = 3;
  let proxy = randomProxy(usedProxies);
  let browser, context, page;
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const evidenceDir = `${config.evidenceDir}/${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  let step = 0;
  let log = [];
  let resultPayload = {};

  while (proxyRetryCount < maxProxyRetries) {
    try {
      browser = await chromium.launch({
        headless: config.headless,
        slowMo: config.slowMo,
        proxy: proxy ? { server: 'http://' + proxy } : undefined
      });
      context = await browser.newContext({ userAgent: ua });
      page = await context.newPage();

      await page.goto(url, { timeout: config.timeout, waitUntil: 'domcontentloaded' });
      await autoClosePopups(page);

      let captchaCheck = await detectAndHandleCaptcha(page, evidenceDir.replace('./evidence/', ''));
      if (captchaCheck.type) {
        log.push({ step, captcha: captchaCheck });
        await saveEvidence({ page, step, evidenceDir, meta: { url, note: 'CAPTCHA Detected', captcha: captchaCheck } });
        resultPayload = {
          url,
          status: "failure",
          failureType: "captcha",
          step,
          proxy,
          userAgent: ua,
          evidenceDir,
          reason: captchaCheck,
          log,
          paymentGateways: [],
          runContext
        };
        await sendWebhook(resultPayload);
        await browser.close();
        usedProxies.push(proxy);
        proxy = randomProxy(usedProxies);
        proxyRetryCount++;
        continue;
      }

      await saveEvidence({ page, step, evidenceDir, meta: { url, note: 'Initial load' } });

      let addToCartSuccess = false;

      for (const action of actionList) {
        step += 1;
        await autoClosePopups(page);

        captchaCheck = await detectAndHandleCaptcha(page, evidenceDir.replace('./evidence/', '') + `_step${step}`);
        if (captchaCheck.type) {
          log.push({ step, captcha: captchaCheck });
          await saveEvidence({ page, step, evidenceDir, meta: { action, note: 'CAPTCHA Detected', captcha: captchaCheck } });
          resultPayload = {
            url,
            status: "failure",
            failureType: "captcha",
            step,
            proxy,
            userAgent: ua,
            evidenceDir,
            reason: captchaCheck,
            log,
            paymentGateways: [],
            runContext
          };
          await sendWebhook(resultPayload);
          await browser.close();
          usedProxies.push(proxy);
          proxy = randomProxy(usedProxies);
          proxyRetryCount++;
          continue;
        }

        // --- LOGIN LOGIC (Gemini LLM-guided) ---
        const loginArr = await page.evaluate(() => {
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
          return Array.from(document.querySelectorAll('input[type="email"], input[type="text"], input[type="password"], button, a')).filter(el => {
            const t = (el.innerText || el.value || '').toLowerCase();
            if (t.includes('login') || t.includes('sign in') || t.includes('continue as guest') || t.includes('guest checkout')) return true;
            return false;
          }).map(el => ({
            tagName: el.tagName,
            type: el.type,
            innerText: el.innerText,
            id: el.id,
            class: el.className,
            selector: cssPath(el)
          }));
        });
        const loginInstruction = await suggestLoginStrategyWithGemini(loginArr);
        if (loginInstruction) {
          try {
            if (loginInstruction.type === 'guest') {
              await waitForStable(loginInstruction.selector, page, 3, 4000);
              await page.click(loginInstruction.selector, { delay: 50 });
              await autoClosePopups(page);
            } else if (loginInstruction.type === 'login') {
              await waitForStable(loginInstruction.usernameSelector, page, 3, 4000);
              await page.fill(loginInstruction.usernameSelector, loginInstruction.creds.username);
              await waitForStable(loginInstruction.passwordSelector, page, 3, 4000);
              await page.fill(loginInstruction.passwordSelector, loginInstruction.creds.password);
              await waitForStable(loginInstruction.loginBtnSelector, page, 3, 4000);
              await page.click(loginInstruction.loginBtnSelector, { delay: 50 });
              await autoClosePopups(page);
            }
          } catch (err) {
            log.push({ action, login: loginInstruction, error: err.message });
            resultPayload = {
              url,
              status: "failure",
              failureType: "login",
              step,
              proxy,
              userAgent: ua,
              evidenceDir,
              reason: loginInstruction,
              log,
              paymentGateways: [],
              runContext
            };
            await sendWebhook(resultPayload);
            await saveEvidence({ page, step, evidenceDir, meta: { action, note: 'Login Failed', loginInstruction } });
            await browser.close();
            return { success: false, evidenceDir, log, reason: 'login failed', step };
          }
        }

        // --- SELECTOR SUGGESTION LOGIC (Gemini/Heuristics, fallback to Vision LLM) ---
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

        let selectors = await suggestSelectorsWithGemini(elementsArr, action);
        log.push({ action, selectors, via: 'gemini' });
        if (!selectors || !selectors.length) {
          selectors = findLikelyButtons(elementsArr);
          log.push({ action, selectors, via: 'heuristics' });
        }

        let fallbackVisionTried = false;
        let actionSuccess = false;

        for (const sel of selectors) {
          try {
            await waitForStable(sel, page, 3, 6000);

            const isDisabled = await page.$eval(sel, el =>
              el.disabled ||
              el.getAttribute('aria-disabled') === 'true' ||
              el.classList.contains('disabled') ||
              window.getComputedStyle(el).pointerEvents === 'none'
            );
            if (isDisabled) {
              // --- Option filling logic when button is disabled ---
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
              const fillInstructions = await suggestOptionFillWithGemini(optionsArr);
              for (const opt of fillInstructions) {
                try {
                  await waitForStable(opt.selector, page, 2, 3000);
                  if (opt.type === 'select-one' || opt.tagName === 'SELECT') {
                    await page.selectOption(opt.selector, { label: opt.value });
                  } else if (opt.type === 'radio' || opt.type === 'checkbox') {
                    await page.check(opt.selector);
                  } else if (opt.type === 'text' || opt.tagName === 'INPUT') {
                    await page.fill(opt.selector, opt.value || 'test');
                  } else {
                    await page.click(opt.selector);
                  }
                } catch (err) { continue; }
              }
              await autoClosePopups(page);
              await waitForStable(sel, page, 3, 6000);
              await page.click(sel, { delay: 50 });
              actionSuccess = true;
              break;
            } else {
              await autoClosePopups(page);
              await page.click(sel, { delay: 50 });
              actionSuccess = true;
              break;
            }
          } catch (err) {
            log.push({ action, sel, error: err.message });
            continue;
          }
        }

        // --- LLM Vision Fallback ---
        if (!actionSuccess && !fallbackVisionTried) {
          const screenshotPath = `${evidenceDir}/step_${step}_vision.png`;
          await page.screenshot({ path: screenshotPath, fullPage: true });
          const html = await page.content();
          const visionAction = await suggestNextActionWithVisionLLM(screenshotPath, html, action);
          if (visionAction && visionAction.selector) {
            try {
              await waitForStable(visionAction.selector, page, 2, 6000);
              await page.click(visionAction.selector, { delay: 80 });
              actionSuccess = true;
              log.push({ action, via: 'vision-llm', selector: visionAction.selector });
            } catch (err) {
              log.push({ action, via: 'vision-llm', error: err.message });
            }
          }
        }

        await saveEvidence({ page, step, evidenceDir, meta: { action, selectors, note: actionSuccess ? 'Success' : 'No selectors worked' } });
        if (!actionSuccess) {
          log.push({ action, error: 'No selectors worked (even with LLM Vision fallback)' });
          resultPayload = {
            url,
            status: "failure",
            failureType: "no-selector",
            step,
            proxy,
            userAgent: ua,
            evidenceDir,
            reason: 'No add-to-cart/checkout selectors found',
            log,
            paymentGateways: [],
            runContext
          };
          await sendWebhook(resultPayload);
          await browser.close();
          return { success: false, evidenceDir, log, reason: 'No selectors worked', step };
        }
        await page.waitForTimeout(1500);
      }

      // --- Tier 4: Autofill checkout fields just before payment step ---
      step += 1;
      await autoClosePopups(page);
      await autofillCheckoutFields(page);

      // --- OTP Detection (stops, takes screenshot, sends payload, does not proceed further) ---
      const otpField = await detectOTP(page);
      if (otpField) {
        const otpPath = `${evidenceDir}/step_${step}_otp.png`;
        await page.screenshot({ path: otpPath, fullPage: true });
        await saveEvidence({ page, step, evidenceDir, meta: { otpDetected: true, otpField, note: 'OTP prompt' } });
        resultPayload = {
          url,
          status: "halted",
          haltReason: "otp_required",
          step,
          proxy,
          userAgent: ua,
          evidenceDir,
          log,
          runContext,
          otpScreenshot: otpPath
        };
        await sendWebhook(resultPayload);
        await browser.close();
        return { success: false, evidenceDir, log, reason: 'OTP detected', step };
      }

      // --- Final PG detection ---
      const scripts = await page.evaluate(() => Array.from(document.scripts).map(s => s.src));
      const iframes = await page.evaluate(() => Array.from(document.querySelectorAll('iframe')).map(f => f.src));
      const paymentGateways = detectPaymentGateways({ scripts, iframes });
      await saveEvidence({ page, step, evidenceDir, meta: { scripts, iframes, log, paymentGateways } });

      resultPayload = {
        url,
        status: "success",
        step,
        proxy,
        userAgent: ua,
        evidenceDir,
        log,
        scripts,
        iframes,
        paymentGateways,
        runContext
      };
      await sendWebhook(resultPayload);
      await browser.close();
      return { success: true, evidenceDir, scripts, iframes, log, paymentGateways };
    } catch (err) {
      log.push({ error: err.message, step, proxy });
      if (browser) await browser.close();
      resultPayload = {
        url,
        status: "failure",
        failureType: "error",
        step,
        proxy,
        userAgent: ua,
        evidenceDir: null,
        reason: err.message,
        log,
        paymentGateways: [],
        runContext
      };
      await sendWebhook(resultPayload);
      usedProxies.push(proxy);
      proxy = randomProxy(usedProxies);
      proxyRetryCount++;
    }
  }
  resultPayload = {
    url,
    status: "failure",
    failureType: "all-proxy-failed",
    log,
    paymentGateways: [],
    runContext
  };
  await sendWebhook(resultPayload);
  return { success: false, log, reason: 'All proxies/cycles failed' };
}
