import React, { useState, useEffect, useMemo } from 'react';
import { 
  TrendingDown, TrendingUp, AlertTriangle, 
  BarChart3, Settings, ShieldCheck, 
  Newspaper, Package, Activity,
  ChevronRight, Info, Globe, IndianRupee,
  Plus, Trash2, Calendar, TrendingUp as ProfitIcon
} from 'lucide-react';
import { 
  XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell, Line
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type } from "@google/genai";
import { cn } from './lib/utils';
import { 
  MacroParams, InventoryData, 
  NewsItem, MarketTrend, InventoryLevel, ActionType, PureGoldPurchase 
} from './types';
import { 
  INITIAL_MACRO_PARAMS, MACRO_WEIGHTS, 
  BASE_PRICE, JAN_HIGH, USD_INR_RATE, GRAMS_PER_OZ, convertToINRPerGram
} from './constants';

// --- Technical Indicators ---
const calculateSMA = (data: any[], period: number) => {
  return data.map((val, index) => {
    if (index < period - 1) return { ...val, sma: null };
    const slice = data.slice(index - period + 1, index + 1);
    const sum = slice.reduce((acc, curr) => acc + curr.inrPrice, 0);
    return { ...val, sma: Math.round(sum / period) };
  });
};

const calculateRSI = (data: any[], period: number) => {
  let gains = 0;
  let losses = 0;

  return data.map((val, index) => {
    if (index === 0) return { ...val, rsi: null };
    const change = val.inrPrice - data[index - 1].inrPrice;
    if (change > 0) gains += change;
    else losses += Math.abs(change);

    if (index < period) return { ...val, rsi: null };

    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    // Reset for next window (simplified RSI)
    const nextChange = data[index + 1] ? data[index + 1].inrPrice - val.inrPrice : 0;
    const oldestChange = data[index - period + 1] ? data[index - period + 1].inrPrice - (data[index - period] ? data[index - period].inrPrice : data[index - period + 1].inrPrice) : 0;
    if (oldestChange > 0) gains -= oldestChange;
    else losses -= Math.abs(oldestChange);

    if (avgLoss === 0) return { ...val, rsi: 100 };
    const rs = avgGain / avgLoss;
    return { ...val, rsi: Math.round(100 - (100 / (1 + rs))) };
  });
};

// --- Price History & Forecast Generator ---
const generatePriceData = (expectedPriceUsd: number, duty: number, livePriceOffset: number = 0) => {
  const data = [];
  const today = new Date();
  
  // History (Last 60 days)
  for (let i = 60; i >= 1; i--) {
    const date = new Date();
    date.setDate(today.getDate() - i);
    const progress = (60 - i) / 60;
    const trend = JAN_HIGH - (JAN_HIGH - BASE_PRICE) * progress;
    const volatility = (Math.random() - 0.5) * 100;
    const usdPrice = trend + volatility;
    data.push({
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      inrPrice: Math.round(convertToINRPerGram(usdPrice, duty)) + livePriceOffset,
      isForecast: false,
    });
  }

  // Forecast (Next 30 days) - Starts AFTER present day
  const currentInr = convertToINRPerGram(BASE_PRICE, duty) + livePriceOffset;
  const targetInr = convertToINRPerGram(expectedPriceUsd, duty);
  
  for (let i = 1; i <= 30; i++) {
    const date = new Date();
    date.setDate(today.getDate() + i);
    const progress = i / 30;
    // Smooth transition to expected price
    const forecastPrice = currentInr + (targetInr - currentInr) * progress;
    const noise = (Math.random() - 0.5) * 50 * (1 - progress); 
    data.push({
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      inrPrice: Math.round(forecastPrice + noise),
      isForecast: true,
    });
  }
  return data;
};

