import dotenv from 'dotenv';
dotenv.config();

import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from '../config.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * @param {Array} popupsArr - Array of visible modal/overlay elements with selector, text, etc.
 * @returns {Promise<Array>} - Array of selectors to click for closing overlays.
 */
export async function suggestPopupCloseWithGemini(popupsArr) {
  if (!popupsArr.length) return [];
  const prompt = `
You are a web automation agent. Given this array of visible overlays/modals/popups, first check if they belong to a platform checkout system.
Then suggest which CSS selectors should be clicked to close or dismiss them.

Platform-specific patterns to check:
1. Gokwik: .gwk-modal, .gwk-popup, [data-gokwik-modal]
2. Razorpay: .razorpay-modal, .razorpay-popup, .razorpay-overlay
3. PayU: .payu-modal, #PayUModal, [data-payu-overlay]
4. Cashfree: .cashfree-modal, .cashfree-popup
5. PhonePe: .phonepe-modal, [data-phonepe-overlay]

Return ONLY a JSON object like:
{
  "platformPopup": {
    "detected": false,          // or true if platform modal detected
    "platform": null,          // platform name if detected
    "confidence": 0           // 0-1 confidence score
  },
  "closeActions": [
    {
      "selector": ".close-btn",
      "type": "click" | "remove",  // action to take
      "priority": 1,              // 1 is highest
      "context": "main" | "platform" | "modal"  // where to look
    }
  ]
}

Prioritize close, dismiss, skip buttons and X icons.
For platform modals, use platform-specific close patterns.

Here are the overlays:
${JSON.stringify(popupsArr, null, 2)}
`;

  try {
    const model = genAI.getGenerativeModel({ model: config.geminiModel });
    const result = await model.generateContent(prompt);
    const response = await result.response.text();

    // Remove code fences if present
    let json = response.trim();
    if (json.startsWith("```")) {
      json = json.replace(/```(json)?/g, '').trim();
    }

    // Parse response or extract first JSON object
    let obj = null;
    try {
      obj = JSON.parse(json);
    } catch {
      const match = json.match(/{[\s\S]*}/);
      if (match) {
        try { obj = JSON.parse(match[0]); } catch {}
      }
    }

    // Return selectors in priority order
    if (obj && Array.isArray(obj.closeActions)) {
      return obj.closeActions
        .sort((a, b) => (a.priority || 99) - (b.priority || 99))
        .map(action => action.selector);
    }
    throw new Error('Gemini popup handler returned invalid format: ' + response);
  } catch (err) {
    console.error('Gemini popup close returned unexpected format:', err.message);
    return [];
  }
}
