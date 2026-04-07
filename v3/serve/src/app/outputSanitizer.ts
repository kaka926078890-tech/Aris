const STAGE_HINT =
  '(语气|停顿|沉默|叹气|轻?笑|咳嗽|皱眉|点头|摇头|理解|认真|平静|温柔|直白|无奈|小声|低声|轻声|停了停|想了想)';

function stripStageDirectionsLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return line;

  // Full-line parenthetical stage direction, e.g. "（语气认真）" or "(停顿一下，语气平静)"
  const fullLine = new RegExp(
    `^[(（][^）)]{0,40}${STAGE_HINT}[^）)]{0,40}[)）]$`,
    'u',
  );
  if (fullLine.test(trimmed)) return '';

  // Inline parenthetical stage directions, e.g. "（语气认真）我懂你"
  const inline = new RegExp(
    `\\s*[(（][^）)]{0,40}${STAGE_HINT}[^）)]{0,40}[)）]\\s*`,
    'gu',
  );
  return line.replace(inline, ' ').replace(/\s{2,}/g, ' ');
}

/**
 * Sanitizes assistant output by removing "stage directions" like:
 * - （语气认真）
 * - （停顿一下，语气平静）
 *
 * This is intentionally narrow to avoid deleting meaningful parentheticals.
 */
export function sanitizeAssistantOutput(text: string): string {
  if (!text) return text;
  const lines = text.split('\n');
  const cleaned = lines
    .map((line) => stripStageDirectionsLine(line))
    .filter((line) => line !== '');

  // Normalize extra blank lines introduced by stripping.
  const normalized = cleaned
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return closeDanglingTail(normalized);
}

function closeDanglingTail(text: string): string {
  if (!text) return text;
  const trimmed = text.trimEnd();
  if (!trimmed) return trimmed;

  // Hard stop for common unfinished tails.
  if (
    /(我\.{3,}|我…{1,}|但是\.{3,}|但是…{1,}|所以\.{3,}|所以…{1,}|然后\.{3,}|然后…{1,})$/u.test(
      trimmed,
    )
  ) {
    return `${trimmed}先说到这。`;
  }

  // Unclosed quote/bracket with dangling ellipsis.
  if (/[“"（(][^”")）)]*$/.test(trimmed) && /(\.{3,}|…{1,})$/.test(trimmed)) {
    return `${trimmed}先说到这。`;
  }

  // Generic dangling punctuation endings.
  if (/[，、；：\-—]$/.test(trimmed)) return `${trimmed}。`;
  if (/(\.{3,}|…{1,})$/.test(trimmed)) return `${trimmed}先说到这。`;
  return trimmed;
}

