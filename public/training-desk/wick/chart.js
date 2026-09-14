export const palette={bg:'#091820',grid:'#263b45',ink:'#bfd4dc',muted:'#758f9c',up:'#8dc5be',down:'#d98f76',gold:'#d6b783'};
export function drawChart(canvas,frame,{highlight=false,frozen=false}={}){
 const c=canvas.getContext('2d'),w=canvas.width,h=canvas.height,p=palette;
 c.fillStyle=p.bg;c.fillRect(0,0,w,h);c.fillStyle=p.ink;c.font=`bold ${Math.round(w*.024)}px monospace`;c.fillText('BTC / USD',w*.045,h*.085);c.fillStyle=p.muted;c.font=`${Math.round(w*.016)}px monospace`;c.textAlign='right';c.fillText(frozen?'FROZEN EXERCISE':frame?.practice?'ILLUSTRATED PRACTICE':'WICK / 1 MINUTE',w*.95,h*.085);c.textAlign='left';
 const rows=(frame?.snap?.candles_1m||[]).filter(r=>[r.open,r.high,r.low,r.close,r.t].every(Number.isFinite)).slice(-30);
 if(!rows.length){c.font=`${Math.round(w*.025)}px monospace`;c.fillStyle=p.gold;c.fillText('WAITING FOR A CLEAR FEED',w*.12,h*.5);return;}
 const left=w*.065,right=w*.87,top=h*.18,bottom=h*.83;
 const values=rows.flatMap(r=>[r.low,r.high]);if(Number.isFinite(frame.snap.strike))values.push(frame.snap.strike);
 let low=Math.min(...values),high=Math.max(...values),range=Math.max(high-low,1);low-=range*.13;high+=range*.13;range=high-low;
 const y=n=>bottom-(n-low)/range*(bottom-top),dx=(right-left)/rows.length;
 c.font=`${Math.round(w*.014)}px monospace`;
 for(let i=0;i<5;i++){const val=low+range*i/4,yy=y(val);c.strokeStyle=p.grid;c.lineWidth=1;c.beginPath();c.moveTo(left,yy);c.lineTo(right,yy);c.stroke();c.fillStyle=p.muted;c.fillText(val.toFixed(0),right+w*.014,yy+5);}
 for(let i=0;i<rows.length;i+=5){const xx=left+(i+.5)*dx;c.strokeStyle=p.grid;c.beginPath();c.moveTo(xx,top);c.lineTo(xx,bottom);c.stroke();c.fillStyle=p.muted;c.fillText(new Date(rows[i].t).toISOString().slice(11,16),xx-20,h*.905);}
 let lastClosed=-1;rows.forEach((r,i)=>{if(r.closed===true)lastClosed=i;});
 if(highlight&&lastClosed>=0){c.fillStyle='#e5c77818';c.fillRect(left+lastClosed*dx-3,top,dx+6,bottom-top);}
 rows.forEach((r,i)=>{const xx=left+(i+.5)*dx,closed=r.closed===true;c.globalAlpha=closed?1:.36;c.fillStyle=r.close>=r.open?p.up:p.down;c.strokeStyle=c.fillStyle;c.lineWidth=Math.max(2,w/500);c.beginPath();c.moveTo(xx,y(r.high));c.lineTo(xx,y(r.low));c.stroke();const body=Math.max(3,Math.abs(y(r.open)-y(r.close)));c.fillRect(xx-dx*.27,Math.min(y(r.open),y(r.close)),dx*.54,body);c.globalAlpha=1;if(i===lastClosed&&highlight){c.strokeStyle=p.gold;c.lineWidth=2;c.strokeRect(xx-dx*.45,y(r.high)-8,dx*.9,y(r.low)-y(r.high)+16);c.fillStyle=p.gold;c.font=`bold ${Math.round(w*.016)}px monospace`;c.textAlign='right';c.fillText('LAST CLOSED',Math.min(xx+15,right),top-10);c.textAlign='left';}});
 if(Number.isFinite(frame.snap.strike)){const yy=y(frame.snap.strike);c.strokeStyle=p.gold;c.setLineDash([7,6]);c.beginPath();c.moveTo(left,yy);c.lineTo(right,yy);c.stroke();c.setLineDash([]);c.fillStyle=p.gold;c.font=`${Math.round(w*.014)}px monospace`;c.fillText('STRIKE',left+7,yy-7);}
 c.fillStyle=p.muted;c.font=`${Math.round(w*.013)}px monospace`;c.fillText('UTC  /  CLOSED CANDLES ONLY',left,h*.97);
}
export function drawNotes(canvas,frame,fresh){
 const c=canvas.getContext('2d'),w=canvas.width,h=canvas.height,v=frame?.wick;
 c.fillStyle='#182822';c.fillRect(0,0,w,h);c.fillStyle='#b5bda0';c.font='25px monospace';c.fillText('WICK / OBSERVATIONS',40,65);c.fillStyle='#687c65';c.fillRect(40,93,w-80,2);
 c.fillStyle='#a9bba4';c.font='24px monospace';c.fillText('SEAT DECISION',40,160);c.fillStyle='#e8c78d';c.font='bold 88px monospace';c.fillText(fresh?(v?.lean||'—'):'PAUSED',35,258);
 c.font='24px monospace';c.fillStyle='#a9bba4';const loc=v?.features?.loc||frame?.snap?.location||'UNKNOWN';c.fillText('LOCATION',40,335);c.fillStyle='#dee2c2';c.font='bold 38px monospace';c.fillText(loc,40,388);
 c.font='24px monospace';c.fillStyle='#a9bba4';c.fillText('CANDLE PATTERN',40,465);c.fillStyle='#dee2c2';c.font='bold 34px monospace';c.fillText(String(v?.features?.pattern||'NOT PRINTED').slice(0,16),40,515);
 c.fillStyle='#687c65';c.fillRect(40,561,w-80,2);c.fillStyle='#d4c69c';c.font='26px monospace';['CLOSE FIRST.','CONTEXT SECOND.','THEN A DECISION.'].forEach((s,i)=>c.fillText(s,40,620+i*45));
 c.font='21px monospace';c.fillStyle=fresh?'#9dc4a0':'#d69768';c.fillText(frame?.practice?'PRACTICE / NOT LIVE':fresh?'CONNECTED TO THE FLOOR':'WAITING FOR FRESH DATA',40,h-45);
}
