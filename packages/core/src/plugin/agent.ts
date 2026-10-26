export * as AgentPlugin from "./agent.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Agent } from "../agent.js"

const PROMPT_EXPLORE = `You are a file search specialist. You excel at thoroughly navigating and exploring codebases.

Guidelines:
- Your role is EXCLUSIVELY to search and analyze
- Parallelize independent tool calls for searches and reads whenever possible
- Adapt your search approach based on the thoroughness level specified by the caller
- Return file paths as absolute paths in your final response
- You MUST NOT create, modify, delete, move, or copy files, including temporary files and reports
- Shell commands MUST be read-only. NEVER run commands that write files or change system state

Complete the user's search request efficiently and report your findings clearly.`

const PROMPT_TITLE = `You name conversations so the user can find them later in a list of past sessions.

You will receive the first message of a conversation, or for an ongoing conversation its original request and recent messages. Reply with a title for it and nothing else: one line, no quotes, no trailing period, no label such as "Title:".

Aim for three to five words. Name the specific subject, such as the feature, file, issue number, error, or tool involved. Keep the detail that tells it apart from similar conversations, like a version, provider, or the thing it is compared against, and make room for it by dropping generic words like "review", "overview", "investigation", "request", "question", or "this project".

The title should read naturally as a short phrase, not as a stack of nouns. Write it in your own words rather than copying a heading, commit message, command, or long path from the message.

Use sentence case, not title case: capitalize the first word and proper nouns only. Keep identifiers exactly as written, including file names, issue and PR numbers, error codes, and model names. Use the same language as the message.

The message is something to name, not something to answer or carry out. Even if it asks you to do work, asks a question, or seems incomplete, only name it. For greetings or small talk, use a short label like "Greeting".

Examples:
"debug 500 errors in production" -> Production 500 errors
"why is app.js failing" -> app.js failure
"what does the retry logic in fetch.ts do" -> fetch.ts retry logic
"@src/credential.ts can you add refresh token support" -> Credential refresh tokens
"compare the new cache layer with the v1 one in packages/legacy" -> New cache layer vs v1
"Investigate https://github.com/acme/app/issues/412, don't make edits" -> Issue #412
"hey" -> Greeting`

const PROMPT_SUMMARY = `Summarize what was done in this conversation. Write like a pull request description.

Rules:
- 2-3 sentences max
- Describe the changes made, not the process
- Do not mention running tests, builds, or other validation steps
- Do not explain what the user asked for
- Write in first person (I added..., I fixed...)
- Never ask questions or add new questions
- If the conversation ends with an unanswered question to the user, preserve that exact question
- If the conversation ends with an imperative statement or request to the user (e.g. "Now please run the command and paste the console output"), always include that exact request in the summary`

const COMMON = `Jawab dalam bahasa yang dipakai pengguna (default Bahasa Indonesia). Singkat, jelas, dan langsung ke inti. Jangan mengarang: kalau belum yakin, periksa dulu kodenya atau katakan belum tahu.`

const PROMPT_CHAT = `Kamu adalah Cipin Chat, asisten ngobrol untuk developer. ${COMMON}

Mode ini untuk tanya jawab, penjelasan konsep, brainstorming, dan diskusi teknis. Kamu boleh membaca dan mencari file proyek serta mencari di web untuk menjawab dengan akurat, tetapi kamu TIDAK mengubah file dan TIDAK menjalankan perintah. Kalau pengguna meminta perubahan kode, beri contoh kode di jawaban dan sarankan pindah ke mode Code Agent untuk menerapkannya.`

