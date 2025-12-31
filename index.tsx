import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Phone, 
  Video, 
  MapPin, 
  AlertCircle, 
  Navigation, 
  User, 
  Info, 
  X, 
  CheckCircle2, 
  Activity,
  Mic,
  MicOff,
  Stethoscope,
  Clock,
  Navigation2,
  Maximize2,
  ChevronRight,
  Wind,
  Compass,
  ArrowUpRight,
  PhoneCall,
  PhoneOff
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, useMap, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';

// --- Types & Constants ---
const SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

interface FirstAidTip {
  title: string;
  instruction: string;
  category: string;
}

// Helper to calculate bearing between two points
const getBearing = (start: [number, number], end: [number, number]) => {
  const startLat = (start[0] * Math.PI) / 180;
  const startLng = (start[1] * Math.PI) / 180;
  const endLat = (end[0] * Math.PI) / 180;
  const endLng = (end[1] * Math.PI) / 180;
  const dLng = endLng - startLng;
  const y = Math.sin(dLng) * Math.cos(endLat);
  const x = Math.cos(startLat) * Math.sin(endLat) - Math.sin(startLat) * Math.cos(endLat) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};

// --- Helper Components ---

const MapAutoFit = ({ ambulancePos, userPos, isTracking, bearing }: { ambulancePos: [number, number], userPos: [number, number], isTracking: boolean, bearing: number }) => {
  const map = useMap();
  useEffect(() => {
    if (isTracking) {
      map.setView(ambulancePos, map.getZoom(), { animate: true, duration: 0.5 });
    }
  }, [ambulancePos, isTracking, map]);
  return null;
};

// --- Main Application ---

