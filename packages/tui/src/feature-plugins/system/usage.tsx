import { Plugin } from "@opencode/plugin/tui"
import { TextAttributes, type RGBA } from "@opentui/core"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createResource, createSignal, onMount, Show } from "solid-js"
import { Keymap } from "../../context/keymap"
import { useTheme } from "../../context/theme"
import { DialogGoUpsell } from "../../component/dialog-go-upsell"
import { DialogFooter, DialogHeader, DialogLayout, useDialog } from "../../ui/dialog"

type Meter = { used: number; limit: number; percent: number; exhausted: boolean; resets_at: string | null }
type Snapshot = {
  session: Meter
  weekly: Meter | null
  tokens: Meter | null
  plan: { name: string; label: string; expires_at: string | null; expired: boolean; requests_per_minute: number }
}

const SITE = (process.env.CIPIN_API_URL ?? "https://cipincode.com").replace(/\/+$/, "")

/** The key `cipin login` stored; the CLI bootstrap also exports it as CIPIN_API_KEY. */
function apiKey() {
  if (process.env.CIPIN_API_KEY) return process.env.CIPIN_API_KEY
  try {
    const dir = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
    return JSON.parse(readFileSync(join(dir, "cipin", "auth.json"), "utf8")).key as string | undefined
  } catch {
    return undefined
  }
}

async function loadUsage(): Promise<Snapshot> {
  const key = apiKey()
  if (!key) throw new Error("Belum masuk. Jalankan: cipin login")
  const response = await fetch(`${SITE}/api/cli/usage`, {
    headers: { authorization: `Bearer ${key}`, accept: "application/json", "x-cipin-client": "cipin-cli" },
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status === 401) throw new Error("Sesi tidak berlaku lagi. Jalankan: cipin login")
  if (!response.ok) throw new Error(`Gagal memuat usage (${response.status})`)
  return (await response.json()) as Snapshot
}

const number = (value: number) => new Intl.NumberFormat("id-ID").format(value)

function compact(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

function resetText(iso: string | null) {
  if (!iso) return undefined
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return "segera reset"
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `reset ${minutes} menit lagi`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `reset ${hours} jam ${minutes % 60} menit lagi`
  return `reset ${Math.round(hours / 24)} hari lagi`
}

function bar(percent: number, width: number) {
  const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * width)
  return "█".repeat(filled) + "░".repeat(width - filled)
}

function Card(props: { title: string; color: RGBA; children: any }) {
  return (
    <box
      flexShrink={0}
      border
      borderStyle="rounded"
      borderColor={props.color}
      title={` ${props.title} `}
      titleColor={props.color}
      paddingLeft={1}
      paddingRight={1}
    >
      {props.children}
    </box>
  )
}

function MeterCard(props: { title: string; meter: Meter; unit: string }) {
  const theme = useTheme().surface("dialog")
  const unlimited = () => props.meter.limit === 0
  const color = () =>
    props.meter.exhausted || props.meter.percent >= 90
      ? theme.text.feedback.error.base
      : props.meter.percent >= 70
        ? theme.text.feedback.warning.base
        : theme.text.feedback.success.base
  return (
    <Card title={props.title} color={unlimited() ? theme.text.muted : color()}>
      <Show
        when={!unlimited()}
        fallback={
          <box>
            <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
              Tanpa batas
            </text>
            <text fg={theme.text.muted}>
              {number(props.meter.used)} {props.unit} terpakai
              {resetText(props.meter.resets_at) ? ` · ${resetText(props.meter.resets_at)}` : ""}
            </text>
          </box>
        }
      >
        <box>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={color()}>{bar(props.meter.percent, 30)}</text>
            <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
              {props.meter.percent}%
            </text>
          </box>
          <text fg={theme.text.muted}>
            {compact(props.meter.used)} / {compact(props.meter.limit)} {props.unit}
            {resetText(props.meter.resets_at) ? ` · ${resetText(props.meter.resets_at)}` : ""}
          </text>
        </box>
      </Show>
    </Card>
  )
}

function planExpiry(plan: Snapshot["plan"]) {
  if (!plan.expires_at) return undefined
  const days = Math.ceil((new Date(plan.expires_at).getTime() - Date.now()) / 86_400_000)
  const date = new Date(plan.expires_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })
  return days > 0 ? `berlaku sampai ${date} (${days} hari lagi)` : `berakhir ${date}`
}

