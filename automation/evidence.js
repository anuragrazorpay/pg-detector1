import fs from 'fs-extra';
import path from 'path';

export async function saveEvidence({ page, step, evidenceDir, meta }) {
  await fs.ensureDir(evidenceDir);
  const screenshotPath = path.join(evidenceDir, `step_${step}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const domPath = path.join(evidenceDir, `step_${step}_dom.html`);
  const html = await page.content();
  await fs.writeFile(domPath, html);
  const metaPath = path.join(evidenceDir, `step_${step}_meta.json`);
  await fs.writeJson(metaPath, meta);
}
