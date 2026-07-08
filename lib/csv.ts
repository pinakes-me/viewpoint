// RFC 4180 준수 CSV 파서 (따옴표 필드 내 줄바꿈/쉼표/이스케이프된 따옴표 허용).
// scripts/*.mjs, app/analyze/page.tsx에 각각 따로 있던 것과 동일한 로직을 공용화.
// 절대 줄 단위 split만으로 파싱하지 말 것 — 이전에 실제 버그를 냈었다.

export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

export function parseCsvRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map(parseCsvLine);
}
