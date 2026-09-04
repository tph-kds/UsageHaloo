import type { ProviderView, SummaryMetric } from './types';

export const providers: ProviderView[] = [
  { id:'claude', name:'Claude Code', monogram:'C', accent:'#E37D57', primaryLabel:'5-hour limit', primaryPercent:73, primaryReset:'51 min', secondaryLabel:'7-day limit', secondaryPercent:21, secondaryReset:'Thu 00:00', tokensToday:null, costToday:'$0.31 session', freshness:'live', source:'Provider telemetry', scope:'account', enabled:true, pinned:true },
  { id:'codex', name:'Codex', monogram:'X', accent:'#74D9C8', primaryLabel:'Primary window', primaryPercent:28, primaryReset:'2h 12m', secondaryLabel:'Secondary window', secondaryPercent:61, secondaryReset:'4d 8h', freshness:'live', source:'Codex app-server', scope:'account', enabled:true, pinned:true },
  { id:'gemini', name:'Gemini CLI', monogram:'G', accent:'#7C9DFF', primaryLabel:'User budget', primaryPercent:52, primaryReset:'today', tokensToday:'1.42M', costToday:'~$2.94', freshness:'live', source:'OpenTelemetry', scope:'device', enabled:true, pinned:true },
  { id:'openrouter', name:'OpenRouter', monogram:'R', accent:'#B998FF', primaryLabel:'Credits used', primaryPercent:33, primaryReset:null, tokensToday:'3.12M', costToday:'$8.18', freshness:'fresh', source:'Credits API', scope:'account', enabled:true, pinned:true },
  { id:'cursor', name:'Cursor', monogram:'CU', accent:'#F3F4F6', primaryLabel:'Included usage', primaryPercent:38, primaryReset:'billing cycle', tokensToday:'2.08M', costToday:'$4.12', freshness:'hourly', source:'Admin API', scope:'team', enabled:true, pinned:false }
];

export const summaries: SummaryMetric[] = [
  { label:'Observed tokens', value:'8.42M', meta:'+14% vs 7-day avg' },
  { label:'Provider cost', value:'$12.30', meta:'+ ~$2.44 estimated separately' },
  { label:'Requests', value:'843', meta:'5 active providers today' },
  { label:'AI active time', value:'4h 21m', meta:'device-observed only' }
];
