#!/usr/bin/env node
import { spawn } from "node:child_process"

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm"
const dryRun = process.argv.includes("--dry-run")

const steps = [
  {
    title: "Dependencias Node",
    detail: "Instala pacotes Electron, React, TypeScript e ferramentas do projeto.",
    command: npmCommand,
    args: ["install"]
  },
  {
    title: "Readium CLI",
    detail: "Baixa o binario Readium CLI da plataforma atual para vendor/readium/.",
    command: npmCommand,
    args: ["run", "download:readium-cli"]
  },
  {
    title: "Runtime Python e sidecars TTS",
    detail: "Prepara o Python local e instala as dependencias dos sidecars de audio.",
    command: npmCommand,
    args: ["run", "setup:python-tts", "--", "--install-sidecars"]
  },
  {
    title: "Modelos TTS",
    detail: "Baixa ou prepara os modelos locais de TTS configurados pelo projeto.",
    command: npmCommand,
    args: ["run", "download:tts-models"]
  }
]

console.log("DreamReader setup de desenvolvimento")
console.log(`Total de fases: ${steps.length}`)
if (dryRun) {
  console.log("Modo dry-run: nenhum comando sera executado.")
}

for (const [index, step] of steps.entries()) {
  const phase = `${index + 1}/${steps.length}`
  console.log("")
  console.log(`==> Fase ${phase}: ${step.title}`)
  console.log(`    ${step.detail}`)
  console.log(`    $ ${formatCommand(step.command, step.args)}`)

  if (!dryRun) {
    await run(step.command, step.args)
  }
}

console.log("")
console.log("Setup de desenvolvimento concluido.")

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit"
    })
    child.on("error", reject)
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(signal ? `${command} exited with signal ${signal}` : `${command} exited with code ${code ?? "unknown"}`))
    })
  })
}

function formatCommand(command, args) {
  const displayCommand = command === "npm.cmd" ? "npm" : command
  return [displayCommand, ...args].map(quoteIfNeeded).join(" ")
}

function quoteIfNeeded(value) {
  return /\s/.test(value) ? JSON.stringify(value) : value
}
