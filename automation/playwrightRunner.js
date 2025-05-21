import { chromium } from 'playwright';
import { config } from '../config.js';
import { USER_AGENTS } from './userAgents.js';
import { findLikelyButtons } from './heuristics.js';
import { saveEvidence } from './evidence.js';
import { suggestSelectorsWithGemini } from '../llm/domSelectorGemini.js';
import { suggestOptionFillWithGemini } from '../llm/optionFillingGemini.js';
import { suggestPopupCloseWithGemini } from '../llm/popupHandlerGemini.js';
import { suggestLoginStrategyWithGemini } from '../llm/loginHandlerGemini.js';
import { detectAndHandleCaptcha } from './captchaHandler.js';
import { suggestNextActionWithVisionLLM } from '../llm/visionNavigator.js';
import axios from 'axios';
import fs from 'fs';
import * as cheerio from 'cheerio';

// --- Proxy Handling ---
const PROXIES = process.env.PROXIES
  ? process.env.PROXIES.split(',').map(x => x.trim()).filter(Boolean)
  : [];
function randomProxy(usedProxies = []) {
  if (!PROXIES.length) return null;
  const unused = PROXIES.filter(p => !usedProxies.includes(p));
  if (!unused.length) return PROXIES[Math.floor(Math.random() * PROXIES.length)];
  return unused[Math.random() * unused.length | 0];
}

// --- Webhook ---
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

// --- Evidence Dir ---
if (!fs.existsSync(config.evidenceDir)) fs.mkdirSync(config.evidenceDir, { recursive: true });

// --- Wait Helper ---
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

// --- New: Aggressive Overlay/Modal/Backdrop Handler ---
async function closeCheckoutOverlays(page) {
  const selectors = [
    '#quickCheckoutBackdrop',
    '.quickCheckoutBackdrop',
    '.modal-backdrop',
    '[role="dialog"] .close',
    '.close-modal',
    '.close',
    '[aria-label="close"]',
    '.popup-close',
    '.modal .close',
    '.newsletter-close',
    '.cart-drawer [aria-label="close"]',
    '.mini-cart [aria-label="close"]',
    '[class*=backdrop]',
    '[id*=backdrop]',
    '[class*=overlay]',
    '[id*=overlay]',
    '[class*=popup]',
    '[id*=popup]',
    '[data-dismiss]',
  ];

  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      try {
        await el.click();
        await page.waitForTimeout(500);
        console.log(`Closed overlay via ${sel}`);
      } catch (err) {
        // If not clickable, force remove
        await page.evaluate(selector => {
          const e = document.querySelector(selector);
          if (e) e.remove();
        }, sel);
        console.log(`Force-removed overlay via ${sel}`);
      }
    }
  }
}

// --- Exhaustive Popup/Drawer/Modal Handler ---
async function handleAllPopups(page, log, step) {
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
      '[role="dialog"], .modal, .popup, .overlay, [aria-modal="true"], .dialog, .newsletter, .cookie, .drawer, .sheet, .flyout, .side-panel, .cart-modal, .mini-cart, .cart-drawer'
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
      log.push({ step, popup: popupSel, closed: true });
    } catch (err) {
      log.push({ step, popup: popupSel, error: err.message });
    }
  }
}

// --- PG Detection (scripts, iframes, network, visible text) ---
function detectPaymentGateways({ scripts, iframes, html, networkRequests, visibleText }) {
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
    { name: "Gokwik", regex: /gokwik|gwk\.to|gokwik\.com|analytics\.gokwik/i },
    { name: "Avenues", regex: /avenues|avenues\.in/i }
  ];
  const found = [];
  const allSources = (scripts || []).concat(iframes || []).concat(networkRequests || []).concat(visibleText || []);
  for (const { name, regex } of patterns) {
    if (allSources.some(src => regex.test(src))) found.push(name);
    if (html && regex.test(html)) found.push(name);
  }
  return Array.from(new Set(found));
}

// --- OTP ---
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

