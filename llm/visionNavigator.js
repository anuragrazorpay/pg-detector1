import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import { config } from "../config.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Given a screenshot and HTML after a failed attempt, returns the next best action (button selector etc).
 * @param {string} screenshotPath - Absolute path to PNG screenshot
 * @param {string} html - Current DOM as HTML string
 * @param {string} action - e.g. "checkout", "add to cart"
 * @returns {Promise<{selector: string, buttonText?: string, reasoning?: string}>}
 */
export async function suggestNextActionWithVisionLLM(screenshotPath, html, action) {
  const fileData = fs.readFileSync(screenshotPath);
  const image = {
    inlineData: {
      data: fileData.toString("base64"),
      mimeType: "image/png",
    }
  };
  const prompt = `
You are an expert web automation agent. Given a screenshot and the HTML after clicking "${action}", suggest the exact next button or link to click to proceed toward payment (e.g., checkout or cart). If there's a modal, popup, or overlay, specify what to click. If not, describe what step to take next (e.g., click the cart icon, checkout button, scroll, etc). Provide the **button/link text** and a reliable CSS selector (or unique HTML snippet).

ALWAYS respond with this JSON object:
{ "selector": "...", "buttonText": "...", "reasoning": "..." }

If there are multiple candidates, pick the one most likely to advance toward checkout/payment.
`;

  const model = genAI.getGenerativeModel({ model: config.geminiModel });
  const result = await model.generateContent([
    { text: prompt },
    image,
    { text: "HTML: " + html.slice(0, 12000) } // Trim very large HTMLs
  ]);
  let response = await result.response.text();
  if (response.startsWith("```")) response = response.replace(/```(json)?/g, "").trim();
  try {
    const obj = JSON.parse(response);
    if (obj && obj.selector) return obj;
    throw new Error("Missing selector from Gemini Vision");
  } catch (e) {
    console.error("Vision LLM format issue:", response);
    return { selector: "", buttonText: "", reasoning: response };
  }
}
