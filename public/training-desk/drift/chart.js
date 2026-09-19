const P={bg:"#09151a",grid:"#253841",ink:"#c8d7dc",muted:"#76909b",m5:"#86c7c5",m15:"#d9ba78",m30:"#8a9fc4",up:"#8dc5be",down:"#d98f76"};
const finite=n=>Number.isFinite(Number(n));
const pct=n=>finite(n)?Number(n)*100:0;

function cleanRows(frame){
  return (frame?.snap?.candles_1m||[]).filter(r=>[r.open,r.high,r.low,r.close,r.t].every(finite)).slice(-42);
}
function returnSeries(rows,n){
  return rows.map((r,i)=>{
    const j=Math.max(0,i-n);
    const base=Number(rows[j]?.close);
    const now=Number(r.close);
    return base>0?(now/base-1)*100:0;
  });
}
function line(ctx,values,left,right,top,bottom,maxAbs,color){
  if(!values.length)return;
  const dx=(right-left)/Math.max(1,values.length-1);
  const y=v=>top+(maxAbs-v)/(maxAbs*2)*(bottom-top);
  ctx.strokeStyle=color;ctx.lineWidth=3;ctx.beginPath();
  values.forEach((v,i)=>{const x=left+i*dx,yy=y(v);if(i===0)ctx.moveTo(x,yy);else ctx.lineTo(x,yy);});ctx.stroke();
}
export function drawMomentumChart(canvas,frame,{frozen=false}={}){
  const c=canvas.getContext("2d"),w=canvas.width,h=canvas.height;
  c.fillStyle=P.bg;c.fillRect(0,0,w,h);
  c.fillStyle=P.ink;c.font="bold "+Math.round(w*.023)+"px monospace";c.fillText("BTC / MOMENTUM MAP",w*.045,h*.085);
  c.textAlign="right";c.fillStyle=P.muted;c.font=Math.round(w*.014)+"px monospace";c.fillText(frozen?"FROZEN FRAME":"DRIFT / LIVE TEACHING",w*.95,h*.085);c.textAlign="left";
  const rows=cleanRows(frame);
  if(rows.length<8){c.fillStyle=P.m15;c.font=Math.round(w*.024)+"px monospace";c.fillText("WAITING FOR A CLEAR PATH",w*.12,h*.5);return;}
  const s5=returnSeries(rows,5),s15=returnSeries(rows,15),s30=returnSeries(rows,30);
  const all=[...s5,...s15,...s30].map(Math.abs);const maxAbs=Math.max(.05,...all)*1.12;
  const left=w*.07,right=w*.78,top=h*.2,bottom=h*.82,zero=(top+bottom)/2;
  c.strokeStyle=P.grid;c.lineWidth=1;
  for(let i=0;i<5;i++){const y=top+(bottom-top)*i/4;c.beginPath();c.moveTo(left,y);c.lineTo(right,y);c.stroke();}
  c.setLineDash([6,6]);c.strokeStyle="#66747b";c.beginPath();c.moveTo(left,zero);c.lineTo(right,zero);c.stroke();c.setLineDash([]);
  line(c,s30,left,right,top,bottom,maxAbs,P.m30);line(c,s15,left,right,top,bottom,maxAbs,P.m15);line(c,s5,left,right,top,bottom,maxAbs,P.m5);
  const current=[["5M",pct(frame?.snap?.ret5),P.m5],["15M",pct(frame?.snap?.ret15),P.m15],["30M",pct(frame?.snap?.ret30),P.m30]];
  c.font="bold "+Math.round(w*.015)+"px monospace";
  current.forEach((row,i)=>{const y=h*(.34+i*.16);c.fillStyle=row[2];c.fillText(row[0],w*.82,y);c.textAlign="right";c.fillText((row[1]>=0?"+":"")+row[1].toFixed(2)+"%",w*.95,y);c.textAlign="left";});
  c.fillStyle=P.muted;c.font=Math.round(w*.012)+"px monospace";c.fillText("RETURN FROM EACH LOOKBACK / SAME PRICE PATH",left,h*.94);
}
export function drawPractice(canvas){
  const c=canvas.getContext("2d"),w=canvas.width,h=canvas.height;c.fillStyle=P.bg;c.fillRect(0,0,w,h);
  const tracks=[{label:"5M",vals:[.02,.1,.17,.25,.38,.52],color:P.m5},{label:"15M",vals:[.08,.15,.22,.30,.39,.47],color:P.m15},{label:"30M",vals:[.14,.19,.25,.31,.36,.42],color:P.m30}];
  const left=w*.12,right=w*.9,top=h*.15,gap=h*.24;
  tracks.forEach((t,idx)=>{const y=top+idx*gap;c.fillStyle=t.color;c.font="bold "+Math.round(w*.018)+"px monospace";c.fillText(t.label,w*.035,y+8);c.strokeStyle="#253841";c.beginPath();c.moveTo(left,y);c.lineTo(right,y);c.stroke();c.strokeStyle=t.color;c.lineWidth=4;c.beginPath();t.vals.forEach((v,i)=>{const x=left+(right-left)*i/(t.vals.length-1),yy=y-v*h*.22;if(i===0)c.moveTo(x,yy);else c.lineTo(x,yy);});c.stroke();});
  c.fillStyle=P.m15;c.font=Math.round(w*.014)+"px monospace";c.fillText("ILLUSTRATED: THREE CLOCKS, SAME DIRECTION",w*.12,h*.92);
}
