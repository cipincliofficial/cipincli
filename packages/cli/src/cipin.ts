import { createHash, randomBytes } from "node:crypto"
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, hostname } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline/promises"
import { spawn, spawnSync } from "node:child_process"
import { OPENCODE_VERSION } from "./version"

/**
 * Cipin CLI: opencode wired to the Cipincode gateway. Everyone can sign in, but the gateway only
 * answers while an Unlimited package is running (see https://cipincode.com/syarat-ketentuan).
 */

const SITE = (process.env.CIPIN_API_URL ?? "https://cipincode.com").replace(/\/+$/, "")
const CLIENT = `cipin-cli/${OPENCODE_VERSION}`
const FALLBACK_MODELS = ["gpt-5", "claude-sonnet-4-5"]

const dir = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "cipin")
const authFile = join(dir, "auth.json")
const modelsFile = join(dir, "models.json")

type Auth = { key: string; name?: string; email?: string }

const readAuth = (): Auth | undefined => {
  try {
    const data = JSON.parse(readFileSync(authFile, "utf8"))
    return typeof data.key === "string" && data.key ? data : undefined
  } catch {
    return undefined
  }
}

const writeAuth = (auth: Auth) => {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(authFile, JSON.stringify(auth, null, 2), { mode: 0o600 })
  chmodSync(authFile, 0o600)
}

const base64url = (buffer: Buffer) => buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

const openBrowser = (url: string) => {
  const command =
    process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url]
  try {
    spawn(command[0], command.slice(1), { stdio: "ignore", detached: true }).on("error", () => {}).unref()
  } catch {}
}