// --- Address Autofill Handler (Optional) ---
async function fillAddressIfVisible(page, log, step) {
  const addressFields = await page.evaluate(() => {
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
    return Array.from(document.querySelectorAll('input, textarea, select'))
      .filter(el => {
        const ph = (el.placeholder || '').toLowerCase();
        const nm = (el.name || '').toLowerCase();
        return (
          ph.includes('address') ||
          ph.includes('city') ||
          ph.includes('pin') ||
          ph.includes('postal') ||
          ph.includes('name') ||
          ph.includes('mobile') ||
          ph.includes('phone') ||
          ph.includes('email') ||
          nm.includes('address') ||
          nm.includes('city') ||
          nm.includes('pin') ||
          nm.includes('postal') ||
          nm.includes('name') ||
          nm.includes('mobile') ||
          nm.includes('phone') ||
          nm.includes('email')
        );
      })
      .map(el => ({
        tagName: el.tagName,
        name: el.getAttribute('name'),
        id: el.id,
        class: el.className,
        placeholder: el.placeholder,
        type: el.type,
        selector: cssPath(el)
      }));
  });
  if (addressFields.length > 0) {
    const addressInstruction = await suggestOptionFillWithGemini(addressFields, 'address');
    if (addressInstruction && Array.isArray(addressInstruction.fields)) {
      for (const { selector, value } of addressInstruction.fields) {
        try {
          await waitForStable(selector, page, 2, 4000);
          await page.fill(selector, value);
        } catch (err) {
          log.push({ step, autofill: selector, value, error: err.message });
        }
      }
    }
  }
}

// --- LIVE PG DETECTION FUNCTION ---
async function detectLivePaymentGateway(page) {
  const patterns = [
    { name: "Razorpay", regex: /razorpay|checkout\.razorpay|api\.razorpay|dashboard\.razorpay/i },
    { name: "PayU", regex: /payu|payu\.in|secure\.payu|payu\.money|api\.payu|paymentgateway\.payu/i },
    { name: "Stripe", regex: /stripe|js\.stripe|checkout\.stripe|api\.stripe|pay\.stripe|dashboard\.stripe/i },
    { name: "CCAvenue", regex: /ccavenue|secure\.ccavenue|payment\.ccavenue|checkout\.ccavenue|api\.ccavenue/i },
    { name: "Cashfree", regex: /cashfree|checkout\.cashfree|api\.cashfree|payments\.cashfree|cfstatic\.cashfree/i },
    { name: "Billdesk", regex: /billdesk|pguat\.billdesk|eazy\.billdesk|payment\.billdesk|pay\.billdesk/i },
    { name: "Paytm", regex: /paytm|securegw\.paytm|merchant\.paytm|paytm\.payments|paytm\.bank|api\.paytm/i },
    { name: "PhonePe", regex: /phonepe|pg\.phonepe|payments\.phonepe|api\.phonepe|phonepeassets|phonepecdn/i },
    { name: "Amazon Pay", regex: /amazonpay|pay\.amazon\.in|amazon\.co\.in\/payment|payments\.amazon|amazonpay\.in|amazonpay\.com/i },
    { name: "Mobikwik", regex: /mobikwik|wallet\.mobikwik|api\.mobikwik|payments\.mobikwik|paywithmobikwik/i },
    { name: "Pine Labs", regex: /pinelabs|plutus|plutus-cloud|pine\.pay|pinepg|plutuscloud|api\.pinelabs/i },
    { name: "Airtel Payments Bank", regex: /airtelpay|airtelbank|airtel\.in\/bank|paymentsbank\.airtel|api\.airtelbank/i },
    { name: "Google Pay (GPay)", regex: /googlepay|gpay|pay\.google\.com|pay\.g\.co|payments\.google|tez\.google/i },
    { name: "Juspay", regex: /juspay|juspay\.io|expresscheckout|api\.juspay|checkout\.juspay/i },
    { name: "Worldline (Ingenico)", regex: /worldline|ingenico|paymentservices\.ingenico|wlpayments|onlinepayment\.worldline/i },
    { name: "HDFC Payment Gateway", regex: /hdfcbank|paymentgateway\.hdfcbank|hdfcpayment|api\.hdfcbank|hdfc\.co\.in/i },
    { name: "ICICI Payment Gateway", regex: /icicibank|icicipayments|paymentgateway\.icicibank|icicibank\.com|api\.icicibank/i },
    { name: "Axis Bank Payment Gateway", regex: /axisbank|paymentgateway\.axisbank|axisbank\.co\.in|api\.axisbank/i },
    { name: "PayPal", regex: /paypal|www\.paypalobjects\.com|paypal\.com|paypal\.in|api\.paypal/i },
    { name: "BharatQR", regex: /bharatqr|npci\.org\.in|qr\.bharat|bharatqr\.upi/i },
    { name: "Flexmoney", regex: /flexmoney|instantemi|checkout\.flexmoney|api\.flexmoney/i },
    { name: "OneCard", regex: /getonecard|onecard|one\.card|api\.onecard|pay\.onecard/i },
    { name: "Square", regex: /squareup|square\.com|squarecdn|api\.square|checkout\.square/i },
    { name: "ZestMoney", regex: /zestmoney|api\.zestmoney|checkout\.zestmoney|paywithzestmoney/i },
    { name: "Instamojo", regex: /instamojo|checkout\.instamojo|api\.instamojo|pay\.instamojo/i },
    { name: "Paykun", regex: /paykun|checkout\.paykun|api\.paykun/i },
    { name: "UPI", regex: /upi|pay\.upi|upi\.pay|vpa=|upi\.me|upi\.org\.in/i },
    { name: "SBI ePay", regex: /sbiepay|sbi\.co\.in\/epay|paymentgateway\.sbi|api\.sbi/i },
    { name: "Atom", regex: /atomtech|atom\.in|paymentgateway\.atom|api\.atomtech/i },
    { name: "Direcpay", regex: /direcpay|api\.direcpay|checkout\.direcpay/i },
    { name: "EBS", regex: /ebs|ebs\.in|ebssecure|paymentgateway\.ebs|api\.ebs/i },
    { name: "PayGlocal", regex: /payglocal|api\.payglocal|checkout\.payglocal/i },
    { name: "FSS", regex: /fssnet|fss\.co\.in|fsspayments|api\.fss/i },
    { name: "Gokwik", regex: /gokwik|gwk\.to|gwk\.in|gokwik\.co|gokwik\.com|analytics\.gokwik|pay\.gokwik|gokwik\.in|gwkcdn|gokwikcdn/i },
    { name: "Avenues", regex: /avenues|avenues\.in|paymentgateway\.avenues|api\.avenues/i }
  ];

  const matched = [];
  page.on('requestfinished', (request) => {
    const url = request.url();
    for (const { name, regex } of patterns) {
      if (regex.test(url)) {
        matched.push(name);
      }
    }
  });

  // Try clicking pay/checkout button
  try {
    const payBtn = await page.$('button:has-text("Pay")')
      || await page.$('button:has-text("Checkout")')
      || await page.$('button:has-text("Place Order")')
      || await page.$('input[type="submit"]');
    if (payBtn) {
      await payBtn.scrollIntoViewIfNeeded();
      await closeCheckoutOverlays(page); // <-- Insert modal handler here!
      await page.waitForTimeout(1000);
      await payBtn.click({ timeout: 10000 });
      await page.waitForTimeout(6000);
    }
  } catch (e) { }

  return [...new Set(matched)][0] || null;
}

