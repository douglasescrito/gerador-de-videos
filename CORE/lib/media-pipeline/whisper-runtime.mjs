import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { studioLocalPath } from '../studio-local-config.mjs';
import { runCommand } from "./media-tools.mjs";

const DEFAULT_COMMANDS = new Set(["whisper", "whisper.exe"]);

// Caminho de execução do Whisper. `auto` decide pela sonda; `cuda` é exigência
// (falha explícita se a GPU não estiver disponível, em vez de cair para CPU e
// gastar 60s onde se esperava 20); `cpu` é escolha deliberada de referência.
export const WHISPER_DEVICE_MODES = Object.freeze(["auto", "cuda", "cpu"]);

function configuredCommand(value) {
  const command = String(value ?? "").trim();
  return command || null;
}

async function availableFile(file, accessImpl) {
  try {
    await accessImpl(file);
    return true;
  } catch {
    return false;
  }
}

function pythonDirectoryScore(name) {
  const match = /^Python(\d+)$/i.exec(name);
  return match ? Number(match[1]) : -1;
}

async function discoverWindowsWhisper({ env, accessImpl, readdirImpl }) {
  const roots = [
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Programs", "Python") : null,
    env.APPDATA ? path.join(env.APPDATA, "Python") : null,
  ].filter(Boolean);

  for (const root of roots) {
    let entries;
    try {
      entries = await readdirImpl(root, { withFileTypes: true });
    } catch {
      continue;
    }
    const pythonDirs = entries
      .filter((entry) => entry.isDirectory() && pythonDirectoryScore(entry.name) >= 0)
      .sort((left, right) => pythonDirectoryScore(right.name) - pythonDirectoryScore(left.name));
    for (const entry of pythonDirs) {
      const candidate = path.join(root, entry.name, "Scripts", "whisper.exe");
      if (await availableFile(candidate, accessImpl)) return candidate;
    }
  }
  return null;
}

export async function resolveWhisperRuntime({
  command = "whisper",
  platform = process.platform,
  env = process.env,
  accessImpl = access,
  readdirImpl = readdir,
} = {}) {
  const requested = configuredCommand(command) ?? "whisper";
  if (!DEFAULT_COMMANDS.has(requested.toLowerCase())) {
    return { command: requested, source: "explicit" };
  }
  const fromEnvironment = configuredCommand(env.WHISPER_COMMAND);
  if (fromEnvironment) return { command: fromEnvironment, source: "environment" };

  const fromInstallation = studioLocalPath('whisperCommand', env);
  if (fromInstallation) return { command: fromInstallation, source: 'local-installation' };

  if (platform === "win32") {
    const discovered = await discoverWindowsWhisper({ env, accessImpl, readdirImpl });
    if (discovered) return { command: discovered, source: "python-user-install" };
  }
  return { command: requested, source: "path" };
}

export async function probeWhisperRuntime(options = {}) {
  const runtime = await resolveWhisperRuntime(options);
  if (path.isAbsolute(runtime.command)) {
    return {
      ...runtime,
      available: await availableFile(runtime.command, options.accessImpl ?? access),
    };
  }

  const platform = options.platform ?? process.platform;
  const locator = platform === "win32" ? "where.exe" : "which";
  const result = (options.spawnSyncImpl ?? spawnSync)(locator, [runtime.command], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });
  const resolved = result.status === 0
    ? String(result.stdout ?? "").split(/\r?\n/).map((entry) => entry.trim()).find(Boolean) ?? null
    : null;
  return { ...runtime, available: Boolean(resolved), resolved };
}

// O whisper.exe instalado pelo pip vive em <prefix>/Scripts; o interpretador que
// carrega o torch é o <prefix>/python.exe ao lado. Sondar esse python (e não um
// "python" qualquer do PATH) é o que garante que a resposta sobre CUDA descreva
// o mesmo ambiente que vai rodar a transcrição.
export function pythonForWhisperCommand(command, { platform = process.platform } = {}) {
  const resolved = String(command ?? "").trim();
  if (!resolved || !path.isAbsolute(resolved)) return null;
  const directory = path.dirname(resolved);
  const base = path.basename(directory).toLowerCase();
  const prefix = base === "scripts" || base === "bin" ? path.dirname(directory) : directory;
  return platform === "win32" ? path.join(prefix, "python.exe") : path.join(prefix, "bin", "python");
}

const TORCH_PROBE_SCRIPT = [
  "import json",
  "info = {'torch': None, 'cuda': False, 'cudaVersion': None, 'devices': [], 'error': None}",
  "try:",
  "    import torch",
  "    info['torch'] = torch.__version__",
  "    info['cudaVersion'] = getattr(torch.version, 'cuda', None)",
  "    info['cuda'] = bool(torch.cuda.is_available())",
  "    if info['cuda']:",
  "        for index in range(torch.cuda.device_count()):",
  "            props = torch.cuda.get_device_properties(index)",
  "            info['devices'].append({",
  "                'index': index,",
  "                'name': props.name,",
  "                'totalMemoryBytes': int(props.total_memory),",
  "                'capability': '%d.%d' % (props.major, props.minor),",
  "            })",
  "except Exception as exc:",
  "    info['error'] = '%s: %s' % (type(exc).__name__, exc)",
  "print(json.dumps(info))",
].join("\n");

