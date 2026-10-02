/** Header-only owner report. No activation or mutation through this endpoint. */
export default async function councilVoiceResearch(event:{req:{headers:Headers}}) {
  const {adminKeyOk}=await import("../../../src/lib/desk/admin.server");
  if(!adminKeyOk(event.req.headers.get("x-desk-admin")??"")) return new Response("not found",{status:404});
  try {
    const {voiceCaptureReport}=await import("../../../src/lib/desk/council-voice-collector.server");
    return new Response(JSON.stringify(await voiceCaptureReport()),{headers:{"content-type":"application/json","cache-control":"no-store"}});
  } catch {
    return new Response(JSON.stringify({ok:false,status:"UNVERIFIED"}),{status:503,headers:{"content-type":"application/json","cache-control":"no-store"}});
  }
}
