export const INVENTORY = Object.freeze([
  {id:'camera',name:'Camera A',stock:2},
  {id:'tripod',name:'Tripod B',stock:3},
  {id:'microphone',name:'Microphone C',stock:1}
]);
export const emptyDraft=()=>({itemId:null,quantity:null,start:null,end:null});
export const itemName=id=>INVENTORY.find(i=>i.id===id)?.name || 'equipment';
export const dayCount=(start,end)=>Math.round((Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000)+1;
export function dateLabel(value){return new Date(value+'T00:00:00Z').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'});}
