import dotenv from 'dotenv';
dotenv.config();

import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from '../config.js';
import { suggestNextActionWithVisionLLM } from './visionNavigator.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Clean and extract the first valid JSON array from Gemini output.
 * Handles code block, markdown, junk text, and malformed JSON.
 */
function extractSelectorArray(response) {
  if (!response) return [];
  let text = typeof response === 'string' ? response : '';
  // For Gemini: response might be an object!
  if (typeof response === 'object' && response?.candidates) {
    // Try OpenAI-like structure
    text =
      response?.candidates?.[0]?.content?.parts?.[0]?.text ||
      response?.candidates?.[0]?.content?.parts?.[0] ||
      '';
  }
  if (!text) return [];
  text = text.trim();

  // Remove code block markers and language hints
  text = text.replace(/```(json)?/gi, '').replace(/```/g, '').trim();

  // Attempt to extract the first array
  const arrMatch = text.match(/\[[\s\S]*\]/m);
  let arrString = arrMatch ? arrMatch[0] : text;

  // Try fixing single quotes (rare)
  arrString = arrString.replace(/'/g, '"');

  try {
    const arr = JSON.parse(arrString);
    if (Array.isArray(arr) && arr.every(x => typeof x === 'string')) return arr;
  } catch (e) {
    // fallback: return empty
  }
  return [];
}

/**
 * elementsArr: [{tagName, innerText, ariaLabel, id, class, selector}]
 * action: 'add to cart' | 'checkout' | 'pay'
 * page: Playwright Page instance (only for Vision fallback)
 */
export async function suggestSelectorsWithGemini(elementsArr, action, page = null) {
  const safeElements = elementsArr.slice(0, config.maxElements || 30);
  const prompt = `
You are an expert web automation agent analyzing an e-commerce website. Given these interactive elements, identify if this is a platform-powered checkout or a custom checkout flow, then suggest the most relevant selectors for the action: "${action}".

First, check for platform indicators like:
1. Gokwik: .gokwik-checkout, [data-gokwik], #gokwik-frame
2. Razorpay Checkout: #razorpay-checkout-frame, [data-razorpay]
3. PayU Checkout: #payu-checkout-frame, [data-payu]
4. Cashfree: #cashfree-frame, .cashfree-payment-frame
5. PhonePe: #phonepe-checkout-frame, [data-phonepe]
6. CCAvenue: #ccav-frame, #iframe_payment_frame

Return a JSON object with platform detection and selector suggestions:
{
  "platformIndicators": {
    "detected": false,  // or true if platform checkout detected
    "platform": null,   // platform name if detected (e.g., "Gokwik Checkout")
    "confidence": 0,    // 0-1 confidence score
    "evidence": []      // list of elements that suggest platform
  },
  "selectors": [       // Relevant element selectors for the action
    "#buyButton",      // Most specific selectors first
    ".checkout-btn"    // More general selectors as fallback
  ],
  "context": "main" | "modal" | "platform-iframe"  // Where selectors should be used
}

Here are the elements:
${JSON.stringify(safeElements, null, 2)}
`;

  try {
    const model = genAI.getGenerativeModel({ model: config.geminiModel });
    const result = await model.generateContent(prompt);

    // Try both .text() (old) and deeper candidate path (new Gemini)
    let response = '';
    try {
      response = await result?.response?.text?.();
    } catch (e) {}
    if (!response) {
      response = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text
        || result?.response?.candidates?.[0]?.content?.parts?.[0]
        || '';
    }
    
    // Extract JSON response
    let json = response.trim();
    if (json.startsWith('```')) {
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
    
    // Validate and return result
    if (obj && Array.isArray(obj.selectors)) {
      return obj;
    }
    throw new Error('Invalid format returned by Gemini');
  } catch (err) {
    console.error('Gemini selector suggestion failed:', err.message);
    return { platformIndicators: { detected: false }, selectors: [] };
  }
}
