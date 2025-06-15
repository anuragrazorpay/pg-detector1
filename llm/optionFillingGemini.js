import dotenv from 'dotenv';
dotenv.config();

import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from '../config.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * @param {Array} optionsArr - Array of {tagName, type, innerText, ariaLabel, id, class, selector}
 * @returns {Promise<Array>} - Array of {selector, value (optional), type (optional)}
 */
export async function suggestOptionFillWithGemini(optionsArr) {
  const safeOptions = optionsArr.slice(0, config.maxElements || 30);
  const prompt = `
You're an expert e-commerce web automation agent. First check if this is a platform checkout (e.g., Gokwik, Razorpay).
Then suggest how to handle required product options or form fields.

Platform-specific patterns:
1. Gokwik: [data-gwk-field], .gwk-input, .gwk-select
2. Razorpay: [data-razorpay-field], .razorpay-input
3. PayU: [data-payu-field], .payu-input
4. Cashfree: .cashfree-input, [data-cfpayment]

Return a JSON object like:
{
  "platformForm": {
    "detected": false,          // or true if platform form detected
    "platform": null,          // platform name if detected
    "confidence": 0           // 0-1 confidence score
  },
  "fields": [
    {
      "selector": "#color",
      "type": "select-one" | "text" | "button" | "radio",
      "value": "Blue",         // for inputs/selects
      "priority": 1,          // 1 is highest
      "required": true        // if field seems required
    }
  ]
}

For dropdowns, pick first non-placeholder value.
For color/size swatches, pick first available option.
For text fields, enter appropriate test data.

Here are the elements:
${JSON.stringify(safeOptions, null, 2)}
`;

  try {
    const model = genAI.getGenerativeModel({ model: config.geminiModel });
    const result = await model.generateContent(prompt);
    const response = await result.response.text();

    // Remove code block fencing if present
    let json = response.trim();
    if (json.startsWith("```")) {
      json = json.replace(/```(json)?/g, '').trim();
    }

    // Try to parse JSON object
    let obj = null;
    try {
      obj = JSON.parse(json);
    } catch {
      // Fallback: extract first {...} with regex
      const match = json.match(/{[\s\S]*}/);
      if (match) {
        try { obj = JSON.parse(match[0]); } catch {}
      }
    }

    // Return fields in priority order
    if (obj && Array.isArray(obj.fields)) {
      return obj.fields
        .sort((a, b) => (a.priority || 99) - (b.priority || 99))
        .map(field => ({
          selector: field.selector,
          type: field.type,
          value: field.value
        }));
    }

    throw new Error('Gemini returned invalid format: ' + response);
  } catch (err) {
    console.error('Gemini option fill returned unexpected format:', err.message);
    return [];
  }
}
