import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createMemo, createResource, For, Show, type JSX } from "solid-js"
import { Keymap } from "../context/keymap"
import { useData } from "../context/data"
import { useLocal } from "../context/local"
import { useTheme } from "../context/theme"
import { DialogFooter, DialogHeader, DialogLayout, useDialog } from "../ui/dialog"

type Meter = { used: number; limit: number; percent: number; exhausted: boolean; resets_at: string | null }
type Usage = {
  session: Meter
  weekly: Meter | null
  tokens: Meter | null
  plan: { name: string; label: string; expires_at: string | null; expired: boolean; requests_per_minute: number }
}
type Account = {
  user: { name: string; email: string }
  usage: Usage
  latencyMs: number
}

const SITE = (process.env.CIPIN_API_URL ?? "https://cipincode.com").replace(/\/+$/, "")
const VERSION = process.env.CIPIN_VERSION ?? "dev"

function apiKey() {
  if (process.env.CIPIN_API_KEY) return process.env.CIPIN_API_KEY
  try {
    const dir = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
    return JSON.parse(readFileSync(join(dir, "cipin", "auth.json"), "utf8")).key as string | undefined
  } catch {
    return undefined
  }
}

async function get<T>(path: string, key: string): Promise<T> {
  const response = await fetch(`${SITE}${path}`, {
    headers: { authorization: `Bearer ${key}`, accept: "application/json", "x-cipin-client": "cipin-cli" },
    signal: AbortSignal.timeout(10_000),
  })
  if (response.status === 401) throw new Error("Sesi tidak berlaku lagi. Jalankan: cipin login")
  if (response.status === 403) throw new Error("Akun Anda diblokir. Hubungi admin Cipincode jika ini keliru.")
  if (!response.ok) throw new Error(`Gateway menjawab ${response.status}`)
  return (await response.json()) as T
}

async function loadAccount(): Promise<Account> {
  const key = apiKey()
  if (!key) throw new Error("Belum masuk. Jalankan: cipin login")
  const started = performance.now()
  const [me, usage] = await Promise.all([
    get<{ user: { name: string; email: string } }>("/api/cli/me", key),
    get<Usage>("/api/cli/usage", key),
  ]).catch((error: Error) => {
    if (error.name === "TimeoutError" || error.name === "TypeError")
      throw new Error(`Tidak bisa menghubungi ${SITE}. Periksa koneksi internet Anda.`)
    throw error
  })
  return { user: me.user, usage, latencyMs: Math.round(performance.now() - started) }
}

const compact = (value: number) =>
  value >= 1_000_000_000
    ? `${(value / 1_000_000_000).toFixed(1)}B`
    : value >= 1_000_000
      ? `${(value / 1_000_000).toFixed(1)}M`
      : value >= 1_000
        ? `${(value / 1_000).toFixed(1)}K`
        : String(value)

function resetText(iso: string | null) {
  if (!iso) return undefined
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return "segera reset"
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `reset ${minutes} menit lagi`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `reset ${hours} jam ${minutes % 60} menit lagi` : `reset ${Math.round(hours / 24)} hari lagi`
}

function expiry(plan: Usage["plan"]) {
  if (!plan.expires_at) return undefined
  const end = new Date(plan.expires_at)
  const days = Math.ceil((end.getTime() - Date.now()) / 86_400_000)
  const date = end.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })
  if (days > 3650) return "tanpa batas waktu"
  return days > 0 ? `${date} (${days} hari lagi)` : `berakhir ${date}`
}

