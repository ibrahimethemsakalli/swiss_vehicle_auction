export const csvColumns = [
  'make',
  'model',
  'firstRegistration',
  'modelYear',
  'mileage',
  'canton',
  'city',
  'postalCode',
  'vinChassis',
  'stammnummer',
  'startPrice',
  'buyNowPrice',
  'listingType',
  'fuelType',
  'transmission',
] as const;
export const dealerTemplate =
  csvColumns.join(',') + '\nExample,Model,,,,ZH,Zurich,8000,,,1000,,AUCTION_7_DAYS,,\n';
export const csvAllowedValues =
  'listingType: AUCTION_7_DAYS | FIXED_PRICE_OFFERS\nfuelType: PETROL | DIESEL | HYBRID | PLUGIN_HYBRID | ELECTRIC | LPG | HYDROGEN\ntransmission: MANUAL | AUTOMATIC | SEMI_AUTOMATIC';
