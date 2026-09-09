import { chromium } from 'playwright-core';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';

const [input, output, widthArg = '1200', heightArg = '500', ...extra] = process.argv.slice(2);
if (!input || !output || extra.length) throw new Error('Uso: node scripts/estudos/render-logo-png.mjs entrada.svg saida.png [largura] [altura]');
const width = Number(widthArg), height = Number(heightArg);
if (![width,height].every(n => Number.isInteger(n) && n > 0 && n <= 8192)) throw new Error('Dimensões devem ser inteiros entre 1 e 8192.');
const destination = path.resolve(output);
try { await lstat(destination); throw new Error('O destino já existe. Escolha um arquivo novo.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const svg = await readFile(path.resolve(input));
if (svg.length > 10 * 1024 * 1024) throw new Error('SVG excede 10 MiB.');
const browser = await chromium.launch({headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {channel:'chrome'})});
try {
 const context = await browser.newContext({viewport:{width,height}, serviceWorkers:'block'});
 await context.route('**/*', route => route.abort());
 const page = await context.newPage();
 await page.setContent('<!doctype html><body style="margin:0;background:transparent"><img style="display:block;width:100vw;height:100vh;object-fit:contain"></body>');
 // SVG is an image resource, never executable inline markup. Embedded scripts
 // and external resources are disabled by the browser image context.
 await page.locator('img').evaluate(async (img, source) => {img.src=source; await img.decode();}, `data:image/svg+xml;base64,${svg.toString('base64')}`);
 const png = await page.screenshot({omitBackground:true});
 await writeFile(destination, png, {flag:'wx'});
 console.log('PNG criado: ' + destination);
} finally { await browser.close(); }
