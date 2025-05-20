import dotenv from 'dotenv';
dotenv.config();

import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from '../config.js';

const model = genAI.getGenerativeModel({ model: config.geminiModel });

/**
 * elementsArr: [{tagName, innerText, ariaLabel, id, class, selector}]
 * action: 'add to cart' | 'checkout' | 'pay'
 */
export async function suggestSelectorsWithGemini(elementsArr, action) {
  const safeElements = elementsArr.slice(0, config.maxElements);
  const prompt = `
You are an expert web automation assistant. Given a list of interactive elements from an e-commerce website, suggest the 3 most likely CSS selectors to perform the action: "${action}". Return a JSON array of CSS selectors. Only choose elements that are visible, clickable, and relevant.

Here are the elements:
${JSON.stringify(safeElements, null, 2)}

Respond with only a JSON array, e.g. ["#buyButton", ".checkout-btn", ...]
`;

  const model = genAI.getGenerativeModel({ model: config.geminiModel });
  const result = await model.generateContent(prompt);
  const response = await result.response.text();
  // Extract the array even if wrapped in code block
  let json = response.trim();
  if (json.startsWith("```")) {
    json = json.replace(/```(json)?/g, '').trim();
  }
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr)) return arr;
    throw new Error('Not an array');
  } catch {
    console.error('Gemini returned unexpected format:', response);
    return [];
  }
}
