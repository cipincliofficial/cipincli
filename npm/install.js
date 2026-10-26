#!/usr/bin/env node
// Downloads the Cipin CLI binary for this machine from the GitHub Release that matches this package's version.
const { createHash } = require("crypto")
const { spawnSync } = require("child_process")
const fs = require("fs")
const os = require("os")
const path = require("path")

const pkg = require("./package.json")
const REPO = "cipincliofficial/cipincli"
const BASE = (process.env.CIPIN_DOWNLOAD_BASE || `https://github.com/${REPO}/releases/download/v${pkg.version}`).replace(/\/+$/, "")

const platform = { darwin: "darwin", linux: "linux", win32: "windows" }[os.platform()]
const arch = { x64: "x64", arm64: "arm64" }[os.arch()]
const dest = path.join(__dirname, "bin", "native")
const binary = path.join(dest, platform === "windows" ? "cipin.exe" : "cipin")

async function download(url) {
  const response = await fetch(url, { redirect: "follow" })
  if (!response.ok) throw new Error(`${url} -> ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function ensureBinary() {
  if (!platform || !arch) throw new Error(`Platform ${os.platform()}-${os.arch()} belum didukung.`)
  if (fs.existsSync(binary)) return binary

  const asset = `cipin-${platform}-${arch}.tar.gz`
  console.log(`Cipin CLI ${pkg.version}: mengunduh ${asset}...`)

  const [archive, sums] = await Promise.all([download(`${BASE}/${asset}`), download(`${BASE}/SHA256SUMS`)])
  const expected = sums
    .toString("utf8")
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === asset)?.[0]
  const actual = createHash("sha256").update(archive).digest("hex")
  if (!expected || expected !== actual) throw new Error(`Checksum ${asset} tidak cocok, unduhan dibatalkan.`)

  fs.mkdirSync(dest, { recursive: true })
  const file = path.join(dest, asset)
  fs.writeFileSync(file, archive)
  const result = spawnSync("tar", ["xzf", file, "-C", dest], { stdio: "inherit" })
  fs.rmSync(file, { force: true })
  if (result.status !== 0) throw new Error("Gagal mengekstrak binary (perintah tar tidak tersedia?).")
  if (platform !== "windows") fs.chmodSync(binary, 0o755)
  return binary
}

module.exports = { ensureBinary, binary }

// Run as `postinstall`. Newer npm versions skip install scripts, so the launcher calls ensureBinary() on first run too.
if (require.main === module) {
  ensureBinary()
    .then(() => console.log("Selesai. Jalankan: cipin login"))
    .catch((error) => {
      console.error(`Cipin CLI belum terunduh (${error.message}). Akan dicoba lagi saat pertama dijalankan.`)
    })
}
