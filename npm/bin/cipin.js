#!/usr/bin/env node
const { spawn } = require("child_process")

const { ensureBinary } = require("../install.js")

ensureBinary()
  .then((binary) => {
    const child = spawn(binary, process.argv.slice(2), { stdio: "inherit" })
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => child.kill(signal))
    child.on("error", (error) => {
      console.error(error.message)
      process.exit(1)
    })
    child.on("exit", (code, signal) => {
      if (signal) process.kill(process.pid, signal)
      else process.exit(code ?? 0)
    })
  })
  .catch((error) => {
    console.error(`Cipin CLI gagal dipasang: ${error.message}`)
    console.error("Coba lagi, atau unduh manual dari https://github.com/cipincliofficial/cipincli/releases")
    process.exit(1)
  })
