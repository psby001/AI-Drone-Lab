import type { Mission } from '../missions/types';

/** Non-secret limits shared by server and browser. API credentials never live here. */
export const AI_LIMITS = {
  maxInputLength: 1000, maxBodyBytes: 8192, timeoutMs: 25000,
  clientTimeoutMs: 30000, maxOutputTokens: 4096, maxProviderBytes: 262144,
  chatgptTimeoutMs: 60000, chatgptClientTimeoutMs: 65000,
  maxModelCatalogBytes: 4194304, maxStreamBytes: 8388608, maxStreamEventBytes: 1048576,
  maxMessageLength: 600, maxQuestions: 3, maxQuestionLength: 180,
  perIpMinute: 30, perIpHour: 120, globalMinute: 60, globalHour: 600,
  maxConcurrent: 12, maxClients: 5000,
} as const;
export type AiResult =
  | { status: 'ready'; message: string; questions: string[]; mission: Mission }
  | { status: 'clarification' | 'rejected'; message: string; questions: string[]; mission: null };
export interface AiErrorBody { error: { code: string; message: string; details?: string[] }; retryAfter?: number }
export type AiProvider = 'api_key' | 'chatgpt';
export interface ChatGptStatus {
  enabled:boolean; activeId:string|null;
  accounts:{id:string;label:string;connected:boolean;sharing:boolean}[];
  login:{state:'idle'|'pending'|'processing'|'completed'|'failed';message:string};
}
export const PROMPT_EXAMPLES = [
  '起飛到 5 公尺，向前飛 10 公尺，右轉 90 度，再前進 5 公尺，最後降落。',
  '起飛到 3 公尺，向右平移 4 公尺，懸停 2 秒，再向左平移 4 公尺，最後降落。',
  '設定水平速度 2 公尺每秒，起飛到 4 公尺，飛到本地座標東 5、北 5、高 4 公尺，最後返回起飛點降落。',
  '起飛到 4 公尺，保持高度，機頭沿飛行方向，以不超過每秒 2 公尺的速度順時針飛半徑 5 公尺的一圈，最後降落。',
] as const;
