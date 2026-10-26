import { Plugin } from "@opencode/plugin/tui"
import { TextAttributes } from "@opentui/core"
import { spawn } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createSignal, onMount, Show } from "solid-js"
import { Keymap } from "../../context/keymap"
import { useTheme } from "../../context/theme"
import { DialogFooter, DialogHeader, DialogLayout, useDialog } from "../../ui/dialog"

const PACKAGE = "cipincli"
const REGISTRY = `https://registry.npmjs.org/${PACKAGE}/latest`
const COMMAND = `npm install -g ${PACKAGE}@latest`
const CHECK_EVERY_MS = 6 * 3_600_000

const current = () => process.env.CIPIN_VERSION ?? "0.0.0"
const cacheFile = () =>
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "cipin", "update-check.json")

/** -1, 0 or 1 like a comparator for plain x.y.z versions; anything after a dash (e.g. -dev) sorts below the release. */
function compare(a: string, b: string) {
  const parse = (value: string) => {
    const [core, pre] = value.replace(/^v/, "").split("-", 2)
    return { numbers: core.split(".").map((part) => Number.parseInt(part, 10) || 0), pre }
  }
  const left = parse(a)
  const right = parse(b)
  for (let i = 0; i < 3; i++) {
    const diff = (left.numbers[i] ?? 0) - (right.numbers[i] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  if (left.pre && !right.pre) return -1
  if (!left.pre && right.pre) return 1
  return 0
}

/** The newest published version, from a six-hour cache when fresh, otherwise from npm. */
async function latestVersion(force = false): Promise<string | undefined> {
  try {
    if (!force) {
      const cached = JSON.parse(readFileSync(cacheFile(), "utf8")) as { checkedAt: number; version: string }
      if (Date.now() - cached.checkedAt < CHECK_EVERY_MS && cached.version) return cached.version
    }
  } catch {}
  try {
    const response = await fetch(REGISTRY, { signal: AbortSignal.timeout(5_000), headers: { accept: "application/json" } })
    if (!response.ok) return undefined
    const version = ((await response.json()) as { version?: string }).version
    if (!version) return undefined
    try {
      mkdirSync(join(cacheFile(), ".."), { recursive: true, mode: 0o700 })
      writeFileSync(cacheFile(), JSON.stringify({ checkedAt: Date.now(), version }))
    } catch {}
    return version
  } catch {
    return undefined
  }
}

type State =
  | { type: "checking" }
  | { type: "latest"; version: string }
  | { type: "available"; version: string }
  | { type: "installing"; version: string }
  | { type: "installed"; version: string }
  | { type: "failed"; message: string }
  | { type: "unknown" }

function UpdateDialog() {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const [state, setState] = createSignal<State>({ type: "checking" })

  const check = async () => {
    setState({ type: "checking" })
    const version = await latestVersion(true)
    if (!version) return setState({ type: "unknown" })
    setState(compare(current(), version) < 0 ? { type: "available", version } : { type: "latest", version })
  }

  const install = () => {
    const state_ = state()
    if (state_.type !== "available") return
    setState({ type: "installing", version: state_.version })
    const child = spawn("npm", ["install", "-g", `${PACKAGE}@${state_.version}`], {
      shell: process.platform === "win32",
      stdio: ["ignore", "ignore", "pipe"],
    })
    let stderr = ""
    child.stderr?.on("data", (chunk) => (stderr += String(chunk)))
    child.on("error", (error) => setState({ type: "failed", message: error.message }))
    child.on("exit", (code) =>
      setState(
        code === 0
          ? { type: "installed", version: state_.version }
          : { type: "failed", message: stderr.trim().split("\n").slice(-3).join("\n") || `npm keluar dengan kode ${code}` },
      ),
    )
  }

  onMount(() => void check())

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "escape", title: "Tutup", group: "Dialog", run: () => dialog.clear() },
      { bind: "return", title: "Perbarui", group: "Dialog", run: install },
      { bind: "r", title: "Cek lagi", group: "Dialog", run: () => void check() },
    ],
  }))

  const actions = () => [
    ...(state().type === "available" ? [{ title: "perbarui", key: "enter", onTrigger: install }] : []),
    { title: "cek lagi", key: "r", onTrigger: () => void check() },
  ]

  return (
    <DialogLayout
      header={<DialogHeader title="Pembaruan Cipin CLI" onClose={() => dialog.clear()} />}
      footer={{ actions: { primary: actions() } }}
      legacyFooter={<DialogFooter actions={{ secondary: actions(), primary: [{ title: "tutup", key: "esc" }] }} />}
    >
      <box gap={1}>
        <text fg={theme.text.muted}>Versi terpasang: {current()}</text>
        {(() => {
          const value = state()
          switch (value.type) {
            case "checking":
              return <text fg={theme.text.muted}>Memeriksa versi terbaru…</text>
            case "latest":
              return <text fg={theme.text.feedback.success.base}>Sudah versi terbaru ({value.version}).</text>
            case "available":
              return (
                <box gap={1}>
                  <text fg={theme.text.feedback.warning.base} attributes={TextAttributes.BOLD}>
                    Versi baru tersedia: {value.version}
                  </text>
                  <text fg={theme.text.muted}>Tekan Enter untuk memperbarui, atau jalankan di terminal:</text>
                  <text fg={theme.text.base}>{COMMAND}</text>
                </box>
              )
            case "installing":
              return <text fg={theme.text.muted}>Memasang {value.version}…</text>
            case "installed":
              return (
                <text fg={theme.text.feedback.success.base}>
                  Versi {value.version} terpasang. Keluar lalu jalankan cipin lagi untuk memakainya.
                </text>
              )
            case "failed":
              return (
                <box gap={1}>
                  <text fg={theme.text.feedback.error.base}>Gagal memperbarui.</text>
                  <text fg={theme.text.muted} wrapMode="word">
                    {value.message}
                  </text>
                  <text fg={theme.text.muted}>Coba manual: {COMMAND}</text>
                </box>
              )
            default:
              return <Show when={true}><text fg={theme.text.muted}>Tidak bisa memeriksa npm sekarang. Coba lagi nanti.</text></Show>
          }
        })()}
      </box>
    </DialogLayout>
  )
}

export default Plugin.define({
  id: "cipin.update",
  setup(context) {
    // Tell the user once per launch when npm has a newer Cipin CLI.
    void latestVersion().then((version) => {
      if (!version || compare(current(), version) >= 0) return
      context.ui.toast.show({
        variant: "warning",
        title: `Cipin CLI ${version} tersedia`,
        message: `Kamu memakai ${current()}. Ketik /update atau jalankan: ${COMMAND}`,
        duration: 12_000,
      })
    })

    context.ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "update.open",
              title: "Perbarui Cipin CLI",
              group: "System",
              slash: { name: "update" },
              palette: true,
              run() {
                context.ui.dialog.show(() => <UpdateDialog />)
              },
            },
          ],
        }))
        return null
      },
    })
  },
})
