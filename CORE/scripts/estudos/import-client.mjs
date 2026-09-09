#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_DIR = path.resolve(__dirname, "..");

function parseArgs(args) {
  const params = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        params[key] = next;
        i++;
      } else {
        params[key] = "true";
      }
    }
  }
  return params;
}

function extractColors(html) {
  const hexPattern = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
  const matches = html.match(hexPattern) || [];
  const colorCounts = new Map();
  for (const c of matches) {
    const norm = c.toLowerCase();
    if (["#fff", "#ffffff", "#000", "#000000", "#nan", "#nannannan"].includes(norm)) continue;
    colorCounts.set(norm, (colorCounts.get(norm) || 0) + 1);
  }
  return [...colorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([col]) => col);
}

function extractFonts(html) {
  const fontMatches = html.match(/family=([^&"'>\s]+)/g) || [];
  const fonts = new Set(["Inter", "Arial", "sans-serif"]);
  for (const f of fontMatches) {
    const raw = f.replace("family=", "").split(":")[0].replace(/\+/g, " ");
    fonts.add(raw);
  }
  return [...fonts];
}

function extractTitleAndDesc(html) {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
                    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
  return {
    title: titleMatch ? titleMatch[1].trim() : "Cliente",
    description: descMatch ? descMatch[1].trim() : ""
  };
}

function extractSvgLogo(html) {
  const svgMatch = html.match(/<svg[^>]*>([\s\S]*?)<\/svg>/i);
  if (svgMatch) {
    return svgMatch[0];
  }
  return null;
}

async function fetchUrl(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  });
  if (!response.ok) {
    throw new Error(`Falha ao carregar URL: ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

async function main() {
  const params = parseArgs(process.argv.slice(2));
  const targetUrl = params.url;
  const localFile = params.file || params.html;
  const clientId = (params.id || params.name || "novo-cliente").toLowerCase().replace(/[^a-z0-9-_]/g, "-");
  const outDir = path.resolve(params.out || path.join(CORE_DIR, "clientes", clientId));

  if (!targetUrl && !localFile) {
    console.error("Uso: node scripts/import-client.mjs --url <URL> [--id <nome>] [--out <pasta>]");
    process.exitCode = 1;
    return;
  }

  let htmlContent = "";
  let sourceOrigin = "";

  if (targetUrl) {
    sourceOrigin = targetUrl;
    htmlContent = await fetchUrl(targetUrl);
  } else {
    sourceOrigin = path.resolve(localFile);
    htmlContent = await readFile(sourceOrigin, "utf8");
  }

  await mkdir(outDir, { recursive: true });

  const { title, description } = extractTitleAndDesc(htmlContent);
  const colors = extractColors(htmlContent);
  const fonts = extractFonts(htmlContent);
  const svgLogo = extractSvgLogo(htmlContent);

  // 1. Salva logo.svg se encontrado
  let logoHash = "0".repeat(64);
  let logoRelPath = `clientes/${clientId}/logo.svg`;
  if (svgLogo) {
    const logoFilePath = path.join(outDir, "logo.svg");
    await writeFile(logoFilePath, svgLogo, "utf8");
    logoHash = createHash("sha256").update(Buffer.from(svgLogo, "utf8")).digest("hex");
  }

  // 2. BrandKit estruturado
  const brandKit = {
    schema: "mkt-videos/brand-kit@1",
    id: clientId,
    version: 1,
    palette: colors.length > 0 ? colors : ["#0F4C75", "#114364", "#50a6a7", "#cda31b"],
    typography: {
      primary: fonts[0] || "Montserrat",
      secondary: fonts[1] || "Manrope",
      fallback: ["Arial", "sans-serif"]
    },
    logos: [
      {
        id: "official-logo",
        path: logoRelPath,
        hash: logoHash,
        fidelity: "exact",
        requiredForRoles: ["identity", "brand-watermark"]
      }
    ],
    requiredTerms: [title.split(" - ")[0].split(" | ")[0].trim()],
    forbiddenTerms: [],
    maxOnScreenWords: 10,
    safeAreas: {
      "16:9": { left: 0.08, right: 0.08, top: 0.08, bottom: 0.08 },
      "9:16": { left: 0.08, right: 0.08, top: 0.12, bottom: 0.15 }
    },
    captionStyle: "kinetic-word@1",
    motion: {
      logoTransform: false,
      primaryEasing: "cubic-bezier(0.16, 1, 0.3, 1)"
    }
  };

  const brandNormalized = JSON.stringify(brandKit);
  const brandKitHash = createHash("sha256").update(brandNormalized).digest("hex");
  brandKit.hash = brandKitHash;

  await writeFile(path.join(outDir, "brand-kit.json"), JSON.stringify(brandKit, null, 2), "utf8");

  // 3. Perfil do Cliente
  const clientProfile = {
    id: clientId,
    name: title.split(" - ")[0].split(" | ")[0].trim(),
    title,
    description,
    sourceOrigin,
    importedAt: new Date().toISOString(),
    palette: brandKit.palette,
    typography: brandKit.typography,
    brandKitHash,
    logoHash
  };

  await writeFile(path.join(outDir, "perfil-cliente.json"), JSON.stringify(clientProfile, null, 2), "utf8");

  const outputSummary = {
    status: "success",
    clientId,
    title: clientProfile.name,
    outDir,
    brandKitHash,
    logoFound: Boolean(svgLogo),
    colorsCount: colors.length,
    fontsFound: fonts
  };

  console.log(JSON.stringify(outputSummary, null, 2));
}

main().catch((err) => {
  console.error("Erro na importação do cliente:", err.message);
  process.exitCode = 1;
});
