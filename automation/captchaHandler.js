import fs from 'fs';

export async function detectAndHandleCaptcha(page, runId = '') {
  const captcha = await page.evaluate(() => {
    if (document.querySelector('iframe[src*="recaptcha"]') || document.querySelector('.g-recaptcha')) {
      return 'recaptcha';
    }
    if (document.querySelector('iframe[src*="hcaptcha"]') || document.querySelector('.h-captcha')) {
      return 'hcaptcha';
    }
    if (document.body.innerText.toLowerCase().includes('checking your browser') ||
        document.body.innerText.toLowerCase().includes('cloudflare')) {
      return 'cloudflare';
    }
    if (document.body.innerText.toLowerCase().includes('unusual traffic detected') ||
        document.body.innerText.toLowerCase().includes('verify you are human')) {
      return 'botwall';
    }
    return null;
  });

  if (!captcha) return { type: null, solved: false };

  try {
    await page.screenshot({ path: `./evidence/${runId}_captcha.png` });
  } catch (err) {}

  if (captcha === 'recaptcha') {
    return { type: 'recaptcha', solved: false, needsHuman: true, message: 'Detected Google reCAPTCHA, needs human or audio solve integration.' };
  }

  return { type: captcha, solved: false, needsHuman: true, message: `Blocked by ${captcha}, needs human/unblock.` };
}
