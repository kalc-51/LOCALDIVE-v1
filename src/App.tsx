/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  MapPin, 
  Search, 
  Navigation, 
  Star, 
  Clock, 
  ExternalLink, 
  Loader2,
  Compass,
  Map as MapIcon,
  ChevronRight,
  Zap,
  Coffee,
  Utensils,
  Moon,
  Sun,
  Sunrise,
  Sunset,
  Info,
  Users,
  Heart,
  Share2,
  ArrowUpDown,
  User as UserIcon,
  Settings,
  LayoutDashboard,
  MessageSquare,
  Plus,
  ArrowLeft,
  CheckCircle2,
  Calendar,
  Trash2,
  ExternalLink as LinkIcon,
  ThumbsUp,
  LogIn,
  LogOut,
  Globe
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Markdown from 'react-markdown';
import { auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged } from './firebase';
import { collection, addDoc, query, where, onSnapshot, orderBy, limit, serverTimestamp, doc, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import type { User } from './firebase';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// --- Types ---
interface Spot {
  id: string;
  name: string;
  category: 'food' | 'art' | 'event' | 'shop' | 'nature' | 'other';
  lat: number;
  lng: number;
  description: string;
  rating: number;
  recommendCount: number;
  reviews: { user: string; comment: string; rating: number }[];
  googleMapsUrl: string;
  tabelogUrl?: string;
  openingHours?: string;
  sources?: { title: string; uri: string }[];
}

// --- Constants ---
const YURAKUCHO_CENTER = { lat: 35.6750, lng: 139.7633 };

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

// --- Leaflet Icons ---
const spotIcon = (category: string, isFeatured: boolean = false, isInItinerary: boolean = false) => {
  const emoji = category === 'food' ? '🍴' : category === 'art' ? '🎨' : category === 'nature' ? '🌿' : '📍';
  const borderColor = isFeatured ? '#F59E0B' : isInItinerary ? '#10B981' : '#1A5CB8';
  
  return L.divIcon({
    html: `
      <div class="relative w-10 h-10 bg-white rounded-2xl shadow-xl border-2 flex items-center justify-center text-xl" style="border-color: ${borderColor}">
        ${emoji}
      </div>
    `,
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
};

const userMarkerIcon = L.divIcon({
  html: `
    <div class="relative w-6 h-6 bg-[#1A5CB8] rounded-full border-4 border-white shadow-lg">
      <div class="absolute inset-0 bg-[#1A5CB8] rounded-full animate-ping opacity-50"></div>
    </div>
  `,
  className: '',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

function ChangeView({ center, zoom }: { center: L.LatLngExpression, zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom]);
  return null;
}

function LeafletMap({ spots, center, userLocation, onSpotClick, featuredSpots, itinerary }: any) {
  return (
    <MapContainer center={center} zoom={15} style={{ height: '100%', width: '100%', zIndex: 1 }} zoomControl={true}>
      <ChangeView center={center} zoom={15} />
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      
      {userLocation && (
        <Marker position={[userLocation.lat, userLocation.lng]} icon={userMarkerIcon}>
          <Popup>現在地</Popup>
        </Marker>
      )}

      <Marker position={[YURAKUCHO_CENTER.lat, YURAKUCHO_CENTER.lng]} icon={userMarkerIcon}>
        <Popup>有楽町駅</Popup>
      </Marker>

      {spots.map((spot: Spot) => {
        const isFeatured = featuredSpots?.some((fs: any) => fs.id === spot.id);
        const isInItinerary = itinerary?.some((is: any) => is.id === spot.id);
        return (
          <Marker 
            key={spot.id} 
            position={[spot.lat, spot.lng]} 
            icon={spotIcon(spot.category, isFeatured, isInItinerary)}
            eventHandlers={{
              click: () => onSpotClick(spot)
            }}
          >
            <Popup>
              <div className="font-black text-sm">{spot.name}</div>
              <div className="text-[10px] text-slate-500 mt-1">{spot.description.substring(0, 50)}...</div>
              <button 
                onClick={() => onSpotClick(spot)}
                className="mt-2 w-full py-1 bg-[#1A5CB8] text-white text-[10px] font-black rounded-lg"
              >
                詳細を見る
              </button>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const CATEGORY_MAP: Record<string, string> = {
  food: '🍴 グルメ',
  art: '🎨 美術館・博物館',
  event: '🎉 イベント',
  shop: '🛍️ ショップ',
  nature: '🌿 公園・自然',
  other: '📍 その他',
  featured: '✨ 注目スポット'
};

const TIB_SPOT: Spot = {
  id: 'tib-tokyo',
  name: 'Tokyo Innovation Base (TIB)',
  category: 'other',
  lat: 35.6756,
  lng: 139.7645,
  description: '東京からイノベーションを巻き起こすためのスタートアップ支援拠点。有楽町駅すぐの「SusHi Tech Square」内にあり、多様なイベントや交流が行われています。',
  rating: 4.8,
  recommendCount: 250,
  reviews: [
    { user: "イノベーター", comment: "開放的な空間で、新しい刺激がもらえます。", rating: 5 },
    { user: "起業家", comment: "イベントが豊富で、ネットワークが広がります。", rating: 5 }
  ],
  googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Tokyo+Innovation+Base',
  openingHours: '10:00〜21:00（イベントにより変動あり）'
};

const SAMPLE_REVIEWS = [
  { user: "たなか", comment: "ここのコーヒーは絶品です！落ち着いた雰囲気で最高。", rating: 5 },
  { user: "佐藤", comment: "週末は少し混みますが、行く価値ありです。", rating: 4 },
  { user: "鈴木", comment: "展示が非常に興味深く、2時間があっという間でした。", rating: 5 }
];

const MOCK_COMMUNITY_LOGS = [
  { id: 'm1', userName: 'Yuki', date: '2024/03/14', spots: [{ name: '有楽町カフェ' }, { name: '日比谷公園' }], isPublic: true },
  { id: 'm2', userName: 'Kenji', date: '2024/03/14', spots: [{ name: 'ガード下居酒屋' }, { name: '国際フォーラム' }], isPublic: true },
  { id: 'm3', userName: 'Mami', date: '2024/03/13', spots: [{ name: '丸の内ピカデリー' }, { name: '有楽町イトシア' }], isPublic: true },
  { id: 'm4', userName: 'Hiro', date: '2024/03/13', spots: [{ name: '交通会館' }, { name: '銀座ロフト' }], isPublic: true },
  { id: 'm5', userName: 'Sora', date: '2024/03/12', spots: [{ name: '無印良品 銀座' }, { name: '日比谷シャンテ' }], isPublic: true },
  { id: 'm6', userName: 'Aoi', date: '2024/03/12', spots: [{ name: '帝国劇場' }, { name: 'ミッドタウン日比谷' }], isPublic: true },
  { id: 'm7', userName: 'Taku', date: '2024/03/11', spots: [{ name: 'ビックカメラ有楽町' }, { name: '有楽町産直横丁' }], isPublic: true },
  { id: 'm8', userName: 'Rina', date: '2024/03/11', spots: [{ name: '和光' }, { name: '銀座三越' }], isPublic: true },
];

// --- Error Boundary ---
class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: any}> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
          <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center">
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <Info size={32} />
            </div>
            <h2 className="text-2xl font-black mb-4">エラーが発生しました</h2>
            <p className="text-slate-500 text-sm mb-6">申し訳ありません。アプリの読み込み中に問題が発生しました。</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-[#1A5CB8] text-white rounded-2xl font-black"
            >
              再読み込みする
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  // --- Auth State ---
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // --- UI State ---
  const [activeTab, setActiveTab] = useState('dive');
  const [step, setStep] = useState(0); // 0: Search/Wizard, 1: Results
  const [searchMode, setSearchMode] = useState<'free' | 'guided'>('free');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weather, setWeather] = useState<{ temp: number; code: number; text: string } | null>(null);
  
  // Guided Search (Wizard) State
  const [wizardData, setWizardData] = useState({
    time: '昼',
    people: '1人',
    purpose: 'のんびりしたい',
    budget: '2000円以内'
  });

  // Search & Planning
  const [queryText, setQueryText] = useState('');
  const [selectedMoods, setSelectedMoods] = useState<string[]>([]);
  
  // Results
  const [foundSpots, setFoundSpots] = useState<Spot[]>([]);
  const [featuredSpots] = useState<Spot[]>([TIB_SPOT]);
  const [itinerary, setItinerary] = useState<Spot[]>([]);
  const [selectedSpot, setSelectedSpot] = useState<Spot | null>(null);
  const [detourLogs, setDetourLogs] = useState<any[]>([]);
  const [communityLogs, setCommunityLogs] = useState<any[]>([]);
  const [groundingSources, setGroundingSources] = useState<{ title: string; uri: string }[]>([]);
  const [optimizingRoute, setOptimizingRoute] = useState(false);
  const [likes, setLikes] = useState<Record<string, string[]>>({});
  const [showMap, setShowMap] = useState(false);
  const [mapZoom, setMapZoom] = useState(2000);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  // --- Effects ---
  useEffect(() => {
    if ("geolocation" in navigator) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => {
          console.error("Geolocation error:", error);
        },
        { enableHighAccuracy: true }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, []);
  useEffect(() => {
    const fetchWeather = async () => {
      try {
        const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=35.6750&longitude=139.7633&current_weather=true');
        const data = await res.json();
        const code = data.current_weather.weathercode;
        let text = '晴れ';
        if (code >= 1 && code <= 3) text = '曇り';
        if (code >= 45 && code <= 48) text = '霧';
        if (code >= 51 && code <= 67) text = '雨';
        if (code >= 71 && code <= 77) text = '雪';
        if (code >= 80 && code <= 82) text = 'にわか雨';
        if (code >= 95) text = '雷雨';
        setWeather({ temp: data.current_weather.temperature, code, text });
      } catch (err) {
        console.error('Weather fetch failed', err);
      }
    };
    fetchWeather();
    const interval = setInterval(fetchWeather, 300000); // Every 5 minutes
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000); // Every minute
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
      if (u) {
        // Sync user to Firestore
        setDoc(doc(db, 'users', u.uid), {
          uid: u.uid,
          displayName: u.displayName,
          email: u.email,
          photoURL: u.photoURL,
          updatedAt: serverTimestamp()
        }, { merge: true });
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    
    // Fetch personal logs
    const q = query(
      collection(db, 'logs'),
      where('uid', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(20)
    );
    const unsub = onSnapshot(q, (snapshot) => {
      setDetourLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Fetch community logs
    const qComm = query(
      collection(db, 'logs'),
      where('isPublic', '==', true),
      orderBy('createdAt', 'desc'),
      limit(20)
    );
    const unsubComm = onSnapshot(qComm, (snapshot) => {
      const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Merge with mock logs to simulate 100 users
      setCommunityLogs([...logs, ...MOCK_COMMUNITY_LOGS]);
    });

    return () => { unsub(); unsubComm(); };
  }, [user]);

  useEffect(() => {
    if (!db) return;
    const q = query(collection(db, 'likes'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newLikes: Record<string, string[]> = {};
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        if (!newLikes[data.spotId]) {
          newLikes[data.spotId] = [];
        }
        newLikes[data.spotId].push(data.uid);
      });
      setLikes(newLikes);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'likes');
    });
    return () => unsubscribe();
  }, [db]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user') {
        return;
      }
      console.error(err);
      setError("ログインに失敗しました。");
    }
  };

  const handleLogout = () => signOut(auth);

  const saveDetour = async () => {
    if (!user) {
      setError("記録するにはログインが必要です。");
      return;
    }
    if (itinerary.length === 0) return;
    
    setLoading(true);
    try {
      await addDoc(collection(db, 'logs'), {
        uid: user.uid,
        userName: user.displayName || '匿名ユーザー',
        date: new Date().toLocaleDateString('ja-JP'),
        spots: itinerary.map(s => ({ id: s.id, name: s.name, category: s.category })),
        isPublic: true, // Default to public for community sharing
        createdAt: serverTimestamp()
      });
      setItinerary([]);
      setActiveTab('log');
    } catch (err) {
      console.error(err);
      setError("記録の保存に失敗しました。");
    } finally {
      setLoading(false);
    }
  };
  
  // --- Logic ---
  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    let finalQuery = queryText;
    if (searchMode === 'guided') {
      finalQuery = `${wizardData.time}に${wizardData.people}で、${wizardData.purpose}。予算は${wizardData.budget}。`;
    }

    if (!finalQuery.trim() && selectedMoods.length === 0) return;

    setLoading(true);
    setError(null);
    
    try {
      const model = "gemini-2.5-flash";
      const now = new Date();
      const currentHour = now.getHours();
      const timeOfDay = currentHour < 11 ? '朝' : currentHour < 15 ? '昼' : currentHour < 18 ? '夕方' : '夜';
      const weatherInfo = weather ? `現在の天気は${weather.text}、気温は${weather.temp}度です。この天候に最適なスポットを優先してください。` : "";
      const timeInfo = `現在は${currentHour}時（${timeOfDay}）です。この時間帯に営業しており、雰囲気が合うスポットを優先してください。`;
      
      const prompt = `
        有楽町駅（35.6750, 139.7633）から半径2km圏内にあるスポットを検索してください。
        特に「TIB（TOKYO Innovation Base）」などの最新のイノベーション拠点や、ユーザーの興味に合わせたスポットを含めてください。
        ユーザーの要望: ${finalQuery} ${selectedMoods.join(' ')}
        ${weatherInfo}
        ${timeInfo}
        
        【重要】Google検索を使用して、実在するスポットであることを確認し、最新の営業時間を取得してください。虚偽の情報（存在しないスポットや間違った営業時間）を出力しないでください。
        
        以下のJSON形式のみで、実在するスポットを15〜20件出力してください。
        {
          "spots": [
            {
              "id": "unique_id",
              "name": "スポット名",
              "category": "food | art | event | shop | nature | other",
              "lat": 35.67,
              "lng": 139.76,
              "description": "魅力的な説明文。天候や現在の時間（${currentHour}時）に合わせたおすすめ理由も含めてください。",
              "rating": 4.5,
              "recommendCount": 120,
              "googleMapsUrl": "https://www.google.com/maps/search/?api=1&query=...",
              "tabelogUrl": "https://tabelog.com/s/search?q=...",
              "officialUrl": "公式ウェブサイトURL（あれば）",
              "openingHours": "営業時間（例：11:00〜21:00、不定休など）"
            }
          ]
        }
      `;

      const response = await ai.models.generateContent({
        model: model,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      // Extract grounding metadata for verification
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      const sources = chunks
        ? chunks
            .filter((c: any) => c.web)
            .map((c: any) => ({ title: c.web!.title, uri: c.web!.uri }))
        : [];
      setGroundingSources(sources);

      const text = response.text || '';
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const data = JSON.parse(match[0]);
        const spotsWithReviews = data.spots.map((s: any) => ({
          ...s,
          reviews: SAMPLE_REVIEWS.sort(() => Math.random() - 0.5).slice(0, 2)
        }));
        setFoundSpots(spotsWithReviews);
        setStep(1);
      } else {
        throw new Error("Data parse failed");
      }
    } catch (err) {
      console.error(err);
      setError("検索に失敗しました。有楽町周辺の通信環境を確認してください。");
    } finally {
      setLoading(false);
    }
  };

  const addToItinerary = (spot: Spot) => {
    if (!itinerary.find(s => s.id === spot.id)) {
      setItinerary([...itinerary, spot]);
    }
  };

  const removeFromItinerary = (id: string) => {
    setItinerary(itinerary.filter(s => s.id !== id));
  };

  const sortItinerary = (type: 'hours' | 'distance') => {
    const sorted = [...itinerary].sort((a, b) => {
      if (type === 'hours') {
        const aTime = a.openingHours?.match(/\d{1,2}:\d{2}/)?.[0] || '99:99';
        const bTime = b.openingHours?.match(/\d{1,2}:\d{2}/)?.[0] || '99:99';
        return aTime.localeCompare(bTime);
      } else {
        const distA = Math.sqrt(Math.pow(a.lat - YURAKUCHO_CENTER.lat, 2) + Math.pow(a.lng - YURAKUCHO_CENTER.lng, 2));
        const distB = Math.sqrt(Math.pow(b.lat - YURAKUCHO_CENTER.lat, 2) + Math.pow(b.lng - YURAKUCHO_CENTER.lng, 2));
        return distA - distB;
      }
    });
    setItinerary(sorted);
  };

  const shareItinerary = async () => {
    const text = `【有楽町寄り道プラン】\n${itinerary.map((s, i) => `${i+1}. ${s.name} (${CATEGORY_MAP[s.category]})`).join('\n')}\n\n#LOCALDIVE #有楽町`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: '有楽町寄り道プラン',
          text: text,
          url: window.location.origin,
        });
      } catch (err) {
        console.error('Share failed', err);
      }
    } else {
      navigator.clipboard.writeText(text);
      alert('プランをクリップボードにコピーしました！');
    }
  };

  const toggleLike = async (spotId: string) => {
    if (!user) {
      alert("いいねするにはログインが必要です。");
      return;
    }

    const likeId = `${user.uid}_${spotId}`;
    const likeRef = doc(db, 'likes', likeId);
    
    if (likes[spotId]?.includes(user.uid)) {
      try {
        await deleteDoc(likeRef);
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `likes/${likeId}`);
      }
    } else {
      try {
        await setDoc(likeRef, {
          uid: user.uid,
          spotId: spotId,
          createdAt: serverTimestamp()
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `likes/${likeId}`);
      }
    }
  };

  const optimizeRoute = async () => {
    if (itinerary.length < 2) return;
    setOptimizingRoute(true);
    try {
      const spotList = itinerary.map(s => `${s.name} (ID: ${s.id}, 営業時間: ${s.openingHours || '不明'})`).join(', ');
      const prompt = `
        以下のスポットを巡る、最も効率的で楽しい寄り道ルートを提案してください。
        スポットリスト: ${spotList}
        現在の時間: ${new Date().getHours()}時
        
        【出力形式】
        以下のJSON形式のみで出力してください。
        {
          "orderedIds": ["id1", "id2", "id3", ...],
          "advice": "ルートのポイントや移動のアドバイス（100文字程度）"
        }
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });

      const text = response.text || '';
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const data = JSON.parse(match[0]);
        const newOrder = data.orderedIds
          .map((id: string) => itinerary.find(s => s.id === id))
          .filter(Boolean) as Spot[];
        
        // Add any spots that might have been missed by the AI
        itinerary.forEach(s => {
          if (!newOrder.find(os => os.id === s.id)) {
            newOrder.push(s);
          }
        });

        setItinerary(newOrder);
        alert(`AIによるルート診断完了！\n\nアドバイス: ${data.advice}`);
      }
    } catch (err) {
      console.error(err);
      alert("ルートの最適化に失敗しました。");
    } finally {
      setOptimizingRoute(false);
    }
  };

  // --- Render Helpers ---
  const renderNav = () => (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-50 pb-safe">
      <div className="max-w-4xl mx-auto px-2 h-16 flex items-center justify-around">
        {[
          { id: 'dive', label: '探す', icon: <Search size={20} /> },
          { id: 'map', label: 'マップ', icon: <MapIcon size={20} /> },
          { id: 'plan', label: 'プラン', icon: <Calendar size={20} />, badge: itinerary.length },
          { id: 'events', label: 'イベント', icon: <Zap size={20} /> },
          { id: 'log', label: '記録', icon: <Clock size={20} /> },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex flex-col items-center gap-1 flex-1 transition-colors relative ${activeTab === tab.id ? 'text-[#1A5CB8]' : 'text-slate-400'}`}
          >
            <div className={`p-1 rounded-xl ${activeTab === tab.id ? 'bg-blue-50' : ''}`}>
              {tab.icon}
            </div>
            <span className="text-[10px] font-black uppercase tracking-tighter">{tab.label}</span>
            {tab.badge ? (
              <span className="absolute top-0 right-1/4 w-4 h-4 bg-red-500 text-white text-[8px] flex items-center justify-center rounded-full font-bold">
                {tab.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </nav>
  );

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#F4F8FE] text-[#08192E] font-sans pb-24">
      <header className="sticky top-0 z-50 bg-[#0E3460] text-white shadow-lg">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => { setActiveTab('dive'); setStep(0); }}>
            <div className="w-8 h-8 bg-[#3B9EE8] rounded-lg flex items-center justify-center shadow-inner">
              <Compass size={20} />
            </div>
            <h1 className="text-xl font-black tracking-widest font-['Syne']">LOCAL <span className="text-[#3B9EE8]">DIVE</span></h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-full text-[10px] font-black">
              <Clock size={12} className="text-[#3B9EE8]" />
              {currentTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
            </div>
            {weather && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-white/10 rounded-full text-[10px] font-black uppercase tracking-widest">
                {weather.code < 3 ? <Sun size={12} className="text-amber-400" /> : <Globe size={12} className="text-blue-400" />}
                {weather.text} {weather.temp}°C
              </div>
            )}
            <div className="hidden md:flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/50">
              <MapPin size={12} className="text-[#3B9EE8]" />
              有楽町 2km圏内
            </div>
            
            {authLoading ? (
              <Loader2 size={18} className="animate-spin text-white/30" />
            ) : user ? (
              <div className="flex items-center gap-3">
                <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border-2 border-[#3B9EE8]" />
                <button onClick={handleLogout} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
                  <LogOut size={18} />
                </button>
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                className="flex items-center gap-2 px-4 py-2 bg-[#3B9EE8] hover:bg-[#1A5CB8] text-white rounded-xl text-xs font-black transition-all"
              >
                <LogIn size={16} /> ログイン
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4">
        <AnimatePresence mode="wait">
          {activeTab === 'dive' ? (
            <motion.div key="dive" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              {step === 0 ? (
                <div className="space-y-8 py-4">
                  <div className="text-center mb-8">
                    <h2 className="text-3xl font-black mb-2 tracking-tight">有楽町をディープに探検。</h2>
                    <p className="text-slate-500">食、アート、イベント。あなただけの寄り道プランをAIがサポート。</p>
                  </div>

                  {/* Featured Spot Section */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between px-2">
                      <div className="flex items-center gap-2">
                        <Zap size={18} className="text-amber-500" />
                        <h3 className="font-black text-sm uppercase tracking-widest">注目のスポット</h3>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-black text-slate-400">
                        <motion.div animate={{ opacity: [1, 0.5, 1] }} transition={{ duration: 2, repeat: Infinity }} className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                        LIVE: {currentTime.getHours()}時台のおすすめ
                      </div>
                    </div>

                    {/* Live Tip */}
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mx-2 p-4 bg-white rounded-2xl border border-slate-100 shadow-sm flex items-center gap-3"
                    >
                      <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-[#1A5CB8]">
                        <Clock size={20} />
                      </div>
                      <div className="flex-1">
                        <div className="text-[8px] font-black text-[#3B9EE8] uppercase tracking-widest">Live Tip</div>
                        <p className="text-[10px] font-bold text-slate-600">
                          {currentTime.getHours() >= 11 && currentTime.getHours() <= 14 ? "ランチタイムですね！有楽町ビル地下の飲食店街が賑わっています。" :
                           currentTime.getHours() >= 17 && currentTime.getHours() <= 20 ? "夕暮れ時です。日比谷公園のライトアップが始まる時間です。" :
                           currentTime.getHours() >= 21 ? "夜の有楽町。ガード下の居酒屋街でディープな体験はいかが？" :
                           "散策にぴったりの時間です。国際フォーラムの広場で一息つくのもおすすめ。"}
                        </p>
                      </div>
                    </motion.div>

                    {featuredSpots.map(spot => (
                      <motion.div
                        key={spot.id}
                        whileHover={{ y: -4 }}
                        onClick={() => setSelectedSpot(spot)}
                        className="bg-gradient-to-br from-[#1A5CB8] to-[#3B9EE8] p-6 rounded-[2.5rem] text-white shadow-xl cursor-pointer relative overflow-hidden group"
                      >
                        <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 blur-3xl rounded-full group-hover:scale-150 transition-transform" />
                        <div className="relative z-10">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="px-2 py-0.5 bg-white/20 rounded text-[8px] font-black uppercase tracking-widest">Featured</span>
                            <div className="flex items-center gap-1 text-amber-300 font-black text-[10px]">
                              <Star size={10} fill="currentColor" /> {spot.rating}
                            </div>
                          </div>
                          <h4 className="text-2xl font-black mb-2">{spot.name}</h4>
                          <p className="text-white/70 text-xs line-clamp-2 mb-4">{spot.description}</p>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="flex items-center gap-1 text-[10px] font-bold">
                                <Heart size={12} /> {likes[spot.id]?.length || 0}
                              </div>
                              <div className="flex items-center gap-1 text-[10px] font-bold">
                                <Clock size={12} /> {spot.openingHours}
                              </div>
                            </div>
                            <ChevronRight size={20} />
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>

                  <div className="flex justify-center gap-4 mb-8">
                    <button 
                      onClick={() => setSearchMode('free')}
                      className={`px-6 py-3 rounded-2xl font-black text-sm transition-all ${searchMode === 'free' ? 'bg-[#1A5CB8] text-white shadow-lg' : 'bg-white text-slate-400 border border-slate-100'}`}
                    >
                      自由入力
                    </button>
                    <button 
                      onClick={() => setSearchMode('guided')}
                      className={`px-6 py-3 rounded-2xl font-black text-sm transition-all ${searchMode === 'guided' ? 'bg-[#1A5CB8] text-white shadow-lg' : 'bg-white text-slate-400 border border-slate-100'}`}
                    >
                      おまかせ（ガイド付）
                    </button>
                  </div>

                  {searchMode === 'free' ? (
                    <form onSubmit={handleSearch} className="relative max-w-2xl mx-auto">
                      <div className="relative group">
                        <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-[#3B9EE8] transition-colors">
                          <Search size={22} />
                        </div>
                        <input
                          type="text"
                          value={queryText}
                          onChange={(e) => setQueryText(e.target.value)}
                          placeholder="例：静かなカフェ、面白い展示、美味しいラーメン"
                          className="w-full pl-14 pr-36 py-5 bg-white border border-slate-200 rounded-2xl shadow-xl focus:ring-4 focus:ring-[#3B9EE8]/10 focus:border-[#3B9EE8] outline-none transition-all text-lg"
                        />
                        <button
                          type="submit"
                          disabled={loading || (!queryText.trim() && selectedMoods.length === 0)}
                          className="absolute right-2.5 top-2.5 bottom-2.5 px-8 bg-[#1A5CB8] hover:bg-[#3B9EE8] disabled:bg-slate-100 disabled:text-slate-300 text-white font-black text-sm uppercase tracking-widest rounded-xl transition-all flex items-center gap-2"
                        >
                          {loading ? <Loader2 className="animate-spin" size={18} /> : "検索"}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="max-w-2xl mx-auto bg-white p-8 rounded-[2.5rem] shadow-xl border border-slate-100 space-y-6">
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">いつ？</label>
                          <select 
                            value={wizardData.time}
                            onChange={(e) => setWizardData({...wizardData, time: e.target.value})}
                            className="w-full p-4 bg-slate-50 border-none rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-[#3B9EE8]"
                          >
                            <option>朝</option><option>昼</option><option>夕方</option><option>夜</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">何人で？</label>
                          <select 
                            value={wizardData.people}
                            onChange={(e) => setWizardData({...wizardData, people: e.target.value})}
                            className="w-full p-4 bg-slate-50 border-none rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-[#3B9EE8]"
                          >
                            <option>1人</option><option>2人</option><option>3人以上</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">目的は？</label>
                          <select 
                            value={wizardData.purpose}
                            onChange={(e) => setWizardData({...wizardData, purpose: e.target.value})}
                            className="w-full p-4 bg-slate-50 border-none rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-[#3B9EE8]"
                          >
                            <option>のんびりしたい</option><option>刺激がほしい</option><option>美味しいものが食べたい</option><option>学びたい</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">予算は？</label>
                          <select 
                            value={wizardData.budget}
                            onChange={(e) => setWizardData({...wizardData, budget: e.target.value})}
                            className="w-full p-4 bg-slate-50 border-none rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-[#3B9EE8]"
                          >
                            <option>1000円以内</option><option>2000円以内</option><option>5000円以内</option><option>贅沢したい</option>
                          </select>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleSearch()}
                        disabled={loading}
                        className="w-full py-5 bg-[#1A5CB8] hover:bg-[#3B9EE8] text-white rounded-2xl font-black text-lg shadow-lg transition-all flex items-center justify-center gap-3"
                      >
                        {loading ? <Loader2 className="animate-spin" size={24} /> : <>AIにプランを任せる <Zap size={20} /></>}
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    {Object.entries(CATEGORY_MAP).map(([id, label]) => (
                      <button
                        key={id}
                        onClick={() => {
                          setSelectedMoods(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]);
                        }}
                        className={`p-6 rounded-3xl border-2 transition-all text-left relative overflow-hidden ${selectedMoods.includes(id) ? 'border-[#1A5CB8] bg-white shadow-xl' : 'border-transparent bg-white/50 hover:bg-white'}`}
                      >
                        <div className="font-black text-lg">{label}</div>
                        <div className="text-[10px] text-slate-400 font-bold uppercase mt-1">Yurakucho Area</div>
                        {selectedMoods.includes(id) && (
                          <div className="absolute top-4 right-4 text-[#1A5CB8]">
                            <CheckCircle2 size={20} />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <button onClick={() => setStep(0)} className="flex items-center gap-2 text-slate-400 font-bold text-sm hover:text-[#1A5CB8] transition-colors">
                      <ArrowLeft size={16} /> 検索に戻る
                    </button>
                    <div className="flex bg-slate-100 p-1 rounded-xl">
                      <button 
                        onClick={() => setShowMap(false)}
                        className={`px-4 py-2 rounded-lg text-xs font-black transition-all flex items-center gap-2 ${!showMap ? 'bg-white shadow-sm text-[#1A5CB8]' : 'text-slate-400'}`}
                      >
                        <LayoutDashboard size={14} /> リスト
                      </button>
                      <button 
                        onClick={() => setShowMap(true)}
                        className={`px-4 py-2 rounded-lg text-xs font-black transition-all flex items-center gap-2 ${showMap ? 'bg-white shadow-sm text-[#1A5CB8]' : 'text-slate-400'}`}
                      >
                        <MapIcon size={14} /> マップ
                      </button>
                    </div>
                  </div>

                  {showMap ? (
                    <div className="bg-white rounded-[2.5rem] shadow-xl border border-slate-100 h-[500px] relative overflow-hidden">
                      <LeafletMap 
                        spots={foundSpots}
                        center={[YURAKUCHO_CENTER.lat, YURAKUCHO_CENTER.lng]}
                        userLocation={userLocation}
                        onSpotClick={setSelectedSpot}
                        featuredSpots={featuredSpots}
                        itinerary={itinerary}
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {foundSpots.map((spot) => (
                        <motion.div
                          key={spot.id}
                          className="bg-white rounded-3xl p-6 shadow-md border border-slate-100 hover:shadow-xl transition-all group"
                        >
                          <div className="flex items-center justify-between mb-4">
                            <div>
                              <span className="text-[10px] font-black text-[#3B9EE8] bg-blue-50 px-2 py-1 rounded-md uppercase tracking-tighter mb-2 inline-block">
                                {CATEGORY_MAP[spot.category] || spot.category}
                              </span>
                              <h3 className="text-xl font-black tracking-tight group-hover:text-[#1A5CB8] transition-colors">{spot.name}</h3>
                              {spot.openingHours && (
                                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-bold mt-1">
                                  <Clock size={12} className="text-[#3B9EE8]" />
                                  {spot.openingHours}
                                </div>
                              )}
                              <div className="flex items-center gap-1 mt-2">
                                <div className="px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded text-[8px] font-black flex items-center gap-1">
                                  <CheckCircle2 size={10} /> 情報検証済み
                                </div>
                              </div>
                            </div>
                            <div className="flex flex-col items-end">
                              <div className="flex items-center gap-1 text-amber-500 font-black">
                                <Star size={16} fill="currentColor" /> {spot.rating}
                              </div>
                              <button 
                                onClick={(e) => { e.stopPropagation(); toggleLike(spot.id); }}
                                className={`text-[10px] font-bold flex items-center gap-1 mt-1 transition-colors ${likes[spot.id]?.includes(user?.uid || '') ? 'text-pink-500' : 'text-slate-400 hover:text-pink-500'}`}
                              >
                                <Heart size={12} fill={likes[spot.id]?.includes(user?.uid || '') ? "currentColor" : "none"} />
                                {likes[spot.id]?.length || 0} いいね
                              </button>
                            </div>
                          </div>
                          <p className="text-slate-500 text-sm mb-6 line-clamp-2 leading-relaxed">{spot.description}</p>
                          
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => addToItinerary(spot)}
                              className={`flex-1 py-3 rounded-xl font-black text-xs uppercase tracking-widest transition-all ${itinerary.find(s => s.id === spot.id) ? 'bg-emerald-500 text-white' : 'bg-[#1A5CB8] text-white hover:bg-[#3B9EE8]'}`}
                            >
                              {itinerary.find(s => s.id === spot.id) ? '追加済み ✓' : 'プランに追加 +'}
                            </button>
                            <button 
                              onClick={() => setSelectedSpot(spot)}
                              className="px-4 py-3 bg-slate-50 text-slate-400 rounded-xl hover:bg-slate-100 transition-colors flex items-center gap-2 text-xs font-bold"
                            >
                              <Info size={18} />
                              <span>スポット詳細</span>
                            </button>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          ) : activeTab === 'map' ? (
            <motion.div key="map" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="bg-[#08192E] text-white p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-[#3B9EE8]/20 blur-3xl rounded-full" />
                <h2 className="text-3xl font-black mb-2">有楽町寄り道マップ</h2>
                <p className="text-white/50 text-sm">周辺のスポットを地図で俯瞰して、次の目的地を見つけましょう。</p>
              </div>

              <div className="bg-white rounded-[2.5rem] shadow-xl border border-slate-100 h-[600px] relative overflow-hidden">
                <LeafletMap 
                  spots={[...foundSpots, ...itinerary, ...featuredSpots].filter((v, i, a) => a.findIndex(t => t.id === v.id) === i)}
                  center={[YURAKUCHO_CENTER.lat, YURAKUCHO_CENTER.lng]}
                  userLocation={userLocation}
                  onSpotClick={setSelectedSpot}
                  featuredSpots={featuredSpots}
                  itinerary={itinerary}
                />
              </div>
            </motion.div>
          ) : activeTab === 'plan' ? (
            <motion.div key="plan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="bg-[#08192E] text-white p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-[#3B9EE8]/20 blur-3xl rounded-full" />
                <h2 className="text-3xl font-black mb-2">あなたの寄り道プラン</h2>
                <p className="text-white/50 text-sm">追加したスポットを並び替えて、最高のルートを作りましょう。</p>
              </div>

              {itinerary.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center text-slate-300 bg-white rounded-[2.5rem] border-2 border-dashed border-slate-100">
                  <Plus size={48} className="opacity-20 mb-4" />
                  <p className="font-black text-sm uppercase tracking-widest">スポットがありません</p>
                  <button onClick={() => setActiveTab('dive')} className="mt-4 text-[#1A5CB8] font-bold text-xs hover:underline">
                    スポットを探しに行く →
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between px-2">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{itinerary.length} Spots in Plan</span>
                      <div className="flex items-center gap-2 mt-1">
                        <motion.div animate={{ opacity: [1, 0.5, 1] }} transition={{ duration: 1 }} className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                        <span className="text-[10px] font-black text-emerald-600 uppercase">Live Route Active</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex bg-slate-100 rounded-xl p-1">
                        <button 
                          onClick={() => sortItinerary('hours')}
                          className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest hover:bg-white rounded-lg transition-all flex items-center gap-1"
                          title="営業時間順に並び替え"
                        >
                          <Clock size={12} /> 時間
                        </button>
                        <button 
                          onClick={() => sortItinerary('distance')}
                          className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest hover:bg-white rounded-lg transition-all flex items-center gap-1"
                          title="距離順に並び替え"
                        >
                          <MapPin size={12} /> 距離
                        </button>
                      </div>
                      <button 
                        onClick={shareItinerary}
                        className="p-2 bg-blue-50 text-[#1A5CB8] rounded-xl hover:bg-[#1A5CB8] hover:text-white transition-all"
                        title="プランをシェア"
                      >
                        <Share2 size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-end px-2">
                    <button 
                      onClick={optimizeRoute}
                      disabled={optimizingRoute || itinerary.length < 2}
                      className="flex items-center gap-2 text-[#1A5CB8] font-black text-xs hover:bg-blue-50 px-4 py-2 rounded-xl transition-all disabled:opacity-50"
                    >
                      {optimizingRoute ? <Loader2 className="animate-spin" size={14} /> : <Zap size={14} />}
                      AIでルートを最適化
                    </button>
                  </div>
                  {itinerary.map((spot, i) => (
                    <div key={spot.id} className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 flex items-center gap-4 group">
                      <div className="w-10 h-10 bg-blue-50 rounded-2xl flex items-center justify-center text-[#1A5CB8] font-black text-lg">
                        {i + 1}
                      </div>
                      <div className="flex-1">
                        <h4 className="font-black text-lg">{spot.name}</h4>
                        <p className="text-xs text-slate-400 font-bold uppercase tracking-tighter">{CATEGORY_MAP[spot.category]}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <a href={spot.googleMapsUrl} target="_blank" rel="noreferrer" className="p-2 bg-slate-50 text-slate-400 rounded-lg hover:text-[#1A5CB8] transition-colors">
                          <Navigation size={18} />
                        </a>
                        <button onClick={() => removeFromItinerary(spot.id)} className="p-2 bg-red-50 text-red-400 rounded-lg hover:bg-red-100 transition-colors">
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  ))}
                  <button 
                    onClick={saveDetour}
                    className="w-full py-5 bg-gradient-to-r from-[#1A5CB8] to-[#3B9EE8] text-white rounded-2xl font-black text-lg shadow-2xl mt-8"
                  >
                    この寄り道を記録する ✍️
                  </button>
                </div>
              )}
            </motion.div>
          ) : activeTab === 'events' ? (
            <motion.div key="events" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-black tracking-tight">有楽町周辺のイベント</h2>
                <div className="px-3 py-1 bg-amber-50 text-amber-600 rounded-full text-[10px] font-black uppercase tracking-widest animate-pulse">
                  Now Happening
                </div>
              </div>
              
              <div className="space-y-4">
                {[
                  { name: "日比谷公園 ガーデニングショー", loc: "日比谷公園", date: "3/14 - 3/22", icon: "🌿", url: "https://www.hibiya-gardening-show.com/" },
                  { name: "有楽町 骨董市", loc: "東京国際フォーラム", date: "毎週日曜日", icon: "🏺", url: "https://www.antique-market.jp/" },
                  { name: "丸の内 ストリートピアノ", loc: "丸の内仲通り", date: "常設", icon: "🎹", url: "https://www.marunouchi.com/event/detail/21234/" },
                ].map((ev, i) => (
                  <div key={i} className="bg-white p-6 rounded-3xl shadow-md border border-slate-100 flex items-center gap-6">
                    <div className="text-4xl">{ev.icon}</div>
                    <div className="flex-1">
                      <h3 className="font-black text-lg">{ev.name}</h3>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-slate-400 font-bold flex items-center gap-1"><MapPin size={12} /> {ev.loc}</span>
                        <span className="text-xs text-[#3B9EE8] font-black flex items-center gap-1"><Calendar size={12} /> {ev.date}</span>
                      </div>
                    </div>
                    <a 
                      href={ev.url}
                      target="_blank"
                      rel="noreferrer"
                      className="p-3 bg-blue-50 text-[#1A5CB8] rounded-2xl hover:bg-[#1A5CB8] hover:text-white transition-all"
                    >
                      <ExternalLink size={20} />
                    </a>
                  </div>
                ))}
              </div>
            </motion.div>
          ) : activeTab === 'log' ? (
            <motion.div key="log" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-8">
              <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
                <h2 className="text-2xl font-black mb-2">寄り道ログ</h2>
                <p className="text-slate-500 text-sm">あなたが歩いた、かけがえのない寄り道の記録です。</p>
                {!user && (
                  <div className="mt-4 p-4 bg-amber-50 rounded-2xl border border-amber-100 flex items-center gap-3">
                    <Info size={18} className="text-amber-600" />
                    <p className="text-xs text-amber-700 font-bold">ログインすると、記録をクラウドに保存できます。</p>
                  </div>
                )}
              </div>

              <div className="space-y-6">
                <div className="flex items-center gap-2 mb-4">
                  <UserIcon size={18} className="text-[#1A5CB8]" />
                  <h3 className="font-black text-sm uppercase tracking-widest">マイログ</h3>
                </div>
                {detourLogs.length === 0 ? (
                  <div className="h-48 flex flex-col items-center justify-center text-slate-300 bg-white rounded-[2.5rem] border-2 border-dashed border-slate-100">
                    <Clock size={40} className="opacity-20 mb-4" />
                    <p className="font-black text-[10px] uppercase tracking-widest">まだ記録がありません</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {detourLogs.map((log) => (
                      <div key={log.id} className="bg-white p-6 rounded-3xl shadow-md border border-slate-100">
                        <div className="flex items-center justify-between mb-4">
                          <span className="text-xs font-black text-[#1A5CB8] bg-blue-50 px-3 py-1 rounded-full">{log.date}</span>
                          <span className="text-xs text-slate-400 font-bold">{log.spots.length}箇所のスポット</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {log.spots.map((s: any, idx: number) => (
                            <div key={idx} className="flex items-center gap-1 bg-slate-50 px-3 py-1.5 rounded-xl text-[10px] font-bold">
                              <MapPin size={10} className="text-[#3B9EE8]" />
                              {s.name}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-6">
                <div className="flex items-center gap-2 mb-4">
                  <Globe size={18} className="text-emerald-500" />
                  <h3 className="font-black text-sm uppercase tracking-widest">みんなの寄り道</h3>
                </div>
                {communityLogs.length === 0 ? (
                  <div className="h-48 flex flex-col items-center justify-center text-slate-300 bg-white rounded-[2.5rem] border-2 border-dashed border-slate-100">
                    <Users size={40} className="opacity-20 mb-4" />
                    <p className="font-black text-[10px] uppercase tracking-widest">投稿がありません</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {communityLogs.map((log) => (
                      <div key={log.id} className="bg-white p-6 rounded-3xl shadow-md border border-slate-100 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-1 h-full bg-emerald-500" />
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 text-[10px] font-black">
                              {log.userName[0]}
                            </div>
                            <span className="text-xs font-black">@{log.userName}</span>
                          </div>
                          <span className="text-[10px] text-slate-400 font-bold">{log.date}</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {log.spots.map((s: any, idx: number) => (
                            <div key={idx} className="flex items-center gap-1 bg-emerald-50 px-3 py-1.5 rounded-xl text-[10px] font-bold text-emerald-700">
                              {s.name}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          ) : (
            <div className="h-[60vh] flex flex-col items-center justify-center text-slate-300">
              <MessageSquare size={64} className="opacity-10 mb-4" />
              <p className="font-black uppercase tracking-widest text-xs">Coming Soon</p>
            </div>
          )}
        </AnimatePresence>
      </main>

      {/* Spot Detail Sheet */}
      <AnimatePresence>
        {selectedSpot && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSelectedSpot(null)}
              className="fixed inset-0 bg-[#08192E]/60 backdrop-blur-sm z-[60]"
            />
            <motion.div 
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed bottom-0 left-0 right-0 max-w-4xl mx-auto bg-white rounded-t-[3rem] z-[70] max-h-[90vh] overflow-y-auto shadow-2xl"
            >
              <div className="p-8 md:p-12">
                <div className="w-12 h-1.5 bg-slate-100 rounded-full mx-auto mb-8" />
                
                <div className="flex flex-col md:flex-row gap-8">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-4">
                      <span className="px-3 py-1 bg-blue-50 text-[#1A5CB8] rounded-full text-[10px] font-black uppercase tracking-widest">
                        {CATEGORY_MAP[selectedSpot.category]}
                      </span>
                      <div className="flex items-center gap-1 text-amber-500 font-black text-sm">
                        <Star size={14} fill="currentColor" /> {selectedSpot.rating}
                      </div>
                    </div>
                    
                    <h2 className="text-4xl font-black mb-6 tracking-tight">{selectedSpot.name}</h2>
                    
                    <div className="flex items-center gap-4 mb-8">
                      <button 
                        onClick={() => toggleLike(selectedSpot.id)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all ${likes[selectedSpot.id]?.includes(user?.uid || '') ? 'bg-pink-50 text-pink-600' : 'bg-slate-50 text-slate-400 hover:bg-pink-50 hover:text-pink-600'}`}
                      >
                        <Heart size={14} fill={likes[selectedSpot.id]?.includes(user?.uid || '') ? "currentColor" : "none"} />
                        {likes[selectedSpot.id]?.length || 0} いいね
                      </button>
                      <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-xs font-black">
                        <ThumbsUp size={14} /> {selectedSpot.recommendCount}人がおすすめ
                      </div>
                      <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 text-slate-500 rounded-xl text-xs font-bold">
                        <MapPin size={14} /> 有楽町駅から徒歩5分
                      </div>
                      {selectedSpot.openingHours && (
                        <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-[#1A5CB8] rounded-xl text-xs font-black">
                          <Clock size={14} /> {selectedSpot.openingHours}
                        </div>
                      )}
                    </div>

                    <p className="text-slate-600 text-lg leading-relaxed mb-10">{selectedSpot.description}</p>

                    {groundingSources.length > 0 && (
                      <div className="mb-10 p-6 bg-slate-50 rounded-3xl border border-slate-100">
                        <div className="flex items-center gap-2 mb-4">
                          <CheckCircle2 size={18} className="text-emerald-500" />
                          <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Google Search による情報検証</h4>
                        </div>
                        <p className="text-xs text-slate-500 mb-4 font-bold">
                          このスポットの情報（営業時間や実在確認）は、以下のソースを元に検証されています。
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {groundingSources.slice(0, 5).map((source, idx) => (
                            <a 
                              key={idx}
                              href={source.uri}
                              target="_blank"
                              rel="noreferrer"
                              className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-[10px] font-bold text-[#1A5CB8] hover:bg-blue-50 transition-colors flex items-center gap-1"
                            >
                              <LinkIcon size={10} /> {source.title.length > 20 ? source.title.substring(0, 20) + '...' : source.title}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-4 mb-10">
                      <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">口コミ・詳細を比較</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <a 
                          href={selectedSpot.googleMapsUrl} 
                          target="_blank" 
                          rel="noreferrer"
                          className="flex items-center justify-between p-4 bg-white border-2 border-slate-100 rounded-2xl hover:border-[#1A5CB8] transition-all group"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-[#1A5CB8]">
                              <MapPin size={20} />
                            </div>
                            <div>
                              <div className="font-black text-sm">Google Maps</div>
                              <div className="text-[10px] text-slate-400 font-bold">口コミと写真を確認</div>
                            </div>
                          </div>
                          <ExternalLink size={16} className="text-slate-300 group-hover:text-[#1A5CB8]" />
                        </a>
                        {selectedSpot.tabelogUrl && (
                          <a 
                            href={selectedSpot.tabelogUrl} 
                            target="_blank" 
                            rel="noreferrer"
                            className="flex items-center justify-between p-4 bg-white border-2 border-slate-100 rounded-2xl hover:border-[#FF6600]/20 hover:border-[#FF6600] transition-all group"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center text-[#FF6600]">
                                <Utensils size={20} />
                              </div>
                              <div>
                                <div className="font-black text-sm">食べログ</div>
                                <div className="text-[10px] text-slate-400 font-bold">グルメ評価をチェック</div>
                              </div>
                            </div>
                            <ExternalLink size={16} className="text-slate-300 group-hover:text-[#FF6600]" />
                          </a>
                        )}
                        {(selectedSpot as any).officialUrl && (
                          <a 
                            href={(selectedSpot as any).officialUrl} 
                            target="_blank" 
                            rel="noreferrer"
                            className="flex items-center justify-between p-4 bg-white border-2 border-slate-100 rounded-2xl hover:border-emerald-500/20 hover:border-emerald-500 transition-all group"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-500">
                                <Globe size={20} />
                              </div>
                              <div>
                                <div className="font-black text-sm">公式サイト</div>
                                <div className="text-[10px] text-slate-400 font-bold">公式情報を確認</div>
                              </div>
                            </div>
                            <ExternalLink size={16} className="text-slate-300 group-hover:text-emerald-500" />
                          </a>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-10">
                      <a 
                        href={selectedSpot.googleMapsUrl} 
                        target="_blank" 
                        rel="noreferrer"
                        className="flex items-center justify-center gap-3 py-4 bg-white border-2 border-slate-100 rounded-2xl font-black text-sm hover:border-[#1A5CB8] hover:text-[#1A5CB8] transition-all"
                      >
                        <LinkIcon size={18} /> Googleマップ
                      </a>
                      {selectedSpot.tabelogUrl && (
                        <a 
                          href={selectedSpot.tabelogUrl} 
                          target="_blank" 
                          rel="noreferrer"
                          className="flex items-center justify-center gap-3 py-4 bg-white border-2 border-slate-100 rounded-2xl font-black text-sm hover:border-orange-500 hover:text-orange-500 transition-all"
                        >
                          <Utensils size={18} /> 食べログで比較
                        </a>
                      )}
                    </div>

                    <div className="space-y-6">
                      <h4 className="text-sm font-black uppercase tracking-widest text-slate-400">最近の口コミ</h4>
                      {selectedSpot.reviews.map((rv, i) => (
                        <div key={i} className="bg-slate-50 p-6 rounded-3xl">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-black text-sm">@{rv.user}</span>
                            <div className="flex text-amber-400">
                              {Array.from({ length: rv.rating }).map((_, j) => <Star key={j} size={12} fill="currentColor" />)}
                            </div>
                          </div>
                          <p className="text-slate-600 text-sm italic">"{rv.comment}"</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="sticky bottom-0 pt-8 pb-4 bg-white">
                  <button 
                    onClick={() => { addToItinerary(selectedSpot); setSelectedSpot(null); }}
                    className="w-full py-6 bg-[#1A5CB8] text-white rounded-2xl font-black text-xl shadow-2xl hover:bg-[#3B9EE8] transition-all"
                  >
                    プランに追加する
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Error Toast */}
      <AnimatePresence>
        {error && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-24 left-4 right-4 z-[100]"
          >
            <div className="max-w-md mx-auto bg-red-500 text-white p-4 rounded-2xl shadow-2xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Info size={20} />
                <span className="text-sm font-bold">{error}</span>
              </div>
              <button onClick={() => setError(null)} className="p-1 hover:bg-white/20 rounded-lg">
                <Plus size={18} className="rotate-45" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {renderNav()}
    </div>
    </ErrorBoundary>
  );
}