/**
 * Pergunta ao torch do próprio ambiente se há CUDA. Uma sonda que falha não
 * derruba nada: devolve `cuda: false` com o motivo, e quem exigiu GPU decide.
 */
export async function probeTorchRuntime({
  pythonCommand = null,
  whisperCommand = null,
  platform = process.platform,
  env = process.env,
  runCommandImpl = runCommand,
} = {}) {
  const candidates = [
    String(pythonCommand ?? "").trim() || null,
    String(env.WHISPER_PYTHON ?? "").trim() || null,
    whisperCommand ? pythonForWhisperCommand(whisperCommand, { platform }) : null,
    platform === "win32" ? "python.exe" : "python3",
  ].filter(Boolean);

  let lastError = null;
  for (const python of candidates) {
    try {
      const { stdout } = await runCommandImpl(python, ["-c", TORCH_PROBE_SCRIPT], { maxOutputBytes: 256 * 1024 });
      const payload = JSON.parse(String(stdout).trim().split(/\r?\n/).at(-1));
      return {
        python,
        available: true,
        torch: payload.torch ?? null,
        cuda: Boolean(payload.cuda),
        cudaVersion: payload.cudaVersion ?? null,
        devices: Array.isArray(payload.devices) ? payload.devices : [],
        error: payload.error ?? null,
      };
    } catch (error) {
      lastError = error;
    }
  }
  return {
    python: candidates.at(-1) ?? null,
    available: false,
    torch: null,
    cuda: false,
    cudaVersion: null,
    devices: [],
    error: `Sonda de torch indisponível: ${lastError?.message ?? "nenhum interpretador respondeu"}.`,
  };
}

/**
 * Traduz a intenção em um plano de execução explícito. Nunca há caminho mudo:
 * ou o plano diz `cuda`, ou diz `cpu` com o motivo da queda registrado.
 */
export function resolveWhisperDevice({ requested = "auto", probe = null, allowFp16 = true } = {}) {
  const mode = String(requested ?? "auto").trim().toLowerCase();
  if (!WHISPER_DEVICE_MODES.includes(mode)) {
    throw new Error(`Device de Whisper inválido: ${requested}. Use ${WHISPER_DEVICE_MODES.join(", ")}.`);
  }
  const gpu = probe?.devices?.[0] ?? null;
  const base = {
    requested: mode,
    probed: probe ? { torch: probe.torch ?? null, cuda: Boolean(probe.cuda), cudaVersion: probe.cudaVersion ?? null, python: probe.python ?? null } : null,
    gpu,
  };
  if (mode === "cpu") {
    return { ...base, device: "cpu", fp16: false, fallback: false, reason: "requested-cpu", notice: null };
  }
  if (mode === "cuda") {
    if (!probe?.cuda) {
      throw new Error(
        `GPU exigida (--whisper-device cuda), mas CUDA não está disponível: ${probe?.error ?? "torch.cuda.is_available() devolveu False"}. `
        + "Use --whisper-device auto para aceitar CPU ou corrija a instalação do torch com CUDA.",
      );
    }
    return { ...base, device: "cuda", fp16: Boolean(allowFp16), fallback: false, reason: "requested-cuda", notice: null };
  }
  if (probe?.cuda) {
    return { ...base, device: "cuda", fp16: Boolean(allowFp16), fallback: false, reason: "auto-cuda", notice: null };
  }
  return {
    ...base,
    device: "cpu",
    fp16: false,
    fallback: true,
    reason: "auto-cpu-fallback",
    notice: `Whisper vai rodar em CPU: ${probe?.error ?? "nenhuma GPU CUDA visível para o torch"}.`,
  };
}

/** Argumentos de device do CLI oficial do Whisper. */
export function whisperDeviceArgs({ device = "cpu", fp16 = false } = {}) {
  return ["--device", String(device), "--fp16", fp16 ? "True" : "False"];
}

/**
 * Identidade do runtime que produziu uma medição. Entra na chave do cache: se o
 * backend, o device ou a versão do torch mudam, o timestamp guardado deixa de
 * valer automaticamente, sem ninguém precisar lembrar de limpar nada.
 */
export function whisperRuntimeFingerprint({
  backend = "openai-whisper",
  device = "cpu",
  fp16 = false,
  torch = null,
  cudaVersion = null,
  commandSource = "path",
  extra = null,
} = {}) {
  const payload = JSON.stringify({ backend, device, fp16: Boolean(fp16), torch, cudaVersion, commandSource, extra: extra ?? null });
  return `wrt1:${createHash("sha256").update(payload).digest("hex").slice(0, 16)}`;
}
