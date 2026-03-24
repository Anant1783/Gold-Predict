export interface MacroParams {
  rbiRepoRate: number;
  importDuty: number;
  mcxPremium: number;
  realInterestRates: number;
  dxy: number;
  centralBankDemand: number;
  geopoliticalRisk: number;
  inflation: number;
  oilPrices: number;
}

export interface PureGoldPurchase {
  id: string;
  date: string;
  amount: number; // in grams
  purchasePrice: number; // in INR/gm
}

export interface InventoryData {
  stock24k: number; // grams
  stock22k: number; // grams
  stock18k: number; // grams
  pureGoldPurchases: PureGoldPurchase[];
  holdingCost: number;
  liquidityRatio: number;
}

export interface NewsItem {
  id: string;
  headline: string;
  sentiment: number;
  category: string;
  timestamp: string;
}

export type MarketTrend = 'Bullish' | 'Bearish' | 'Volatile';
export type InventoryLevel = 'Low' | 'Balanced' | 'High';
export type ActionType = 'Aggressive Sale' | 'Gradual Accumulation' | 'Hedge' | 'Hold';