export default function App() {
  // --- State ---
  const [macro, setMacro] = useState<MacroParams>(INITIAL_MACRO_PARAMS);
  const [inventory, setInventory] = useState<InventoryData>({
    stock24k: 500,
    stock22k: 1200,
    stock18k: 350,
    pureGoldPurchases: [
      { id: '1', date: '2026-02-15', amount: 100, purchasePrice: 12500 },
      { id: '2', date: '2026-03-01', amount: 200, purchasePrice: 13200 },
    ],
    holdingCost: 1.2,
    liquidityRatio: 0.4,
  });
  const [news, setNews] = useState<NewsItem[]>([
    { id: '1', headline: "BlackRock increases gold allocation in Q1 2026 report", sentiment: 0.7, category: 'Institutional Report', timestamp: '1h ago' },
    { id: '2', headline: "RBI holds repo rate at 6.5% amid inflation concerns", sentiment: -0.2, category: 'Central Bank Action', timestamp: '4h ago' },
    { id: '3', headline: "Goldman Sachs predicts $5,000/oz by year-end", sentiment: 0.9, category: 'Institutional Report', timestamp: '1d ago' },
  ]);
  const [newHeadline, setNewHeadline] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showIndicators, setShowIndicators] = useState(false);
  const [livePriceOffset, setLivePriceOffset] = useState(0);
  const [isFetchingMacro, setIsFetchingMacro] = useState(false);

  // --- Live Updates ---
  useEffect(() => {
    const interval = setInterval(() => {
      // Simulate minute-by-minute price fluctuation (+/- 5 INR)
      setLivePriceOffset(prev => prev + (Math.random() - 0.5) * 10);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // --- Auto-fetch Macro Data ---
  const fetchLiveMacroData = async (retryCount = 0) => {
    setIsFetchingMacro(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview", // Use Pro for more reliable search grounding
        contents: "Find the current live values for: 1. US 10-Year Real Interest Rate (TIPS), 2. US Dollar Index (DXY), 3. MCX Gold Premium/Discount in India (INR per gram), 4. Geopolitical Risk Index (GPR). Return the data strictly as a JSON object with keys: realInterestRates, dxy, mcxPremium, geopoliticalRisk.",
        config: {
          tools: [{ googleSearch: {} }],
          // Removing responseMimeType and responseSchema to avoid potential conflicts with search grounding
        }
      });
      
      const text = response.text || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        setMacro(prev => ({
          ...prev,
          ...result
        }));
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (error) {
      console.error("Failed to fetch live macro data:", error);
      // Retry logic for transient 500 errors
      if (retryCount < 2) {
        const delay = (retryCount + 1) * 3000;
        console.log(`Retrying macro fetch in ${delay}ms...`);
        setTimeout(() => fetchLiveMacroData(retryCount + 1), delay);
      }
    } finally {
      setIsFetchingMacro(false);
    }
  };

  useEffect(() => {
    fetchLiveMacroData();
    const interval = setInterval(fetchLiveMacroData, 300000); // Every 5 mins
    return () => clearInterval(interval);
  }, []);

  // --- Calculations ---
  const aggregateSentiment = useMemo(() => {
    if (news.length === 0) return 0;
    return news.reduce((acc, item) => acc + item.sentiment, 0) / news.length;
  }, [news]);

  const expectedPrice = useMemo(() => {
    const rateImpact = (macro.realInterestRates - 3.5) * MACRO_WEIGHTS.realInterestRates * 500;
    const rbiImpact = (macro.rbiRepoRate - 6.5) * MACRO_WEIGHTS.rbiRepoRate * 1000;
    const dxyImpact = (macro.dxy - 100) * MACRO_WEIGHTS.dxy * 100;
    const demandImpact = (macro.centralBankDemand - 700) * MACRO_WEIGHTS.centralBankDemand * 2;
    const gprImpact = macro.geopoliticalRisk * MACRO_WEIGHTS.geopoliticalRisk * 1000;
    
    const sentimentImpact = aggregateSentiment * 400; // Increased weight for institutional news
    
    return Math.round(BASE_PRICE + rateImpact + rbiImpact + dxyImpact + demandImpact + gprImpact + sentimentImpact);
  }, [macro, aggregateSentiment]);

  const priceData = useMemo(() => {
    let data = generatePriceData(expectedPrice, macro.importDuty, livePriceOffset);
    if (showIndicators) {
      data = calculateSMA(data, 14);
      data = calculateRSI(data, 14);
    }
    return data;
  }, [expectedPrice, macro.importDuty, livePriceOffset, showIndicators]);

  const currentInrPrice = convertToINRPerGram(BASE_PRICE, macro.importDuty) + livePriceOffset;

  const inventoryValuation = useMemo(() => {
    return inventory.pureGoldPurchases.map(p => ({
      date: p.date,
      purchasePrice: p.purchasePrice,
      currentPrice: Math.round(currentInrPrice),
      profitPerGram: Math.round(currentInrPrice - p.purchasePrice),
      amount: p.amount
    }));
  }, [inventory.pureGoldPurchases, currentInrPrice]);

  const marketTrend: MarketTrend = useMemo(() => {
    if (expectedPrice > BASE_PRICE * 1.05) return 'Bullish';
    if (expectedPrice < BASE_PRICE * 0.95) return 'Bearish';
    return 'Volatile';
  }, [expectedPrice]);

  const inventoryLevel: InventoryLevel = useMemo(() => {
    const totalStock = inventory.stock24k + inventory.stock22k + inventory.stock18k;
    if (totalStock > 2500) return 'High';
    if (totalStock < 1000) return 'Low';
    return 'Balanced';
  }, [inventory]);

  const decision = useMemo((): { action: ActionType; reason: string } => {
    if (marketTrend === 'Bearish') {
      if (inventoryLevel === 'High') return { action: 'Aggressive Sale', reason: 'Overstocked in a bear market. Convert metal to cash.' };
      return { action: 'Hold', reason: 'Maintain minimum stock levels during bear phase.' };
    }
    if (marketTrend === 'Bullish') {
      if (inventoryLevel === 'Low') return { action: 'Gradual Accumulation', reason: 'Buy 5-10% on every 2% dip for Q4 rally.' };
      return { action: 'Hold', reason: 'Market is rising, but inventory is sufficient.' };
    }
    return { action: 'Hedge', reason: 'High volatility. Short equivalent amount on MCX to lock value.' };
  }, [marketTrend, inventoryLevel]);

  // --- Actions ---
  const analyzeSentiment = async () => {
    if (!newHeadline.trim()) return;
    setIsAnalyzing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Analyze the following gold market headline, specifically looking for institutional reports (BlackRock, Goldman, etc.), quarterly/monthly/yearly financial reports, or central bank news.
        1. Assign a sentiment score between -1 (highly bearish) and 1 (highly bullish).
        2. Categorize it into one of these themes: 'Institutional Report', 'Fed Hawkish', 'Fed Dovish', 'BRICS Currency', 'Ceasefire', 'Geopolitical Tension', 'Inflation Data', 'Central Bank Action', or 'Other'.
        
        Headline: "${newHeadline}"
        
        Return the result as a JSON object with keys "sentiment" (number) and "category" (string).`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              sentiment: { type: Type.NUMBER },
              category: { type: Type.STRING }
            },
            required: ["sentiment", "category"]
          }
        }
      });
      
      const result = JSON.parse(response.text.trim());
      const newItem: NewsItem = {
        id: Date.now().toString(),
        headline: newHeadline,
        sentiment: result.sentiment,
        category: result.category,
        timestamp: 'Just now',
      };
      setNews([newItem, ...news]);
      setNewHeadline('');
    } catch (error) {
      console.error("Sentiment analysis failed:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const addPurchase = () => {
    const newP: PureGoldPurchase = {
      id: Date.now().toString(),
      date: new Date().toISOString().split('T')[0],
      amount: 0,
      purchasePrice: Math.round(currentInrPrice)
    };
    setInventory({ ...inventory, pureGoldPurchases: [...inventory.pureGoldPurchases, newP] });
  };

  const removePurchase = (id: string) => {
    setInventory({ ...inventory, pureGoldPurchases: inventory.pureGoldPurchases.filter(p => p.id !== id) });
  };

  const updatePurchase = (id: string, field: keyof PureGoldPurchase, value: any) => {
    setInventory({
      ...inventory,
      pureGoldPurchases: inventory.pureGoldPurchases.map(p => p.id === id ? { ...p, [field]: value } : p)
    });
  };

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <ShieldCheck className="text-yellow-500 w-8 h-8" />
            Gold India Predict <span className="text-slate-400 font-light">2026</span>
          </h1>
          <p className="text-slate-500 mt-1">Indian Retail Jewelry Optimization & Institutional Sentiment Model</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="label-micro">Spot (USD/oz)</p>
              <p className="text-2xl font-mono font-bold text-slate-900">${BASE_PRICE}</p>
            </div>
            <div className="text-right">
              <p className="label-micro">Spot (INR/gm)</p>
              <p className="text-2xl font-mono font-bold text-yellow-600">₹{Math.round(currentInrPrice).toLocaleString('en-IN')}</p>
            </div>
          </div>
          <div className={cn(
            "px-4 py-1 rounded-full flex items-center gap-2 font-semibold text-sm",
            marketTrend === 'Bullish' ? "bg-emerald-100 text-emerald-700" : 
            marketTrend === 'Bearish' ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"
          )}>
            {marketTrend === 'Bullish' ? <TrendingUp size={16} /> : 
             marketTrend === 'Bearish' ? <TrendingDown size={16} /> : <AlertTriangle size={16} />}
            {marketTrend} Zone
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column */}
        <div className="lg:col-span-8 space-y-8">
          
          {/* Main Chart with 30-Day Forecast */}
          <section className="data-card">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Activity className="text-blue-500" size={20} />
                Market Trajectory + 30D Forecast (INR/gm)
              </h2>
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setShowIndicators(!showIndicators)}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-bold transition-colors",
                    showIndicators ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  )}
                >
                  {showIndicators ? "Hide Indicators" : "Show Indicators"}
                </button>
                <div className="flex gap-4">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-yellow-500" />
                    <span className="text-xs text-slate-500">History</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-blue-500" />
                    <span className="text-xs text-slate-500">Forecast</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={priceData}>
                  <defs>
                    <linearGradient id="colorHistory" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#eab308" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#eab308" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorForecast" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8'}} />
                  <YAxis yId="left" domain={['dataMin - 500', 'dataMax + 500']} axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8'}} />
                  {showIndicators && <YAxis yId="right" orientation="right" domain={[0, 100]} axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8'}} />}
                  <Tooltip 
                    formatter={(value: number, name: string) => [
                      name === 'rsi' ? `${value}` : `₹${value.toLocaleString('en-IN')}`, 
                      name.toUpperCase()
                    ]}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  />
                  <Area 
                    yId="left"
                    type="monotone" 
                    dataKey="inrPrice" 
                    stroke="#eab308" 
                    fillOpacity={1} 
                    fill="url(#colorHistory)" 
                    strokeWidth={2}
                    connectNulls
                    data={priceData.filter(d => !d.isForecast)}
                    isAnimationActive={false}
                    name="Price"
                  />
                  <Area 
                    yId="left"
                    type="monotone" 
                    dataKey="inrPrice" 
                    stroke="#3b82f6" 
                    fillOpacity={1} 
                    fill="url(#colorForecast)" 
                    strokeWidth={2} 
                    strokeDasharray="5 5"
                    data={priceData.filter((d, i) => d.isForecast || (priceData[i+1]?.isForecast))}
                    isAnimationActive={false}
                    name="Forecast"
                  />
                  {showIndicators && (
                    <>
                      <Line yId="left" type="monotone" dataKey="sma" stroke="#9333ea" strokeWidth={1} dot={false} name="SMA (14)" />
                      <Line yId="right" type="monotone" dataKey="rsi" stroke="#ef4444" strokeWidth={1} dot={false} name="RSI (14)" />
                    </>
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* India-Centric Macro Inputs */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Globe className="text-slate-400" size={20} />
                India-Specific Macro Factors
              </h2>
              <button 
                onClick={fetchLiveMacroData}
                disabled={isFetchingMacro}
                className="text-xs font-bold text-blue-500 hover:text-blue-600 flex items-center gap-1 disabled:opacity-50"
              >
                {isFetchingMacro ? "Fetching..." : "Refresh Live Data"}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label: 'RBI Repo Rate', key: 'rbiRepoRate', unit: '%', step: 0.25, min: 4, max: 10 },
                { label: 'Import Duty', key: 'importDuty', unit: '%', step: 0.5, min: 0, max: 25 },
                { label: 'MCX Premium', key: 'mcxPremium', unit: '₹', step: 10, min: -1000, max: 2000 },
                { label: 'Real Rates (US)', key: 'realInterestRates', unit: '%', step: 0.05, min: 0, max: 10 },
                { label: 'DXY Index', key: 'dxy', unit: '', step: 0.1, min: 80, max: 120 },
                { label: 'GPR Index', key: 'geopoliticalRisk', unit: '', step: 0.05, min: 0, max: 1 },
              ].map((param) => (
                <div key={param.key} className="data-card p-4">
                  <label className="label-micro block mb-2">{param.label}</label>
                  <div className="flex items-center justify-between">
                    <input 
                      type="number" 
                      value={macro[param.key as keyof MacroParams]} 
                      onChange={(e) => setMacro({...macro, [param.key]: parseFloat(e.target.value) || 0})}
                      className="text-xl font-mono font-bold w-full bg-transparent outline-none"
                      step={param.step}
                    />
                    <span className="text-slate-400 text-sm">{param.unit}</span>
                  </div>
                  <input 
                    type="range" 
                    min={param.min} 
                    max={param.max} 
                    step={param.step}
                    value={macro[param.key as keyof MacroParams]}
                    onChange={(e) => setMacro({...macro, [param.key]: parseFloat(e.target.value)})}
                    className="w-full mt-3 accent-yellow-500"
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Pure Gold Valuation Graph */}
          <section className="data-card">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-6">
              <ProfitIcon className="text-emerald-500" size={20} />
              Pure Gold Inventory Valuation
            </h2>
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={inventoryValuation}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8'}} />
                  <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8'}} />
                  <Tooltip 
                    formatter={(value: number, name: string) => [
                      name === 'profitPerGram' ? `₹${value.toLocaleString('en-IN')}/gm` : `₹${value}/gm`,
                      name === 'profitPerGram' ? 'Profit/Gram' : name.charAt(0).toUpperCase() + name.slice(1)
                    ]}
                  />
                  <Bar dataKey="purchasePrice" fill="#94a3b8" radius={[4, 4, 0, 0]} name="Purchase Price" />
                  <Bar dataKey="currentPrice" fill="#eab308" radius={[4, 4, 0, 0]} name="Current Price" />
                  <Bar dataKey="profitPerGram" name="Unrealized Profit/Gram">
                    {inventoryValuation.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.profitPerGram >= 0 ? '#10b981' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        {/* Right Column */}
        <div className="lg:col-span-4 space-y-8">
          
          {/* Decision Matrix */}
          <section className="data-card border-2 border-slate-900 bg-slate-900 text-white">
            <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-4 flex items-center gap-2">
              <BarChart3 size={16} />
              Decision Output
            </h2>
            <div className="space-y-4">
              <div>
                <p className="text-xs text-slate-400">Recommended Action</p>
                <p className="text-2xl font-bold text-yellow-400">{decision.action}</p>
              </div>
              <div className="p-3 bg-slate-800 rounded-lg border border-slate-700">
                <p className="text-xs leading-relaxed text-slate-300 italic">
                  "{decision.reason}"
                </p>
              </div>
              <div className="pt-4 border-t border-slate-800 grid grid-cols-2 gap-4">
                <div>
                  <p className="label-micro text-slate-500">Expected (gm)</p>
                  <p className="text-lg font-mono font-bold text-yellow-400">₹{Math.round(convertToINRPerGram(expectedPrice, macro.importDuty)).toLocaleString('en-IN')}</p>
                </div>
                <div>
                  <p className="label-micro text-slate-500">Sentiment</p>
                  <p className={cn(
                    "text-lg font-mono font-bold",
                    aggregateSentiment > 0 ? "text-emerald-400" : "text-rose-400"
                  )}>{aggregateSentiment > 0 ? '+' : ''}{aggregateSentiment.toFixed(2)}</p>
                </div>
              </div>
            </div>
          </section>

          {/* Detailed Shop Inventory */}
          <section className="data-card">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Package className="text-slate-400" size={20} />
              Detailed Shop Inventory
            </h2>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="label-micro block mb-1">24K Stock</label>
                  <input 
                    type="number" 
                    value={inventory.stock24k}
                    onChange={(e) => setInventory({...inventory, stock24k: parseFloat(e.target.value) || 0})}
                    className="w-full font-mono text-sm bg-slate-50 p-2 rounded"
                  />
                  <span className="text-[10px] text-slate-400">grams</span>
                </div>
                <div>
                  <label className="label-micro block mb-1">22K Stock</label>
                  <input 
                    type="number" 
                    value={inventory.stock22k}
                    onChange={(e) => setInventory({...inventory, stock22k: parseFloat(e.target.value) || 0})}
                    className="w-full font-mono text-sm bg-slate-50 p-2 rounded"
                  />
                  <span className="text-[10px] text-slate-400">grams</span>
                </div>
                <div>
                  <label className="label-micro block mb-1">18K Stock</label>
                  <input 
                    type="number" 
                    value={inventory.stock18k}
                    onChange={(e) => setInventory({...inventory, stock18k: parseFloat(e.target.value) || 0})}
                    className="w-full font-mono text-sm bg-slate-50 p-2 rounded"
                  />
                  <span className="text-[10px] text-slate-400">grams</span>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100">
                <div className="flex items-center justify-between mb-3">
                  <label className="label-micro">Pure Gold Purchases</label>
                  <button onClick={addPurchase} className="text-blue-500 hover:text-blue-600 flex items-center gap-1 text-xs font-bold">
                    <Plus size={14} /> Add
                  </button>
                </div>
                <div className="space-y-3 max-h-[250px] overflow-y-auto pr-2">
                  {inventory.pureGoldPurchases.map((p) => (
                    <div key={p.id} className="p-3 bg-slate-50 rounded-lg border border-slate-100 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-slate-400">
                          <Calendar size={12} />
                          <input 
                            type="date" 
                            value={p.date}
                            onChange={(e) => updatePurchase(p.id, 'date', e.target.value)}
                            className="bg-transparent text-[10px] font-mono outline-none"
                          />
                        </div>
                        <button onClick={() => removePurchase(p.id)} className="text-slate-300 hover:text-rose-500">
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[9px] uppercase text-slate-400 font-bold">Amount (g)</label>
                          <input 
                            type="number" 
                            value={p.amount}
                            onChange={(e) => updatePurchase(p.id, 'amount', parseFloat(e.target.value) || 0)}
                            className="w-full bg-white border border-slate-200 rounded p-1 text-xs font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] uppercase text-slate-400 font-bold">Price (₹/g)</label>
                          <input 
                            type="number" 
                            value={p.purchasePrice}
                            onChange={(e) => updatePurchase(p.id, 'purchasePrice', parseFloat(e.target.value) || 0)}
                            className="w-full bg-white border border-slate-200 rounded p-1 text-xs font-mono"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* News Sentiment with Institutional Focus */}
          <section className="data-card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Newspaper className="text-slate-400" size={20} />
                Institutional Reports
              </h2>
              <div className={cn(
                "px-2 py-0.5 rounded text-[10px] font-bold",
                aggregateSentiment > 0.2 ? "bg-emerald-100 text-emerald-700" : 
                aggregateSentiment < -0.2 ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600"
              )}>
                Net Score: {aggregateSentiment > 0 ? '+' : ''}{aggregateSentiment.toFixed(2)}
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex gap-2">
                <input 
                  type="text" 
                  placeholder="Analyze institutional news..."
                  value={newHeadline}
                  onChange={(e) => setNewHeadline(e.target.value)}
                  className="flex-1 text-sm bg-slate-50 p-2 rounded border border-slate-100 outline-none focus:border-yellow-500 transition-colors"
                />
                <button 
                  onClick={analyzeSentiment}
                  disabled={isAnalyzing || !newHeadline}
                  className="bg-slate-900 text-white p-2 rounded disabled:opacity-50 hover:bg-slate-800 transition-colors"
                >
                  {isAnalyzing ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <ChevronRight size={20} />}
                </button>
              </div>

              <div className="space-y-3 max-h-[300px] overflow-y-auto pr-2">
                <AnimatePresence initial={false}>
                  {news.map((item) => (
                    <motion.div 
                      key={item.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="p-3 bg-slate-50 rounded-lg border border-slate-100 relative overflow-hidden"
                    >
                      <div className={cn(
                        "absolute left-0 top-0 bottom-0 w-1",
                        item.sentiment > 0.3 ? "bg-emerald-500" : item.sentiment < -0.3 ? "bg-rose-500" : "bg-slate-300"
                      )} />
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{item.category}</span>
                        <span className="text-[9px] text-slate-400">{item.timestamp}</span>
                      </div>
                      <p className="text-xs font-medium text-slate-800 leading-snug">{item.headline}</p>
                      <div className="flex items-center justify-end mt-2">
                        <span className={cn(
                          "text-[10px] font-bold px-1.5 py-0.5 rounded",
                          item.sentiment > 0.3 ? "bg-emerald-100 text-emerald-700" : 
                          item.sentiment < -0.3 ? "bg-rose-100 text-rose-700" : "bg-slate-200 text-slate-600"
                        )}>
                          {item.sentiment > 0 ? '+' : ''}{item.sentiment.toFixed(1)}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </section>

        </div>
      </div>

      {/* Footer Info */}
      <footer className="pt-8 border-t border-slate-200 flex flex-col md:flex-row items-center justify-between gap-4 text-slate-400">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1">
            <Globe size={14} />
            <span className="text-xs">USD/INR: {USD_INR_RATE}</span>
          </div>
          <div className="flex items-center gap-1">
            <IndianRupee size={14} />
            <span className="text-xs">1 Troy Oz = {GRAMS_PER_OZ}g</span>
          </div>
          <span className="text-xs hidden md:inline">•</span>
          <div className="flex items-center gap-1">
            <Info size={14} />
            <span className="text-xs">Model: Indian Retail Hybrid v3.0</span>
          </div>
        </div>
        <p className="text-xs">© 2026 Gold India Predict</p>
      </footer>
    </div>
  );
}
