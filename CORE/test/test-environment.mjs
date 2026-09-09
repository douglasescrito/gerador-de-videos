import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// Inclusive os subprocessos da suíte precisam resolver runtimes de teste.
// Nunca herdar o banco operacional de uma sessão que também produz mídia.
process.env.NODE_ENV = "test";
delete process.env.MKT_VIDEOS_RUNTIME_DB;
// O ledger de capabilities e o Knowledge Core moram em %LOCALAPPDATA%. Uma
// ativação real da máquina muda o snapshot efetivo, e todo plano compilado com
// o catálogo estático passa a divergir em capabilitySnapshotHash — a suíte
// ficava vermelha por causa do estado do operador, não do código. Cada
// processo de teste recebe a sua própria raiz, descartada no fim.
//
// O mesmo diretório guarda os navegadores do Playwright, e o piloto de motion
// procura o Chromium justamente ali. Por isso a raiz nova aponta de volta para
// ms-playwright: isolar o estado do produto não pode esconder o navegador. Se
// a junção não puder ser criada, o isolamento é desfeito em vez de deixar a
// suíte sem browser.
const realLocalAppData = process.env.LOCALAPPDATA;
if (realLocalAppData) {
  const isolated = mkdtempSync(path.join(tmpdir(), "gerador-de-videos-test-appdata-"));
  const browsers = path.join(realLocalAppData, "ms-playwright");
  let ready = true;
  if (existsSync(browsers)) {
    try { symlinkSync(browsers, path.join(isolated, "ms-playwright"), "junction"); }
    catch { ready = false; }
  }
  if (ready) {
    process.env.LOCALAPPDATA = isolated;
    process.on("exit", () => { try { rmSync(isolated, { recursive: true, force: true }); } catch {} });
  } else {
    try { rmSync(isolated, { recursive: true, force: true }); } catch {}
  }
}
if (process.env.MKT_VERIFICATION_RESOURCE_CLASS) await import("./verification-resource-guard.mjs");
if (process.env.MKT_VERIFICATION_PROFILE_DIR) await import("./subprocess-profile.mjs");
if (process.env.MKT_VERIFICATION_PROFILE_DIR) await import("./filesystem-profile.mjs");