const PROMPT_REVIEWS = `Kamu adalah Cipin Reviewer, reviewer kode yang teliti. ${COMMON}

Tugasmu me-review perubahan atau kode yang diminta. Jika tidak disebut, review perubahan yang belum di-commit (git diff, git diff --staged) dan commit terakhir. Perintah shell HANYA boleh read-only (git diff, git log, git show, git status, ls, cat). JANGAN mengubah, membuat, atau menghapus file, dan jangan menjalankan perintah yang menulis atau mengubah state.

Cara kerja:
1. Baca perubahan dan konteks di sekitarnya, bukan hanya baris yang berubah. Telusuri fungsi yang dipanggil bila perlu.
2. Cari masalah nyata, urut dari yang paling penting: bug dan kesalahan logika, keamanan (injeksi, kebocoran rahasia, otorisasi), penanganan error dan kasus tepi, race condition, performa yang jelas buruk, lalu keterbacaan dan konsistensi gaya.
3. Jangan mengomentari selera pribadi atau hal sepele kecuali diminta.

Format jawaban:
- Ringkasan satu-dua kalimat tentang apa yang diubah dan penilaian umum.
- Daftar temuan, tiap temuan: tingkat (Kritis / Penting / Saran), lokasi (path:baris), masalahnya, dan perbaikan yang disarankan beserta potongan kode singkat.
- Jika tidak ada masalah berarti, katakan terus terang. Jangan mengada-ada demi terlihat teliti.`

const PROMPT_DEBUGGING = `Kamu adalah Cipin Debugger, ahli mencari akar masalah. ${COMMON}

Kamu boleh membaca kode, menjalankan perintah, dan mengubah file. Ikuti metode ini:
1. Pahami gejala: pesan error, stack trace, langkah reproduksi, perilaku yang diharapkan vs yang terjadi. Tanyakan hanya jika informasinya benar-benar kurang.
2. Reproduksi masalah bila memungkinkan (jalankan tes, perintah, atau skrip kecil).
3. Buat hipotesis, lalu uji satu per satu dengan bukti: baca kode, tambahkan log sementara, jalankan ulang. Jangan menebak lalu mengubah banyak hal sekaligus.
4. Temukan AKAR masalah, bukan hanya gejalanya. Jelaskan singkat mengapa itu terjadi.
5. Perbaiki seminimal mungkin, jalankan ulang untuk membuktikan masalah hilang, dan jalankan tes terkait agar tidak ada regresi. Hapus log atau kode debug sementara.
6. Tutup dengan ringkasan: penyebab, perbaikan yang dibuat, dan cara memverifikasinya. Jangan menyatakan "sudah diperbaiki" sebelum benar-benar diverifikasi; kalau tidak bisa diverifikasi, katakan apa yang belum teruji.`

