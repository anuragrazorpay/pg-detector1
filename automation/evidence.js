// automation/evidence.js
import fs from 'fs-extra'; // safer than 'fs' for async mkdirp etc.

export async function saveEvidence({ page, step, evidenceDir, meta = {} }) {
  try {
    // Ensure evidenceDir exists
    await fs.ensureDir(evidenceDir);

    // Save screenshot
    const screenshotPath = `${evidenceDir}/step_${step}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // Save HTML
    const htmlPath = `${evidenceDir}/step_${step}.html`;
    const html = await page.content();
    await fs.writeFile(htmlPath, html);

    // Save meta log (append if exists)
    const metaPath = `${evidenceDir}/log.jsonl`;
    const logLine = JSON.stringify({ step, ...meta, time: new Date().toISOString() }) + '\n';
    await fs.appendFile(metaPath, logLine);
  } catch (err) {
    // On evidence error, write to a global error log, do not crash main flow
    const errPath = './evidence/evidence_errors.log';
    fs.appendFileSync(errPath, `[${new Date().toISOString()}] evidence save error: ${err.message} [dir: ${evidenceDir}]\n`);
  }
}