const api = (path: string, init: RequestInit = {}) =>
  fetch(`${SITE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", accept: "application/json", "x-cipin-client": CLIENT, ...init.headers },
    signal: AbortSignal.timeout(15_000),
  })

async function login() {
  const verifier = base64url(randomBytes(48))
  const challenge = base64url(createHash("sha256").update(verifier).digest())
  const url = `${SITE}/cli/authorize?challenge=${challenge}`

  console.log("Cipin CLI — masuk ke akun Cipincode\n")
  console.log("Buka tautan ini di browser, masuk, lalu setujui:\n")
  console.log(`  ${url}\n`)
  openBrowser(url)

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const code = await rl
    .question("Tempel kode (XXXX-XXXX): ", { signal: AbortSignal.timeout(5 * 60_000) })
    .then((answer) => answer.trim())
    .catch(() => undefined)
  rl.close()
  if (code === undefined) {
    console.log("\nLogin dibatalkan. Jalankan cipin login lagi kalau mau mencoba.")
    process.exit(130)
  }
  if (!code) return fail("Kode kosong.")

  const response = await api("/api/cli/exchange", {
    method: "POST",
    body: JSON.stringify({ code, verifier, device: hostname() }),
  }).catch((error: Error) => fail(`Tidak bisa menghubungi ${SITE}: ${error.message}`))

  const body = (await response.json().catch(() => ({}))) as { key?: string; user?: { name?: string; email?: string }; message?: string }
  if (!response.ok || !body.key) return fail(body.message ?? `Login gagal (${response.status}).`)

  writeAuth({ key: body.key, name: body.user?.name, email: body.user?.email })
  console.log(`\nBerhasil masuk sebagai ${body.user?.name ?? "pengguna"} (${body.user?.email ?? "-"}).`)
  console.log(`Cipin CLI hanya menjawab dengan paket Unlimited aktif. Top up: ${SITE}/mbr/dashboard/topup`)
  console.log(`Syarat & ketentuan: ${SITE}/syarat-ketentuan`)
}

async function whoami() {
  const auth = readAuth()
  if (!auth) return fail("Belum masuk. Jalankan: cipin login")
  const response = await api("/api/cli/me", { headers: { authorization: `Bearer ${auth.key}` } }).catch(() => undefined)
  if (response?.status === 401) return fail("Sesi tidak berlaku lagi. Jalankan: cipin login")
  console.log(`${auth.name ?? "-"} <${auth.email ?? "-"}>`)
  const usage = await api("/api/cli/usage", { headers: { authorization: `Bearer ${auth.key}` } }).catch(() => undefined)
  const data = (await usage?.json().catch(() => undefined)) as { plan?: { label?: string; name?: string; expires_at?: string | null } } | undefined
  if (data?.plan) {
    const unlimited = data.plan.name === "paid"
    console.log(`Paket: ${data.plan.label}${data.plan.expires_at ? ` (sampai ${data.plan.expires_at})` : ""}`)
    if (!unlimited) console.log(`Cipin CLI butuh paket Unlimited. Top up: ${SITE}/mbr/dashboard/topup`)
  }
}

function logout() {
  rmSync(authFile, { force: true })
  console.log("Sudah keluar.")
}

/** `cipin upgrade` / `cipin uninstall` go through npm, which is how Cipin CLI is installed. */
function npmCommand(args: string[], doneMessage: string) {
  const child = spawn("npm", args, { stdio: "inherit", shell: process.platform === "win32" })
  child.on("error", (error) => fail(`npm tidak bisa dijalankan: ${error.message}`))
  child.on("exit", (code) => {
    if (code === 0) console.log(doneMessage)
    process.exit(code ?? 1)
  })
}

function topup() {
  const url = `${SITE}/mbr/dashboard/topup`
  console.log(url)
  openBrowser(url)
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

/** Models the gateway offers this account; the last good answer is cached for offline starts. */
async function models(key: string): Promise<string[]> {
  try {
    const response = await api("/v1/models", { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(4_000) })
    const body = (await response.json()) as { data?: { id?: string }[] }
    const ids = (body.data ?? []).map((item) => item.id).filter((id): id is string => typeof id === "string")
    if (ids.length) {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      writeFileSync(modelsFile, JSON.stringify(ids))
      return ids
    }
  } catch {}
  try {
    if (existsSync(modelsFile)) return JSON.parse(readFileSync(modelsFile, "utf8"))
  } catch {}
  return FALLBACK_MODELS
}

const versionFile = join(dir, "service-version")

/**
 * The background service outlives the terminal and is shared by every cipin binary, so after an upgrade it would keep
 * serving the old version's agents and settings. Stop it once whenever the installed version changes.
 */
function restartStaleService() {
  if (process.env.CIPIN_SKIP_SERVICE_CHECK) return
  let previous: string | undefined
  try {
    previous = readFileSync(versionFile, "utf8").trim()
  } catch {}
  if (previous === OPENCODE_VERSION) return
  spawnSync(process.execPath, process.execPath.endsWith("bun") ? [process.argv[1], "service", "stop"] : ["service", "stop"], {
    stdio: "ignore",
    env: { ...process.env, CIPIN_SKIP_SERVICE_CHECK: "1" },
    timeout: 15_000,
  })
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  writeFileSync(versionFile, OPENCODE_VERSION)
}

const passthrough = new Set(["--version", "-v", "--help", "-h", "help"])

/** Handles Cipin's own commands, then points opencode at the gateway. Returns when opencode should start. */
export async function cipin() {
  const [command, ...rest] = process.argv.slice(2)

  switch (command) {
    case "login":
      return await login().then(() => process.exit(0))
    case "logout":
      return logout(), process.exit(0)
    case "whoami":
      return await whoami().then(() => process.exit(0))
    case "topup":
      return topup(), process.exit(0)
    case "upgrade":
    case "update":
      return npmCommand(["install", "-g", "cipincli@latest"], "Selesai. Jalankan cipin lagi untuk memakai versi terbaru."), await new Promise(() => {})
    case "uninstall":
      return npmCommand(["uninstall", "-g", "cipincli"], "Cipin CLI dihapus. Login Anda tersimpan di ~/.config/cipin (hapus manual kalau perlu)."), await new Promise(() => {})
  }

  if (command !== undefined && passthrough.has(command) && rest.length === 0) return

  const auth = readAuth()
  if (!auth) return fail("Belum masuk. Jalankan: cipin login")

  restartStaleService()

  const ids = await models(auth.key)
  const config = {
    provider: {
      cipin: {
        npm: "@ai-sdk/openai-compatible",
        name: "Cipin",
        options: { baseURL: `${SITE}/v1`, apiKey: auth.key, headers: { "x-cipin-client": CLIENT } },
        models: Object.fromEntries(
          ids.map((id) => [
            id,
            {
              name: id,
              // The gateway passes reasoning_effort through to every model it serves.
              variants: Object.fromEntries(
                ["low", "medium", "high"].map((effort) => [effort, { reasoningEffort: effort }]),
              ),
            },
          ]),
        ),
      },
    },
    enabled_providers: ["cipin"],
    model: `cipin/${ids[0]}`,
    autoupdate: false,
    share: "disabled",
  }

  process.env.CIPIN_VERSION = OPENCODE_VERSION
  process.env.CIPIN_API_URL = SITE
  process.env.CIPIN_API_KEY = auth.key
  process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify(config)
  process.env.OPENCODE_DISABLE_MODELS_FETCH = "1"
  process.env.OPENCODE_DISABLE_AUTOUPDATE = "1"
}
