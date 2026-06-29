// Shelf Bin-Packing für die 2D-Anordnung der Komponenten.
//
// Eingabe: array of { w, h } in Modell-Einheiten (mm).
// Ausgabe: array of { x, y } passend zu den Eingabe-Indizes.
//
// Sortiert intern nach Höhe absteigend, legt zeilenweise von links nach rechts,
// neue Zeile sobald maxWidth überschritten wäre. Padding zwischen Bahnen ist
// konfigurierbar – Standardwert 20 mm reicht für Schneidemarken.

export function shelfPack(boxes, { maxWidth = 1500, padding = 20 } = {}) {
  const indexed = boxes.map((b, i) => ({ w: b.w, h: b.h, originalIdx: i }));
  indexed.sort((a, b) => b.h - a.h);

  const result = new Array(boxes.length);
  let x = 0, y = 0, rowHeight = 0;
  for (const b of indexed) {
    if (x + b.w > maxWidth && x > 0) {
      x = 0;
      y += rowHeight + padding;
      rowHeight = 0;
    }
    result[b.originalIdx] = { x, y };
    x += b.w + padding;
    if (b.h > rowHeight) rowHeight = b.h;
  }
  return result;
}
