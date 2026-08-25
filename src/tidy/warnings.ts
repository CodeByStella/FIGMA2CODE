import { addWarning } from "../convert/warnings";

const tidyNotes: string[] = [];

export function tidyWarn(message: string): void {
  tidyNotes.push(message);
  addWarning(`[tidy] ${message}`);
}

export function takeTidyWarnings(): string[] {
  const out = [...tidyNotes];
  tidyNotes.length = 0;
  return out;
}

export function clearTidyWarnings(): void {
  tidyNotes.length = 0;
}
