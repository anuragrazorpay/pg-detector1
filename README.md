# pg-detector

Universal payment gateway detection using Playwright + GPT-4o for cart simulation.

## Setup

- Clone this repo
- `npm install`
- Set your OpenAI API key in `.env`:  
- Output:  
- All evidence in `/evidence/<runid>/`
- JSON result on stdout with log, selectors, scripts, iframes, and errors (if any)

## Extending

- Add proxy logic in `playwrightRunner.js` for bot protection
- Add structured PG detection (parse `scripts`, `iframes`) at end
- Plug in other LLMs (Gemini, Azure) in `llm/domSelectorGPT.js`
