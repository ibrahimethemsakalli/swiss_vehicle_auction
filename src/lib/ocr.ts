/** OCR is a suggestion, never evidence of ownership or identity. */
export function parseFahrzeugausweis(text: string) {
  const normalized = text.normalize('NFKC');
  const match = (pattern: RegExp) => normalized.match(pattern)?.[1]?.trim() ?? null;
  const date = match(
    /(?:1\.\s*Inverkehrssetzung|Premi[eè]re mise en circulation|Prima immatricolazione)\s*[:\n]?\s*(\d{2}\.\d{2}\.\d{4})/i,
  );
  let firstRegistration: string | null = null;
  if (date) {
    const [d, m, y] = date.split('.').map(Number);
    const value = new Date(Date.UTC(y, m - 1, d));
    if (value.getUTCFullYear() === y && value.getUTCMonth() === m - 1 && value.getUTCDate() === d)
      firstRegistration = value.toISOString().slice(0, 10);
  }
  return {
    stammnummer:
      match(
        /(?:Stammnummer|Num[eé]ro matricule|Numero di matricola)\s*[:\n]?\s*(\d{3}[. -]?\d{3}[. -]?\d{3})/i,
      )?.replace(/\D/g, '') ?? null,
    vinChassis:
      match(
        /(?:Fahrgestell[\s-]*(?:Nr\.?|nummer)|VIN|Ch[aâ]ssis|Telaio)\s*[:\n]?\s*([A-HJ-NPR-Z0-9]{17})\b/i,
      )?.toUpperCase() ?? null,
    firstRegistration,
    makeAndModel: match(/(?:Marke und Typ|Marque et type|Marca e tipo)\s*[:\n]?\s*([^\r\n]+)/i),
    cubicCapacity: match(/(?:Hubraum|Cylindr[eé]e|Cilindrata)\s*[:\n]?\s*(\d{2,5})/i),
    powerKw: match(/(?:Leistung|Puissance|Potenza)\s*[:\n]?\s*(\d{1,4}(?:[.,]\d+)?)\s*kW/i),
  };
}