const SwiftAidApp = () => {
  const [appState, setAppState] = useState<'idle' | 'emergency' | 'active'>('idle');
  const [isIncomingCall, setIsIncomingCall] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [isVideoActive, setIsVideoActive] = useState(false);
  const [eta, setEta] = useState(7);
  const [location, setLocation] = useState<[number, number]>([51.505, -0.09]);
  const [ambulancePos, setAmbulancePos] = useState<[number, number]>([51.515, -0.11]);
  const [ambulanceBearing, setAmbulanceBearing] = useState(0);
  const [isFollowingAmbulance, setIsFollowingAmbulance] = useState(true);
  
  // Real-style route points (simulating city blocks)
  const [fullRoute, setFullRoute] = useState<[number, number][]>([]);
  const [currentRouteIndex, setCurrentRouteIndex] = useState(0);
  const [progressInSegment, setProgressInSegment] = useState(0);
  
  const [aiSuggestions, setAiSuggestions] = useState<FirstAidTip[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Custom Icons with rotation support via CSS
  const ambulanceIcon = useMemo(() => new L.DivIcon({
    html: `<div style="transform: rotate(${ambulanceBearing}deg); transition: transform 0.3s ease-out; display: flex; justify-content: center; align-items: center;">
            <img src="https://cdn-icons-png.flaticon.com/512/3063/3063822.png" style="width: 45px; height: 45px;" />
          </div>`,
    className: 'custom-ambulance-icon',
    iconSize: [45, 45],
    iconAnchor: [22, 22],
  }), [ambulanceBearing]);

  const userIcon = new L.Icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/2838/2838912.png',
    iconSize: [38, 38],
    iconAnchor: [19, 38],
  });

  // Generate a realistic "Street-like" path on load
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        const userLoc: [number, number] = [pos.coords.latitude, pos.coords.longitude];
        setLocation(userLoc);
        
        // Mock a complex route
        const startLat = userLoc[0] + 0.015;
        const startLng = userLoc[1] + 0.015;
        const route: [number, number][] = [
          [startLat, startLng],
          [startLat, userLoc[1] + 0.01],
          [userLoc[0] + 0.005, userLoc[1] + 0.01],
          [userLoc[0] + 0.005, userLoc[1]],
          userLoc
        ];
        
        setFullRoute(route);
        setAmbulancePos(route[0]);
      });
    }
  }, []);

  // Smooth Interpolated Tracking Logic (Google Maps style)
  useEffect(() => {
    let animationTimer: number;
    if (appState === 'active' && currentRouteIndex < fullRoute.length - 1) {
      const start = fullRoute[currentRouteIndex];
      const end = fullRoute[currentRouteIndex + 1];
      const stepSize = 0.002;
      
      animationTimer = window.setInterval(() => {
        setProgressInSegment(prev => {
          const nextProgress = prev + stepSize;
          if (nextProgress >= 1) {
            setCurrentRouteIndex(idx => idx + 1);
            return 0;
          }
          const lat = start[0] + (end[0] - start[0]) * nextProgress;
          const lng = start[1] + (end[1] - start[1]) * nextProgress;
          setAmbulancePos([lat, lng]);
          setAmbulanceBearing(getBearing(start, end));
          const remainingSegments = fullRoute.length - 1 - currentRouteIndex;
          setEta(Math.max(1, Math.ceil((remainingSegments - 1 + (1 - nextProgress)) * 3)));
          return nextProgress;
        });
      }, 30);
    }
    return () => clearInterval(animationTimer);
  }, [appState, currentRouteIndex, fullRoute]);

  const triggerSOS = () => {
    setAppState('emergency');
    setTimeout(() => {
      setAppState('active');
      setAiSuggestions([
        { title: "Apply Direct Pressure", instruction: "Use the cleanest available cloth and push down hard on the wound.", category: "Trauma" },
        { title: "Elevate Area", instruction: "If possible, keep the injured limb above the level of the heart.", category: "Trauma" },
        { title: "Monitor Airways", instruction: "Ensure the patient's mouth is clear and they are breathing steadily.", category: "Critical" }
      ]);
      // Trigger Incoming Call after a few seconds of tracking
      setTimeout(() => setIsIncomingCall(true), 3000);
    }, 2500);
  };

  const acceptCall = () => {
    setIsIncomingCall(false);
    startCall(true);
  };

  const declineCall = () => {
    setIsIncomingCall(false);
  };

  const startCall = (withVideo: boolean) => {
    setIsCalling(true);
    setIsVideoActive(withVideo);
    initLiveSession();
  };

  const endCall = () => {
    setIsCalling(false);
    setIsVideoActive(false);
    if (audioContextRef.current) audioContextRef.current.close();
    if (outputAudioContextRef.current) outputAudioContextRef.current.close();
  };

  const initLiveSession = async () => {
    if (!process.env.API_KEY) return;
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: SAMPLE_RATE });
    outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: OUTPUT_SAMPLE_RATE });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideoActive });
      if (videoRef.current && isVideoActive) videoRef.current.srcObject = stream;
      
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
          systemInstruction: "You are an Emergency Dispatcher. Guide the user through the first-aid checklist while they wait for Marcus in the ambulance.",
        },
        callbacks: {
          onopen: () => {
            const source = audioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              const bytes = new Uint8Array(int16.buffer);
              let binary = '';
              for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
              sessionPromise.then(s => s.sendRealtimeInput({ media: { data: btoa(binary), mimeType: 'audio/pcm;rate=16000' } }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextRef.current!.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            if (msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data) {
              const base64 = msg.serverContent.modelTurn.parts[0].inlineData.data;
              const ctx = outputAudioContextRef.current!;
              const binary = atob(base64);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
              const dataInt16 = new Int16Array(bytes.buffer);
              const buffer = ctx.createBuffer(1, dataInt16.length, OUTPUT_SAMPLE_RATE);
              const channelData = buffer.getChannelData(0);
              for (let i = 0; i < dataInt16.length; i++) channelData[i] = dataInt16[i] / 32768.0;
              const s = ctx.createBufferSource();
              s.buffer = buffer;
              s.connect(ctx.destination);
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              s.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
            }
          },
        }
      });
    } catch (e) { console.error(e); }
  };

  if (appState === 'idle') {
    return (
      <div className="mobile-container flex flex-col items-center justify-center p-6 bg-[#0B0D15] text-white">
        <div className="text-center mb-16">
          <Activity className="w-24 h-24 text-red-500 mb-6 mx-auto animate-pulse" />
          <h1 className="text-6xl font-black tracking-tighter">SWIFTAID</h1>
          <p className="text-slate-500 font-bold tracking-[0.3em] uppercase text-[11px] mt-2">EMERGENCY RESPONSE UNIT</p>
        </div>
        <button 
          onClick={triggerSOS}
          className="w-72 h-72 rounded-full bg-red-600 flex flex-col items-center justify-center text-white font-black text-7xl shadow-[0_0_100px_rgba(220,38,38,0.5)] hover:bg-red-500 active:scale-95 transition-all pulse-red border-[16px] border-white/5"
        >
          SOS
        </button>
        <p className="mt-16 text-slate-400 text-sm font-medium">Tap SOS to notify control room instantly</p>
      </div>
    );
  }

  if (appState === 'emergency') {
    return (
      <div className="mobile-container flex flex-col items-center justify-center p-8 bg-red-600 text-white">
        <AlertCircle className="w-40 h-40 mb-10 animate-bounce" />
        <h2 className="text-5xl font-black mb-4 text-center tracking-tighter">DISPATCHING</h2>
        <p className="text-center font-bold text-xl opacity-90 leading-tight">Emergency unit assigned.<br/>Location sync active.</p>
      </div>
    );
  }

  return (
    <div className="mobile-container overflow-hidden flex flex-col bg-[#F1F3F4]">
      {/* Live Map Interface */}
      <div className="relative h-[55%] w-full">
        <MapContainer center={location} zoom={17} zoomControl={false} className="h-full w-full">
          <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
          <Polyline positions={fullRoute} color="#4285F4" weight={12} opacity={0.3} lineCap="round" />
          <Polyline positions={[ambulancePos, fullRoute[currentRouteIndex + 1] || ambulancePos]} color="#4285F4" weight={12} lineCap="round" />
          <Marker position={location} icon={userIcon} />
          <Marker position={ambulancePos} icon={ambulanceIcon} />
          <MapAutoFit ambulancePos={ambulancePos} userPos={location} isTracking={isFollowingAmbulance} bearing={ambulanceBearing} />
        </MapContainer>
        
        {/* Navigation Info */}
        <div className="absolute top-6 left-4 right-4 z-[1000] pointer-events-none">
          <div className="bg-[#1A73E8] p-5 rounded-[2.5rem] shadow-2xl flex items-center space-x-5 border border-white/20 pointer-events-auto animate-in slide-in-from-top">
            <div className="bg-white/15 p-4 rounded-[1.5rem]">
              <Navigation2 className="w-8 h-8 text-white fill-current animate-pulse" />
            </div>
            <div className="flex-1">
              <p className="text-white/70 text-[10px] font-black uppercase tracking-widest mb-1">Incoming Response</p>
              <p className="text-white text-2xl font-black leading-none">Arrival in {eta} min</p>
            </div>
          </div>
        </div>

        <div className="absolute bottom-12 right-5 z-[1000] flex flex-col space-y-4">
          <button onClick={() => setIsFollowingAmbulance(!isFollowingAmbulance)} className={`p-5 rounded-[1.5rem] shadow-2xl border transition-all ${isFollowingAmbulance ? 'bg-[#1A73E8] text-white border-transparent' : 'bg-white text-slate-700 border-slate-200'}`}>
            <Navigation className={`w-7 h-7 ${isFollowingAmbulance ? 'fill-current' : ''}`} />
          </button>
        </div>
      </div>

      {/* Control Center Bottom Sheet */}
      <div className="flex-1 bg-white rounded-t-[56px] -mt-10 z-10 shadow-[0_-40px_100px_rgba(0,0,0,0.2)] p-10 overflow-y-auto">
        <div className="w-24 h-1.5 bg-slate-200 rounded-full mx-auto mb-10" />
        
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center space-x-5">
            <div className="w-16 h-16 bg-blue-50 rounded-[1.5rem] flex items-center justify-center border border-blue-100 shadow-sm relative">
              <User className="w-10 h-10 text-blue-600" />
              <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-emerald-500 rounded-full border-2 border-white" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-2xl tracking-tight leading-none mb-1">Marcus Vance</h3>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">EMT Specialist • Unit 108</p>
            </div>
          </div>
          <button onClick={() => startCall(false)} className="w-16 h-16 bg-blue-50 text-blue-600 rounded-[1.5rem] flex items-center justify-center hover:bg-blue-100">
             <Phone className="w-7 h-7" />
          </button>
        </div>

        <div className="space-y-4">
          <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center mb-6">
            <Stethoscope className="w-4 h-4 mr-2 text-red-500" /> AI Guidance
          </h4>
          {aiSuggestions.map((tip, idx) => (
            <div key={idx} className="p-7 bg-slate-50 rounded-[2.5rem] border border-slate-100 flex items-start space-x-6 hover:bg-white hover:shadow-xl transition-all duration-300 group">
              <div className="w-12 h-12 bg-slate-900 text-white rounded-2xl flex items-center justify-center font-black text-xl group-hover:bg-blue-600 transition-colors">
                {idx + 1}
              </div>
              <div>
                <h5 className="font-black text-slate-900 text-lg mb-1">{tip.title}</h5>
                <p className="text-sm text-slate-500 font-medium leading-relaxed">{tip.instruction}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Incoming Call Overlay - The "Request" Step */}
      {isIncomingCall && (
        <div className="absolute inset-0 z-[3000] bg-slate-950/90 backdrop-blur-xl flex flex-col items-center justify-center p-12 text-white animate-in fade-in zoom-in duration-500">
          <div className="relative mb-12">
            <div className="w-48 h-48 bg-blue-500/20 rounded-full animate-ping absolute inset-0" />
            <div className="w-48 h-48 bg-blue-600 rounded-full flex items-center justify-center relative shadow-2xl border-8 border-white/10">
               <Video className="w-24 h-24 text-white" />
            </div>
          </div>
          <h2 className="text-4xl font-black tracking-tighter mb-2 text-center">COMMAND CENTER</h2>
          <p className="text-blue-400 font-bold uppercase tracking-[0.3em] text-xs mb-20">Incoming Video Support</p>
          
          <div className="flex w-full space-x-6">
             <button onClick={declineCall} className="flex-1 bg-white/10 hover:bg-white/20 p-8 rounded-[2.5rem] flex flex-col items-center border border-white/10 transition-all">
                <PhoneOff className="w-10 h-10 text-slate-400 mb-4" />
                <span className="font-black text-xs uppercase tracking-widest text-slate-400">Decline</span>
             </button>
             <button onClick={acceptCall} className="flex-1 bg-emerald-600 hover:bg-emerald-500 p-8 rounded-[2.5rem] flex flex-col items-center shadow-[0_20px_60px_rgba(16,185,129,0.3)] transition-all animate-pulse">
                <PhoneCall className="w-10 h-10 text-white mb-4" />
                <span className="font-black text-xs uppercase tracking-widest text-white">Accept</span>
             </button>
          </div>
        </div>
      )}

      {/* Active Call UI */}
      {isCalling && (
        <div className="absolute inset-0 z-[4000] bg-slate-950 flex flex-col">
          <div className="flex-1 relative">
            {isVideoActive ? (
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover opacity-80" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-[#0F172A]">
                <div className="w-56 h-56 bg-blue-600/10 rounded-full flex items-center justify-center"><User className="w-24 h-24 text-blue-500/50" /></div>
              </div>
            )}
            <div className="absolute top-14 right-8">
              <button onClick={endCall} className="p-6 bg-white/10 backdrop-blur-3xl rounded-full text-white border border-white/20"><X className="w-8 h-8" /></button>
            </div>
            <div className="absolute bottom-12 left-8 right-8 p-10 bg-black/50 backdrop-blur-3xl rounded-[3rem] border border-white/5">
               <div className="flex items-center space-x-3 mb-4">
                  <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                  <p className="text-blue-300 text-[10px] font-black uppercase tracking-widest">Live Dispatcher</p>
               </div>
               <p className="text-white text-2xl font-bold italic">"Marcus is about to turn onto your street. Keep the patient steady."</p>
            </div>
          </div>
          <div className="h-44 flex items-center justify-around px-16 pb-10">
            <button className="w-20 h-20 bg-slate-900 rounded-[2.5rem] flex items-center justify-center"><MicOff className="w-8 h-8 text-slate-600" /></button>
            <button onClick={endCall} className="w-32 h-24 bg-red-600 rounded-[3rem] text-white flex items-center justify-center shadow-2xl"><Phone className="w-12 h-12 rotate-[135deg]" /></button>
            <button onClick={() => setIsVideoActive(!isVideoActive)} className={`w-20 h-20 rounded-[2.5rem] flex items-center justify-center ${isVideoActive ? 'bg-blue-600' : 'bg-slate-900'}`}><Video className="w-8 h-8 text-white" /></button>
          </div>
        </div>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<SwiftAidApp />);
