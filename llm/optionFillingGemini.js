import dotenv from 'dotenv';
dotenv.config();

import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from '../config.js';

const model = genAI.getGenerativeModel({ model: config.geminiModel });

/**
 * @param {Array} optionsArr - Array of {tagName, type, innerText, ariaLabel, id, class, selector}
 * @returns {Promise<Array>} - Array of {selector, value (optional), type (optional)}
 */
export async function suggestOptionFillWithGemini(optionsArr) {
  const safeOptions = optionsArr.slice(0, config.maxElements);
  const prompt = `
You're an expert e-commerce web automation agent. The "add to cart" button is disabled, likely because required product options must be selected. Given this array of interactive product option elements, suggest which selectors to interact with and what values to select/enter so that a product can be added to the cart. If the element is a dropdown, pick the first non-placeholder value. If it's a color/size swatch, pick the first available option. If it's a text field, enter "test" or a suitable default.

Return only a JSON array like:
[
  { "selector": "#color", "type": "select-one", "value": "Blue" },
  { "selector": "#size", "type": "select-one", "value": "M" },
  { "selector": ".swatch-red", "type": "button" },
  { "selector": "#engraving", "type": "text", "value": "test" }
]

Here are the elements:
${JSON.stringify(safeOptions, null, 2)}
`;

  const model = genAI.getGenerativeModel({ model: config.geminiModel });
  const result = await model.generateContent(prompt);
  const response = await result.response.text();
  let json = response.trim();
  if (json.startsWith("```")) {
    json = json.replace(/```(json)?/g, '').trim();
  }
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr)) return arr;
    throw new Error('Not an array');
  } catch {
    console.error('Gemini option fill returned unexpected format:', response);
    return [];
  }
}
