import galleries from '../data/sample-photos.json';
import type { VehicleSpecs } from './vehicle-specs';
export const sampleDescription =
  'Fiktives Inserat: Modell und Jahr laut Fotoquelle; unbekannte Angaben nicht verifiziert. Preis, Kilometerstand, Standort und Kennnummern sind Testdaten.\nAnnonce fictive : modèle et année selon la source photo ; données inconnues non vérifiées. Prix, kilométrage, lieu et identifiants fictifs.\nAnnuncio fittizio: modello e anno dalla fonte fotografica; dati sconosciuti non verificati. Prezzo, chilometraggio, località e identificativi fittizi.\nFictional sample: source-stated model and year; unknown details are not verified. Price, mileage, location and identifiers are test data.';

// Transcribed from the selected Commons file titles, not from capture dates.
// Colour/body shape are visually observable; trim names do not prove optional equipment.
const facts = [
  ['Volkswagen', 'Golf Style 1.5', 2020, 'SILVER', 'HATCHBACK'],
  ['BMW', '320d Touring Luxury Line (G21)', null, 'GREY', 'ESTATE'],
  ['Mercedes-Benz', 'C 220 d (W205)', 2016, 'BLACK', 'SEDAN'],
  ['Audi', 'Q5 40 TDI quattro S-line Black Edition', null, 'WHITE', 'SUV'],
  ['Škoda', 'Octavia IV Combi RS', null, 'GREEN', 'ESTATE'],
  ['Toyota', 'Yaris Design HEV CVT 1.5', 2020, 'RED', 'HATCHBACK'],
  ['Volvo', 'XC60 R-Design D5 P-Pulse 2.0', 2018, 'SILVER', 'SUV'],
  ['Renault', 'Clio Play TCe 1.0 (100 PS)', 2020, 'BLUE', 'HATCHBACK'],
  ['Porsche', '718 Cayman S S-A 2.5', 2018, 'GREY', 'COUPE'],
  ['Tesla', 'Model 3', 2021, 'WHITE', 'SEDAN'],
  ['Fiat', '500 1.0 GSE Hybrid (Facelift)', null, 'WHITE', 'HATCHBACK'],
  ['Subaru', 'Outback', 2020, 'RED', 'ESTATE'],
] as const;

export function sampleFacts(index: number) {
  const fact = facts[index - 1];
  if (!fact) throw Error('Unknown sample vehicle');
  const [make, model, modelYear, exteriorColor, bodyType] = fact;
  return {
    make,
    model,
    modelYear,
    firstRegistration: null,
    description: sampleDescription,
    exteriorColor,
    bodyType,
    // No document or equipment inventory accompanies these photographs.
    equipment: [] as string[],
    interiorColor: null,
    energyClass: null,
    euroNorm: null,
    fuelType: null,
    transmission: null,
    drivetrain: null,
    condition: null,
    accidentHistory: null,
    warranty: null,
    fuelConsumption: null,
    electricConsumption: null,
    co2Emissions: null,
    rangeKm: null,
    batteryCapacity: null,
    seats: null,
    doors: null,
    powerKw: null,
    cubicCapacity: null,
  } satisfies VehicleSpecs & {
    make: string;
    model: string;
    modelYear: number | null;
    firstRegistration: null;
    powerKw: null;
    cubicCapacity: null;
    description: string;
  };
}

export function sampleSource(images: string[]) {
  return galleries.find((g) => g.photos.some((p) => images.includes(p.src)))?.photos[0].sourceUrl;
}
