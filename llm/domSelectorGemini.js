import dotenv from 'dotenv';
dotenv.config();

import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from '../config.js';
import { suggestNextActionWithVisionLLM } from './visionNavigator.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
    const response = await result.response.text();
    // Extract the array even if wrapped in code block
    let json = response.trim();
    if (json.startsWith("```")) {
      json = json.replace(/```(json)?/g, '').trim();
    }
    const arr = JSON.parse(json);
    if (Array.isArray(arr) && arr.length) return arr;
  } catch (err) {
    console.error('Gemini selector suggestion failed:', err.message);
  }

  // If no confident selectors found, try Vision LLM fallback (only if page supplied)
  if (page) {
    try {
      const screenshotPath = `/tmp/vision_fallback_${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const html = await page.content();
      const visionResp = await suggestNextActionWithVisionLLM(screenshotPath, html, action);
      // Vision API returns: { selector, buttonText, htmlHint, description }
      if (visionResp && visionResp.selector) {
        return [visionResp.selector];
      }
    } catch (err) {
      console.error('Vision LLM fallback failed:', err.message);
    }
  }
  return [];
}
