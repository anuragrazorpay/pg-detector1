import { runCartSimulation } from './automation/playwrightRunner.js';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node index.js <site_url>');
  process.exit(1);
}

(async () => {
  const result = await runCartSimulation(url);
  console.log(JSON.stringify(result, null, 2));
})();
