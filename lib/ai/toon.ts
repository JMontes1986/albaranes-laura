import { encode, decode } from '@toon-format/toon';
export function encodeForLLM(value:unknown){const json=JSON.stringify(value);const toon=encode(value as never);return {payload:toon,metrics:{jsonChars:json.length,toonChars:toon.length,reductionPct:json.length?Math.round((1-toon.length/json.length)*10000)/100:0,estimatedTokens:Math.ceil(toon.length/4)}}}
export function decodeFromLLM<T=unknown>(value:string):T{return decode(value) as T}
export function estimatePayloadSize(value:unknown){const {metrics}=encodeForLLM(value);return metrics}