export function DialogStatus() {
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  const data = useData()
  const local = useLocal()
  const theme = useTheme().surface("dialog")
  const [account, { refetch }] = createResource(loadAccount)
  const mcp = createMemo(() => data.location.mcp.server.list() ?? [])

  const ok = () => theme.text.feedback.success.base
  const warn = () => theme.text.feedback.warning.base
  const bad = () => theme.text.feedback.error.base

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "escape", title: "Tutup", group: "Dialog", run: () => dialog.clear() },
      { bind: "r", title: "Muat ulang", group: "Dialog", run: () => void refetch() },
    ],
  }))
  const actions = () => [{ title: "muat ulang", key: "r", onTrigger: () => void refetch() }]

  const Row = (props: { label: string; children: JSX.Element }) => (
    <box flexDirection="row" gap={1}>
      <text fg={theme.text.muted} flexShrink={0} width={13}>
        {props.label}
      </text>
      <box flexGrow={1} flexShrink={1}>
        {props.children}
      </box>
    </box>
  )
  const Value = (props: { color?: ReturnType<typeof ok>; bold?: boolean; children: JSX.Element }) => (
    <text fg={props.color ?? theme.text.base} attributes={props.bold ? TextAttributes.BOLD : undefined} wrapMode="word">
      {props.children}
    </text>
  )
  const Card = (props: { title: string; color?: ReturnType<typeof ok>; children: JSX.Element }) => (
    <box
      flexShrink={0}
      border
      borderStyle="rounded"
      borderColor={props.color ?? theme.text.muted}
      title={` ${props.title} `}
      titleColor={props.color ?? theme.text.muted}
      paddingLeft={1}
      paddingRight={1}
    >
      {props.children}
    </box>
  )

  const meterText = (meter: Meter | null) => {
    if (!meter) return undefined
    const reset = resetText(meter.resets_at)
    if (meter.limit === 0) return `Tanpa batas · ${compact(meter.used)} token terpakai${reset ? ` · ${reset}` : ""}`
    return `${meter.percent}% · ${compact(meter.used)} / ${compact(meter.limit)} token${reset ? ` · ${reset}` : ""}`
  }
  const meterColor = (meter: Meter | null) =>
    !meter || meter.limit === 0 ? theme.text.base : meter.exhausted || meter.percent >= 90 ? bad() : meter.percent >= 70 ? warn() : ok()

  return (
    <DialogLayout
      header={<DialogHeader title="Status akun · Cipincode" onClose={() => dialog.clear()} />}
      footer={{ actions: { primary: actions() } }}
      legacyFooter={<DialogFooter actions={{ secondary: actions(), primary: [{ title: "tutup", key: "esc" }] }} />}
    >
      <scrollbox maxHeight={Math.max(8, dimensions().height - 12)} scrollbarOptions={{ visible: false }}>
      <box gap={1}>
        <Show
          when={!account.error}
          fallback={
            <Card title="Akun" color={bad()}>
              <Value color={bad()}>{(account.error as Error).message}</Value>
            </Card>
          }
        >
          <Show when={account()} fallback={<text fg={theme.text.muted}>Memuat status akun…</text>}>
            {(info) => (
              <>
                <Card title="Akun" color={ok()}>
                  <Row label="Nama">
                    <Value bold>{info().user.name}</Value>
                  </Row>
                  <Row label="Email">
                    <Value>{info().user.email}</Value>
                  </Row>
                  <Row label="Status">
                    <Value color={ok()}>Aktif</Value>
                  </Row>
                </Card>

                <Card title="Paket" color={info().usage.plan.name === "paid" ? ok() : warn()}>
                  <Row label="Paket">
                    <Value bold>{info().usage.plan.label}</Value>
                  </Row>
                  <Show when={expiry(info().usage.plan)}>
                    <Row label="Berlaku">
                      <Value>{expiry(info().usage.plan)}</Value>
                    </Row>
                  </Show>
                  <Row label="Batas request">
                    <Value>{info().usage.plan.requests_per_minute || "tanpa batas"} / menit</Value>
                  </Row>
                  <Row label="Cipin CLI">
                    <Show
                      when={info().usage.plan.name === "paid"}
                      fallback={<Value color={warn()}>Butuh paket Unlimited · cipincode.com/mbr/dashboard/topup</Value>}
                    >
                      <Value color={ok()}>Bisa dipakai</Value>
                    </Show>
                  </Row>
                </Card>

                <Card title="Kuota">
                  <Row label="Sesi 5 jam">
                    <Value color={meterColor(info().usage.session)}>{meterText(info().usage.session)}</Value>
                  </Row>
                  <Show when={info().usage.weekly}>
                    <Row label="Mingguan">
                      <Value color={meterColor(info().usage.weekly)}>{meterText(info().usage.weekly)}</Value>
                    </Row>
                  </Show>
                  <Show when={info().usage.tokens}>
                    <Row label="Total paket">
                      <Value color={meterColor(info().usage.tokens)}>{meterText(info().usage.tokens)}</Value>
                    </Row>
                  </Show>
                </Card>

                <Card title="Koneksi">
                  <Row label="Gateway">
                    <Value>{SITE.replace(/^https?:\/\//, "")}</Value>
                  </Row>
                  <Row label="Status">
                    <Value color={info().latencyMs > 2000 ? warn() : ok()}>Terhubung · {info().latencyMs} ms</Value>
                  </Row>
                  <Row label="Versi CLI">
                    <Value>
                      {VERSION} · {process.platform}-{process.arch}
                    </Value>
                  </Row>
                </Card>
              </>
            )}
          </Show>
        </Show>

        <Card title="Sesi ini">
          <Row label="Mode">
            <Value>{local.agent.current() ? local.agent.label(local.agent.current()!.id) : "-"}</Value>
          </Row>
          <Row label="Model">
            <Value>
              {local.model.parsed().model || "-"}
              {local.model.variant.current() ? ` · effort ${local.model.variant.current()}` : ""}
            </Value>
          </Row>
        </Card>

        <Show when={mcp().length > 0}>
          <Card title="MCP">
            <For each={mcp()}>
              {(item) => (
                <Row label={item.name}>
                  <Value color={item.status.status === "connected" ? ok() : item.status.status === "failed" ? bad() : warn()}>
                    {item.status.status === "connected" ? "Terhubung" : item.status.status}
                  </Value>
                </Row>
              )}
            </For>
          </Card>
        </Show>
      </box>
      </scrollbox>
    </DialogLayout>
  )
}
