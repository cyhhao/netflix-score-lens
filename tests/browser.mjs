import {chromium} from 'playwright';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

// Install with `npx playwright install chromium` (CI: --with-deps).
// Never point this at a personal browser profile; every test creates its own.
export const executablePath = process.env.CHROME_PATH || process.env.CFT_PATH || chromium.executablePath();
await mkdir(fileURLToPath(new URL('../artifacts/', import.meta.url)), {recursive:true});
