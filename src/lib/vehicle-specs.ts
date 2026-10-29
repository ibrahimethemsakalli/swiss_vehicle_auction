// Shared catalogue fields for validation, forms, details and search. Unknown values stay null.
export const specOptions = {
  interiorColor: ['BLACK', 'WHITE', 'GREY', 'BROWN', 'BEIGE', 'OTHER'],
  energyClass: ['ENERGY_A', 'ENERGY_B', 'ENERGY_C', 'ENERGY_D', 'ENERGY_E', 'ENERGY_F', 'ENERGY_G'],
  euroNorm: ['EURO_1', 'EURO_2', 'EURO_3', 'EURO_4', 'EURO_5', 'EURO_6'],
  fuelType: ['PETROL', 'DIESEL', 'HYBRID', 'PLUGIN_HYBRID', 'ELECTRIC', 'LPG', 'HYDROGEN'],
  transmission: ['MANUAL', 'AUTOMATIC', 'SEMI_AUTOMATIC'],
  bodyType: ['HATCHBACK', 'SEDAN', 'ESTATE', 'SUV', 'COUPE', 'CONVERTIBLE', 'VAN', 'PICKUP'],
  drivetrain: ['FWD', 'RWD', 'AWD'],
  condition: ['USED', 'NEW', 'DEMONSTRATOR', 'CLASSIC'],
  exteriorColor: [
    'BLACK',
    'WHITE',
    'GREY',
    'SILVER',
    'BLUE',
    'RED',
    'GREEN',
    'BROWN',
    'BEIGE',
    'YELLOW',
    'OTHER',
  ],
  accidentHistory: ['ACCIDENT_FREE', 'REPAIRED', 'DAMAGED', 'UNKNOWN'],
  warranty: ['YES', 'NO'],
} as const;
export const specNumbers = {
  fuelConsumption: [0, 100, 0.1, 'L/100 km'],
  electricConsumption: [0, 200, 0.1, 'kWh/100 km'],
  co2Emissions: [0, 2000, 1, 'g/km'],
  rangeKm: [0, 2000, 1, 'km'],
  batteryHealth: [0, 100, 0.1, '%'],
  batteryCapacity: [0, 500, 0.1, 'kWh'],
  seats: [1, 30, 1, ''],
  doors: [1, 8, 1, ''],
} as const;
export type VehicleSpecs = {
  interiorColor?: (typeof specOptions.interiorColor)[number] | null;
  energyClass?: (typeof specOptions.energyClass)[number] | null;
  euroNorm?: (typeof specOptions.euroNorm)[number] | null;
  equipment?: string[];
  fuelType?: (typeof specOptions.fuelType)[number] | null;
  transmission?: (typeof specOptions.transmission)[number] | null;
  bodyType?: (typeof specOptions.bodyType)[number] | null;
  drivetrain?: (typeof specOptions.drivetrain)[number] | null;
  condition?: (typeof specOptions.condition)[number] | null;
  exteriorColor?: (typeof specOptions.exteriorColor)[number] | null;
  accidentHistory?: (typeof specOptions.accidentHistory)[number] | null;
  warranty?: (typeof specOptions.warranty)[number] | null;
  fuelConsumption?: number | null;
  electricConsumption?: number | null;
  co2Emissions?: number | null;
  rangeKm?: number | null;
  batteryCapacity?: number | null;
  batteryHealth?: number | null;
  seats?: number | null;
  doors?: number | null;
};

export const equipmentOptions = [
  'AIR_CONDITIONING',
  'NAVIGATION',
  'PARKING_SENSORS',
  'REAR_CAMERA',
  'CRUISE_CONTROL',
  'ADAPTIVE_CRUISE',
  'HEATED_SEATS',
  'LEATHER_SEATS',
  'SUNROOF',
  'LED_LIGHTS',
  'CARPLAY',
  'ANDROID_AUTO',
  'TOW_BAR',
  'ISOFIX',
] as const;
