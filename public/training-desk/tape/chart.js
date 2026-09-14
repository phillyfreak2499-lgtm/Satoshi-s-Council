export const palette={bg:'#091820',grid:'#263b45',ink:'#bfd4dc',muted:'#758f9c',up:'#8dc5be',down:'#d98f76',gold:'#d6b783'};
export function drawChart(canvas,frame,{highlight=false,frozen=false}={}){
 const c=canvas.getContext('2d'),w=canvas.width,h=canvas.height,p=palette;
 c.fillStyle=p.bg;c.fillRect(0,0,w,h);c.fillStyle=p.ink;c.font=`bold ${Math.round(w*.024)}px monospace`;c.fillText('BTC / USD',w*.045,h*.085);c.fillStyle=p.muted;c.font=`${Math.round(w*.016)}px monospace`;c.textAlign='right';c.fillText(frozen?'FROZEN EXERCISE':frame?.practice?'ILLUSTRATED PRACTICE':'TAPE / 1 MINUTE',w*.95,h*.085);c.textAlign='left';
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
