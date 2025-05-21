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
You are an expert web automation assistant. Given a list of interactive elements from an e-commerce website, suggest the 3 most likely CSS selectors to perform the action: "${action}". Return a JSON array of CSS selectors. Only choose elements that are visible, clickable, and relevant.

Here are the elements:
${JSON.stringify(safeElements, null, 2)}

Respond with only a JSON array, e.g. ["#buyButton", ".checkout-btn", ...]
`;

  try {
    const model = genAI.getGenerativeModel({ model: config.geminiModel });
    const result = await model.generateContent(prompt);

    // Try both .text() (your code) and deeper candidate path (new Gemini)
    let response = '';
    try {
      response = await result?.response?.text?.();
    } catch (e) {}
    if (!response) {
      // fallback to Gemini's candidate structure (may be present)
      response = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text
        || result?.response?.candidates?.[0]?.content?.parts?.[0]
        || '';
    }
    const selectors = extractSelectorArray(response);
    if (selectors.length) return selectors;
  } catch (err) {
    console.error('Gemini selector suggestion failed:', err.message);
  }

  // If no selectors found, try Vision LLM fallback (only if page supplied)
  if (page) {
    try {
      const screenshotPath = `/tmp/vision_fallback_${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const html = await page.content();
      const visionResp = await suggestNextActionWithVisionLLM(screenshotPath, html, action);
      if (visionResp && visionResp.selector) {
        return [visionResp.selector];
      }
    } catch (err) {
      console.error('Vision LLM fallback failed:', err.message);
    }
  }
  return [];
}