// --- Main Exported Simulation Function ---
export async function runCartSimulation(
  url,
  actionList = [
    'add to cart',
    'go to cart',
    'proceed',
    'checkout',
    'address',
    'review order',
    'continue',
    'pay',
    'place order'
  ],
  runContext = {}
) {
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

      let networkLogs = [];
      page.on('request', req => { networkLogs.push(req.url()); });

      await page.goto(url, { timeout: config.timeout, waitUntil: 'domcontentloaded' });
      await handleAllPopups(page, log, step);

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

      for (const action of actionList) {
        step += 1;
        await handleAllPopups(page, log, step);
        await fillAddressIfVisible(page, log, step);
        await handleAllPopups(page, log, step);

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

        // --- Extract Interactive Elements ---
        let elementsArr = await page.evaluate(() => {
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
            selector: cssPath(el),
          }));
        });

        // --- Extract Elements from Modals/Drawers ---
        let modalElementsArr = await page.evaluate(() => {
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
          const modalSel = '.modal, .drawer, .cart-modal, .mini-cart, .side-panel, [role="dialog"]';
          return Array.from(document.querySelectorAll(`${modalSel} button, ${modalSel} a, ${modalSel} input[type=submit]`))
            .filter(el => {
              const style = window.getComputedStyle(el);
              return style && style.visibility !== 'hidden' && style.display !== 'none' && el.offsetHeight > 0 && el.offsetWidth > 0;
            })
            .map(el => ({
              tagName: el.tagName,
              innerText: el.innerText,
              ariaLabel: el.getAttribute('aria-label'),
              id: el.id,
              class: el.className,
              selector: cssPath(el),
            }));
        });
        elementsArr = elementsArr.concat(modalElementsArr);

        // --- LLM Selector Suggestion ---
        let selectors = [];
        let llmRes = await suggestSelectorsWithGemini(elementsArr, action);
        if (Array.isArray(llmRes) && llmRes.length) {
          selectors = llmRes;
          log.push({ action, selectors, via: 'gemini' });
        } else {
          selectors = findLikelyButtons(elementsArr, action);
          if (selectors.length) log.push({ action, selectors, via: 'heuristics' });
        }
        if (!selectors.length) {
          const texts = [
            "checkout", "buy now", "place order", "pay", "go to checkout", "continue to checkout", "proceed", "proceed to pay",
            "order now", "pay now", "continue to payment", "payment", "review order"
          ];
          selectors = elementsArr.filter(el =>
            texts.some(txt => (el.innerText || '').toLowerCase().includes(txt))
          ).map(el => el.selector);
          if (selectors.length) log.push({ action, selectors, via: 'checkout-text-fallback' });
        }

        // --- Fallback to Vision LLM if Needed ---
        if (!selectors.length && typeof suggestNextActionWithVisionLLM === 'function') {
          const screenshotPath = `${evidenceDir}/step_${step}_vision.png`;
          await page.screenshot({ path: screenshotPath, fullPage: true });
          const html = await page.content();
          const visionResp = await suggestNextActionWithVisionLLM(screenshotPath, html, action);
          if (visionResp && visionResp.selector) {
            selectors = [visionResp.selector];
            log.push({ action, selectors, via: 'vision-fallback', visionResp });
          }
        }

        // --- Try to Click Selectors ---
        let actionSuccess = false;
        for (const sel of selectors) {
          try {
            await waitForStable(sel, page, 3, 6000);
            await handleAllPopups(page, log, step);
            await closeCheckoutOverlays(page); // <-- NEW: Try closing overlays before every major click
            await page.click(sel, { delay: 50 });
            actionSuccess = true;
            break;
          } catch (err) {
            log.push({ action, sel, error: err.message });
            await handleAllPopups(page, log, step);
            await closeCheckoutOverlays(page); // <-- NEW: Try again
            try {
              await waitForStable(sel, page, 2, 2000);
              await page.click(sel, { delay: 50 });
              actionSuccess = true;
              break;
            } catch (err2) {
              log.push({ action, sel, secondTry: err2.message });
            }
          }
        }
        await saveEvidence({ page, step, evidenceDir, meta: { action, selectors, note: actionSuccess ? 'Success' : 'No selectors worked' } });
        if (!actionSuccess) {
          log.push({ action, error: 'No selectors worked' });
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

      await handleAllPopups(page, log, step);
      await fillAddressIfVisible(page, log, step);

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

      // --- Evidence, Gateway Detection ---
      const scripts = await page.evaluate(() => Array.from(document.scripts).map(s => s.src));
      const iframes = await page.evaluate(() => Array.from(document.querySelectorAll('iframe')).map(f => f.src));
      const html = await page.content();
      const $ = cheerio.load(html);
      let visibleTextArr = [];
      $('body *').each((i, el) => {
        const text = $(el).text().trim();
        if (text && text.length > 8 && /payment|powered by|pay now|secure/i.test(text)) {
          visibleTextArr.push(text);
        }
      });

      const paymentGateways = detectPaymentGateways({
        scripts,
        iframes,
        html,
        networkRequests: networkLogs,
        visibleText: visibleTextArr
      });

      // --- LIVE PG DETECTION ---
      const livePaymentGateway = await detectLivePaymentGateway(page);

      await saveEvidence({ page, step, evidenceDir, meta: { scripts, iframes, log, paymentGateways, livePaymentGateway } });

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
        networkLogs,
        paymentGateways,
        livePaymentGateway,
        runContext
      };
      await sendWebhook(resultPayload);
      await browser.close();
      return { success: true, evidenceDir, scripts, iframes, networkLogs, log, paymentGateways, livePaymentGateway };
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

// --- CLI usage ---
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: node index.js <url>");
    process.exit(1);
  }
  runCartSimulation(url).then(result => {
    console.log(JSON.stringify(result, null, 2));
  });
}
