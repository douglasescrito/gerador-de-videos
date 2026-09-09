import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createArtifactFromFile } from "./artifact.mjs";
import { clockValue, normalizeEndpoint, requireFetch, requireText, responseJson } from "./http.mjs";
import { receiptPathForArtifact, writeReceipt } from "./receipt.mjs";
import { createStageReceipt } from "./pipeline-operation.mjs";
import { consumeExecutionEffectAuthorization } from "./execution-journal.mjs";

export const GEMINI_IMAGE_ASPECT_RATIOS = new Set(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]);
export const GEMINI_IMAGE_SIZES = new Set(["0.5K", "1K", "2K", "4K"]);
export const GEMINI_IMAGE_MODELS = new Set(["gemini-3.1-flash-image", "gemini-3.1-flash-lite-image", "gemini-3-pro-image", "gemini-2.5-flash-image"]);

function detectedImageMimeType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  return null;
}

function decodeBase64(value) {
  const normalized = String(value).replace(/\s+/g, "");
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error("Gemini Image retornou base64 inválido.");
  }
  return Buffer.from(normalized, "base64");
}

async function encodeImages(files) {
  return Promise.all(files.map(async (value) => {
    const file = path.resolve(String(value));
    const data = await readFile(file);
    const detectedMimeType = detectedImageMimeType(data);
    if (!detectedMimeType) throw new Error(`Referência não é PNG ou JPEG reconhecido: ${file}`);
    const artifact = await createArtifactFromFile({ file, kind: "image", role: "reference", mimeType: detectedMimeType });
    return {
      request: { data: data.toString("base64"), mimeType: detectedMimeType },
      artifact,
    };
  }));
}

function decodeDataUrl(value) {
  const match = String(value).match(/^data:([^;,]+);base64,([\s\S]+)$/);
  return match ? { declaredMimeType: match[1], buffer: decodeBase64(match[2]) } : null;
}

function targetForMimeType(outputFile, mimeType) {
  const extension = mimeType === "image/jpeg" ? ".jpg" : ".png";
  return path.join(path.dirname(outputFile), `${path.basename(outputFile, path.extname(outputFile))}${extension}`);
}

