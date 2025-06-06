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
You're a web automation agent. Given this array of visible overlays/modals/popups, suggest which CSS selectors should be clicked to close or dismiss them. 
Prioritize close, dismiss, skip, or "not now" buttons, X icons, and similar. 

Respond ONLY with a JSON array of CSS selectors to click (e.g. ["#closeBtn", ".close-x", ".dismiss-popup"]).

Here are the elements:
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

    // Parse the first JSON array, even if surrounded by extra text
    let arr = null;
    try {
      arr = JSON.parse(json);
    } catch {
      // Try greedy regex fallback
      const match = json.match(/\[[\s\S]*\]/);
      if (match) {
        try { arr = JSON.parse(match[0]); } catch {}
      }
    }
    if (Array.isArray(arr)) return arr;

    throw new Error('Gemini popup handler returned invalid format: ' + response);
  } catch (err) {
    console.error('Gemini popup close returned unexpected format:', err.message);
    return [];
  }
}