export function UsageDialog() {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const [result, { refetch }] = createResource(loadUsage)
  const [tick, setTick] = createSignal(0)
  onMount(() => dialog.setSize("medium"))

  const refresh = () => {
    setTick(tick() + 1)
    void refetch()
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "escape", title: "Tutup", group: "Dialog", run: () => dialog.clear() },
      { bind: "r", title: "Muat ulang", group: "Dialog", run: refresh },
    ],
  }))

  const actions = () => [{ title: "muat ulang", key: "r", onTrigger: refresh }]

  return (
    <DialogLayout
      header={<DialogHeader title="Usage · Cipincode" onClose={() => dialog.clear()} />}
      footer={{ actions: { primary: actions() } }}
      legacyFooter={<DialogFooter actions={{ secondary: actions(), primary: [{ title: "tutup", key: "esc" }] }} />}
    >
      <Show
        when={!result.error}
        fallback={<text fg={theme.text.feedback.error.base}>{(result.error as Error).message}</text>}
      >
        <Show when={result()} fallback={<text fg={theme.text.muted}>Memuat usage…</text>}>
          {(data) => (
            <box gap={1}>
              <Card
                title="Paket"
                color={data().plan.name === "paid" ? theme.text.feedback.success.base : theme.text.feedback.warning.base}
              >
                <text fg={theme.text.base} attributes={TextAttributes.BOLD}>
                  {data().plan.label}
                </text>
                <Show when={planExpiry(data().plan)}>
                  <text fg={theme.text.muted}>{planExpiry(data().plan)}</text>
                </Show>
                <Show when={data().plan.name !== "paid"}>
                  <text fg={theme.text.feedback.warning.base}>
                    Cipin CLI butuh paket Unlimited · top up di cipincode.com/mbr/dashboard/topup
                  </text>
                </Show>
              </Card>
              <MeterCard title="Sesi 5 jam" meter={data().session} unit="token" />
              <Show when={data().weekly}>{(weekly) => <MeterCard title="Mingguan" meter={weekly()} unit="token" />}</Show>
              <Show when={data().tokens}>
                {(tokens) => <MeterCard title="Total token paket" meter={tokens()} unit="token" />}
              </Show>
              <text fg={theme.text.muted}>Batas permintaan: {data().plan.requests_per_minute || "tanpa batas"} / menit</text>
            </box>
          )}
        </Show>
      </Show>
    </DialogLayout>
  )
}

export default Plugin.define({
  id: "cipin.usage",
  setup(context) {
    context.ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "usage.open",
              title: "Usage dan kuota token",
              group: "System",
              slash: { name: "usage" },
              palette: true,
              run() {
                context.ui.dialog.show(() => <UsageDialog />)
              },
            },
          ],
        }))
        // Preview of the quota-exhausted dialog; only registered when CIPIN_DEMO=1, never for regular users.
        if (process.env.CIPIN_DEMO)
          context.keymap.layer(() => ({
            mode: "global",
            commands: [
              {
                id: "usage.demo-exhausted",
                title: "Demo: modal kuota habis",
                group: "System",
                slash: { name: "demo-kuota" },
                palette: true,
                run() {
                  context.ui.dialog.show(() => (
                    <DialogGoUpsell onSubscribe={() => {}} onDontShowAgain={() => context.ui.dialog.clear()} />
                  ))
                },
              },
            ],
          }))
        return null
      },
    })
  },
})