function destinationKey(file) {
  const normalized = path.normalize(path.resolve(file));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function destinationPlan(outputFile, receiptFile) {
  const images = [targetForMimeType(outputFile, "image/png"), targetForMimeType(outputFile, "image/jpeg")];
  const receipts = receiptFile == null
    ? images.map((file) => receiptPathForArtifact(file))
    : [path.resolve(requireText(receiptFile, "receiptFile"))];
  const destinations = [
    ...images.map((file) => ({ file, label: "Arquivo de imagem" })),
    ...receipts.map((file) => ({ file, label: "Recibo de imagem" })),
  ];
  const seen = new Map();
  for (const destination of destinations) {
    const key = destinationKey(destination.file);
    const previous = seen.get(key);
    if (previous) throw new Error(`Destinos de imagem colidem: ${previous.file} e ${destination.file}.`);
    seen.set(key, destination);
  }
  return {
    destinations,
    receiptFor: (imageFile) => receiptFile == null ? receiptPathForArtifact(imageFile) : receipts[0],
  };
}

async function assertDestinationsAbsent(destinations) {
  for (const { file, label } of destinations) {
    try {
      await lstat(file);
      throw new Error(`${label} já existe e não será sobrescrito: ${file}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function releaseDestinationLocks(locks) {
  for (const lock of [...locks].reverse()) {
    await lock.handle.close().catch(() => {});
    await rm(lock.file, { force: true });
  }
}

async function acquireDestinationLocks(destinations) {
  const locks = [];
  try {
    const files = [...new Set(destinations.map(({ file }) => path.resolve(file)))].sort();
    for (const file of files) {
      await mkdir(path.dirname(file), { recursive: true });
      const lockFile = path.join(path.dirname(file), `.${path.basename(file)}.gemini-image.lock`);
      try {
        const handle = await open(lockFile, "wx");
        locks.push({ file: lockFile, handle });
      } catch (error) {
        if (error?.code === "EEXIST") throw new Error(`Destino em uso por outra geração de imagem: ${file}`);
        throw error;
      }
    }
    return locks;
  } catch (error) {
    await releaseDestinationLocks(locks);
    throw error;
  }
}

function temporaryPath(target, kind) {
  return path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${randomUUID()}.${kind}.tmp`);
}

async function publishExclusive(temporary, target, label) {
  try {
    await link(temporary, target);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`${label} já existe e não será sobrescrito: ${target}`);
    throw error;
  }
}

export function createGeminiImageEndpointAdapter({
  endpoint = "http://127.0.0.1:3000",
  fetchImpl = globalThis.fetch,
  clock = () => new Date(),
  route = "/api/generate-image",
} = {}) {
  const baseUrl = normalizeEndpoint(endpoint);
  const request = requireFetch(fetchImpl);

  return {
    id: "gemini-image-endpoint",
    kind: "image",
    async generate({
      prompt,
      outputFile,
      images = [],
      model = "gemini-3.1-flash-image",
      aspectRatio = "1:1",
      imageSize = "2K",
      timeoutMs = 300_000,
      metadata = {},
      receiptFile = null,
      attemptId = null,
      executionEffectAuthorization = null,
    } = {}) {
      const normalizedPrompt = requireText(prompt, "prompt");
      const normalizedModel = requireText(model, "model");
      if (!Array.isArray(images)) throw new Error("images deve ser uma lista.");
      if (images.length > 4) throw new Error("Este CLI aceita no máximo quatro imagens de referência por geração.");
      if (!GEMINI_IMAGE_MODELS.has(normalizedModel)) throw new Error(`Modelo de imagem não permitido: ${normalizedModel}.`);
      if (!GEMINI_IMAGE_ASPECT_RATIOS.has(aspectRatio)) throw new Error(`Aspecto de imagem inválido: ${aspectRatio}.`);
      if (!GEMINI_IMAGE_SIZES.has(imageSize)) throw new Error(`Tamanho de imagem inválido: ${imageSize}.`);
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs deve ser positivo.");
      if (metadata.executionKernel === "required") {
        consumeExecutionEffectAuthorization(executionEffectAuthorization, {
          provider: "gemini-image",
          operation: "image-generate",
          attemptId,
        });
      }

      const target = path.resolve(requireText(outputFile, "outputFile"));
      if (!new Set([".png", ".jpg", ".jpeg"]).has(path.extname(target).toLowerCase())) {
        throw new Error("A saída de imagem deve usar extensão .png, .jpg ou .jpeg.");
      }
      const plan = destinationPlan(target, receiptFile);
      const locks = await acquireDestinationLocks(plan.destinations);
      let imageTemporary = null;
      let receiptTemporary = null;
      let finalTarget = null;
      let finalReceipt = null;
      let imageCommitted = false;
      let receiptCommitted = false;
      try {
        await assertDestinationsAbsent(plan.destinations);
        const encoded = await encodeImages(images);
        await assertDestinationsAbsent(plan.destinations);
        const startedAt = clockValue(clock);
        async function requestWithTimeout(url, init, phase) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            return await request(url, { ...init, signal: controller.signal });
          } catch (error) {
            if (controller.signal.aborted) throw new Error(`Tempo excedido durante ${phase} (${timeoutMs} ms).`);
            throw error;
          } finally {
            clearTimeout(timer);
          }
        }
        const response = await requestWithTimeout(`${baseUrl}${route}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: normalizedModel,
            prompt: normalizedPrompt,
            productImages: encoded.map((entry) => entry.request),
            aspectRatio,
            imageSize,
          }),
        }, "a geração da imagem");

        const contentType = response.headers?.get?.("content-type") ?? "";
        if (!response.ok) await responseJson(response, "Gemini Image");
        let buffer;
        let mimeType;
        let providerResponse = {};
        if (contentType.startsWith("image/")) {
          buffer = Buffer.from(await response.arrayBuffer());
          providerResponse.delivery = "binary";
        } else {
          const payload = await responseJson(response, "Gemini Image");
          const value = payload.imageUrl ?? payload.image?.data ?? payload.output_image?.data ?? payload.images?.[0]?.data ?? payload.data ?? payload.image;
          if (typeof value !== "string") throw new Error("Gemini Image não retornou imageUrl ou dados de imagem reconhecíveis.");
          const dataUrl = decodeDataUrl(value);
          if (dataUrl) {
            ({ buffer } = dataUrl);
            providerResponse.delivery = "data-url";
          } else if (/^(https?:\/\/|\/)/i.test(value)) {
            const downloadUrl = new URL(value, `${baseUrl}/`).toString();
            const download = await requestWithTimeout(downloadUrl, {}, "o download da imagem");
            if (!download.ok) throw new Error(`Download da imagem Gemini: HTTP ${download.status}.`);
            buffer = Buffer.from(await download.arrayBuffer());
            providerResponse.delivery = "uri";
          } else {
            buffer = decodeBase64(value);
            providerResponse.delivery = "base64";
          }
          providerResponse = {
            ...providerResponse,
            interactionId: payload.interactionId ?? payload.interaction_id ?? null,
            model: payload.model ?? normalizedModel,
          };
        }

        if (!buffer?.length) throw new Error("Gemini Image retornou uma imagem vazia.");
        mimeType = detectedImageMimeType(buffer);
        if (!mimeType) throw new Error("Gemini Image retornou bytes que não são PNG ou JPEG reconhecido.");
        finalTarget = targetForMimeType(target, mimeType);
        finalReceipt = path.resolve(plan.receiptFor(finalTarget));
        imageTemporary = temporaryPath(finalTarget, "image");
        await writeFile(imageTemporary, buffer, { flag: "wx" });
        await assertDestinationsAbsent([
          { file: finalTarget, label: "Arquivo de imagem" },
          { file: finalReceipt, label: "Recibo de imagem" },
        ]);
        await publishExclusive(imageTemporary, finalTarget, "Arquivo de imagem");
        imageCommitted = true;
        await rm(imageTemporary, { force: true });
        imageTemporary = null;

        const completedAt = clockValue(clock);
        const artifact = await createArtifactFromFile({
          file: finalTarget,
          kind: "image",
          role: "generated-image",
          mimeType,
          source: { provider: "gemini-image-endpoint", model: normalizedModel },
          metadata,
          createdAt: completedAt,
        });
        const receipt = createStageReceipt({
          operation: "generate-image",
          provider: "gemini-image-endpoint",
          model: normalizedModel,
          mode: metadata.mode ?? "raw",
          stage: metadata.pipeline?.stage ?? "image",
          prompt: normalizedPrompt,
          parameters: { aspectRatio, imageSize, timeoutMs },
          inputs: encoded.map((entry) => entry.artifact),
          artifacts: [artifact],
          providerResponse,
          metadata,
          parentReceipts: metadata.pipeline?.parentReceiptIds ?? [],
          startedAt,
          completedAt,
        });
        receiptTemporary = temporaryPath(finalReceipt, "receipt");
        await writeReceipt(receiptTemporary, receipt);
        await publishExclusive(receiptTemporary, finalReceipt, "Recibo de imagem");
        receiptCommitted = true;
        await rm(receiptTemporary, { force: true });
        receiptTemporary = null;
        return { file: finalTarget, artifact, receipt, receiptFile: finalReceipt, interactionId: providerResponse.interactionId ?? null };
      } catch (error) {
        if (imageCommitted && !receiptCommitted && finalTarget) await rm(finalTarget, { force: true });
        throw error;
      } finally {
        if (imageTemporary) await rm(imageTemporary, { force: true });
        if (receiptTemporary) await rm(receiptTemporary, { force: true });
        await releaseDestinationLocks(locks);
      }
    },
  };
}
