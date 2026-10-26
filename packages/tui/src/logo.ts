// Block letters in the original TUI logo's style. Every glyph has four rows; capitals start on the lower half of the first row.
// Markers: "_" shaded blank, "^" shaded upper half, "~" shadow upper half, "," shadow lower half.
const GLYPHS: Record<string, readonly string[]> = {
  C: [" ▄▄ ", "█__▀", "█__▄", " ▀▀ "],
  I: ["▄▄▄", " █ ", " █ ", "▀▀▀"],
  P: ["▄▄▄ ", "█__█", "█▀▀ ", "▀   "],
  N: ["▄  ▄", "█▀▄█", "█__█", "▀  ▀"],
  O: [" ▄▄ ", "█__█", "█__█", " ▀▀ "],
  D: ["▄▄▄ ", "█__█", "█__█", "▀▀▀ "],
  E: ["▄▄▄▄", "█___", "█▀▀ ", "▀▀▀▀"],
}

function word(text: string): string[] {
  return [0, 1, 2, 3].map((row) =>
    Array.from(text)
      .map((letter) => {
        const glyph = GLYPHS[letter]
        const width = Math.max(...glyph.map((line) => line.length))
        return glyph[row].padEnd(width)
      })
      .join(" "),
  )
}

// "cipin" in the first half (drawn in the brand purple), "code" in the bright second half.
export const logo = {
  left: word("CIPIN"),
  right: word("CODE"),
}

// The two-letter mark behind the quota dialog's animation and in the mini splash: C and P.
export const go = {
  left: ["    ", "█▀▀▀", "█___", "▀▀▀▀"],
  right: ["    ", "█▀▀█", "█__█", "█▀▀▀"],
}
