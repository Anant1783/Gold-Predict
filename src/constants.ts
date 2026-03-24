import { MacroParams } from "./types";

export const INITIAL_MACRO_PARAMS: MacroParams = {
  rbiRepoRate: 6.5,
  importDuty: 15, // Standard Indian import duty on gold
  mcxPremium: 250, // Premium/Discount on MCX vs Spot
  realInterestRates: 3.6,
  dxy: 104.5,
  centralBankDemand: 750,
  geopoliticalRisk: 0.65,
  inflation: 2.7,
  oilPrices: 115,
};

export const MACRO_WEIGHTS = {
  rbiRepoRate: -0.5,
  importDuty: 1.0, // Direct impact on local price
  mcxPremium: 0.8,
  realInterestRates: -0.7,
  dxy: -0.4,
  centralBankDemand: 0.3,
  geopoliticalRisk: 0.2,
  inflation: 0.2,
  oilPrices: 0.1,
};

export const BASE_PRICE = 4400; // USD/oz
export const JAN_HIGH = 5595;

export const USD_INR_RATE = 88.5;
export const GRAMS_PER_OZ = 31.1035;

export const convertToINRPerGram = (usdPerOz: number, duty: number = 15) => {
  const baseInr = (usdPerOz * USD_INR_RATE) / GRAMS_PER_OZ;
  const withDuty = baseInr * (1 + duty / 100);
  return withDuty;
};
