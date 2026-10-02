export default async function records() {
  const headers={"content-type":"application/json; charset=utf-8","cache-control":"public, max-age=60"};
  try {
    const {botRecords}=await import("../../../src/lib/desk/bot-records.server");
    return new Response(JSON.stringify(await botRecords()),{headers});
  } catch {return new Response(JSON.stringify({error:"Bot track records unavailable"}),{status:503,headers});}
}