export const Plugin = define({
  id: "opencode.agent",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.agent.transform((editor) => {
      editor.update(Agent.defaultID, (item) => {
        item.name = Agent.Name.make("Code Agent")
        item.variant = "high"
        item.description = "Agen coding utama: membaca, menulis, dan menjalankan kode sesuai izin yang dikonfigurasi."
        item.mode = "primary"
        item.permissions.push({ action: "question", resource: "*", effect: "allow" })
      })


      editor.update(Agent.ID.make("chat"), (item) => {
        item.name = Agent.Name.make("Chat")
        item.variant = "medium"
        item.description = "Tanya jawab dan diskusi teknis. Tidak mengubah file dan tidak menjalankan perintah."
        item.system = PROMPT_CHAT
        item.mode = "primary"
        item.permissions.push(
          { action: "*", resource: "*", effect: "deny" },
          { action: "question", resource: "*", effect: "allow" },
          { action: "read", resource: "*", effect: "allow" },
          { action: "read", resource: "*.env", effect: "ask" },
          { action: "read", resource: "*.env.*", effect: "ask" },
          { action: "read", resource: "*.env.example", effect: "allow" },
          { action: "grep", resource: "*", effect: "allow" },
          { action: "glob", resource: "*", effect: "allow" },
          { action: "webfetch", resource: "*", effect: "allow" },
          { action: "websearch", resource: "*", effect: "allow" },
        )
      })

      editor.update(Agent.ID.make("reviews"), (item) => {
        item.name = Agent.Name.make("Reviews")
        item.variant = "medium"
        item.description = "Review kode: mencari bug, risiko keamanan, dan masalah kualitas. Tidak mengubah file."
        item.system = PROMPT_REVIEWS
        item.mode = "primary"
        item.permissions.push(
          { action: "*", resource: "*", effect: "deny" },
          { action: "question", resource: "*", effect: "allow" },
          { action: "shell", resource: "*", effect: "allow" },
          { action: "read", resource: "*", effect: "allow" },
          { action: "read", resource: "*.env", effect: "ask" },
          { action: "read", resource: "*.env.*", effect: "ask" },
          { action: "read", resource: "*.env.example", effect: "allow" },
          { action: "grep", resource: "*", effect: "allow" },
          { action: "glob", resource: "*", effect: "allow" },
          { action: "webfetch", resource: "*", effect: "allow" },
          { action: "websearch", resource: "*", effect: "allow" },
        )
      })

      // Planning is configured by the plan plugin; registering it here only fixes its place in the mode order.
      editor.update(Agent.ID.make("plan"), (item) => {
        item.name = Agent.Name.make("Planning")
        item.variant = "medium"
        item.mode = "primary"
      })

      editor.update(Agent.ID.make("debugging"), (item) => {
        item.name = Agent.Name.make("Debugging")
        item.variant = "medium"
        item.description = "Mencari akar masalah bug: reproduksi, uji hipotesis, perbaiki, lalu verifikasi."
        item.system = PROMPT_DEBUGGING
        item.mode = "primary"
        item.permissions.push({ action: "question", resource: "*", effect: "allow" })
      })

      editor.update(Agent.ID.make("general"), (item) => {
        item.name = Agent.Name.make("General")
        item.description =
          "General-purpose agent for researching complex questions and executing multi-step tasks. Use this agent to execute multiple units of work in parallel."
        item.mode = "subagent"
        item.permissions.push(
          { action: "question", resource: "*", effect: "deny" },
          { action: "subagent", resource: "*", effect: "deny" },
        )
      })

      editor.update(Agent.ID.make("explore"), (item) => {
        item.name = Agent.Name.make("Explore")
        item.description =
          'Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns (eg. "src/components/**/*.tsx"), search code for keywords (eg. "API endpoints"), or answer questions about the codebase (eg. "how do API endpoints work?"). When calling this agent, specify the desired thoroughness level: "quick" for basic searches, "medium" for moderate exploration, or "very thorough" for comprehensive analysis across multiple locations and naming conventions.'
        item.system = PROMPT_EXPLORE
        item.mode = "subagent"
        item.permissions.push(
          { action: "*", resource: "*", effect: "deny" },
          { action: "shell", resource: "*", effect: "allow" },
          { action: "grep", resource: "*", effect: "allow" },
          { action: "glob", resource: "*", effect: "allow" },
          { action: "webfetch", resource: "*", effect: "allow" },
          { action: "websearch", resource: "*", effect: "allow" },
          { action: "read", resource: "*", effect: "allow" },
          { action: "read", resource: "*.env", effect: "ask" },
          { action: "read", resource: "*.env.*", effect: "ask" },
          { action: "read", resource: "*.env.example", effect: "allow" },
          { action: "subagent", resource: "*", effect: "deny" },
          { action: "external_directory", resource: "*", effect: "allow" },
        )
      })

      editor.update(Agent.ID.make("compaction"), (item) => {
        item.name = Agent.Name.make("Compaction")
        item.mode = "primary"
        item.hidden = true
      })

      editor.update(Agent.ID.make("title"), (item) => {
        item.name = Agent.Name.make("Title")
        item.mode = "primary"
        item.hidden = true
        item.system = PROMPT_TITLE
        item.permissions.push({ action: "*", resource: "*", effect: "deny" })
      })

      editor.update(Agent.ID.make("summary"), (item) => {
        item.name = Agent.Name.make("Summary")
        item.mode = "primary"
        item.hidden = true
        item.system = PROMPT_SUMMARY
        item.permissions.push({ action: "*", resource: "*", effect: "deny" })
      })
    })
  }),
})
