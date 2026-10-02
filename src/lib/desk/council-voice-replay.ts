/** Exact JSON deltas against a durable window baseline. No field selection or
 * quantization: replay retains every serialized input and pre-frame book field. */
type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export type VoicePatch = {path:(string|number)[];value?:Json;remove?:true};
export function voiceReplayDelta(base:unknown,current:unknown):VoicePatch[] {
  const a=JSON.parse(JSON.stringify(base)) as Json,b=JSON.parse(JSON.stringify(current)) as Json,out:VoicePatch[]=[];
  const walk=(x:Json|undefined,y:Json|undefined,path:(string|number)[])=>{
    if(x===y) return;
    if(y===undefined) {out.push({path,remove:true});return;}
    if(x!=null && y!=null && typeof x==="object" && typeof y==="object" && Array.isArray(x)===Array.isArray(y)) {
      if(Array.isArray(x) && Array.isArray(y)) {
        if(x.length!==y.length) {out.push({path,value:y});return;}
        for(let i=0;i<y.length;i++) walk(x[i],y[i],[...path,i]);
      } else {
        for(const k of new Set([...Object.keys(x),...Object.keys(y)])) walk((x as Record<string,Json>)[k],(y as Record<string,Json>)[k],[...path,k]);
      }
      return;
    }
    out.push({path,value:y});
  };
  walk(a,b,[]);return out;
}
export function restoreVoiceReplay(base:unknown,patches:readonly VoicePatch[]):unknown {
  let out=JSON.parse(JSON.stringify(base));
  for(const p of patches) {
    if(!p.path.length) {out=p.value;continue;}
    let parent=out;
    for(const key of p.path.slice(0,-1)) parent=parent[key];
    const key=p.path[p.path.length-1];
    if(p.remove) delete parent[key];
    else Object.defineProperty(parent,key,{value:p.value,writable:true,enumerable:true,configurable:true});
  }
  return out;
}
