/** Deterministic, compositional slot extraction. No clock, network, or booking side effects. */
const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const units = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const tens = ['twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
const ordinals = ['first','second','third','fourth','fifth','sixth','seventh','eighth','ninth','tenth','eleventh','twelfth','thirteenth','fourteenth','fifteenth','sixteenth','seventeenth','eighteenth','nineteenth','twentieth','thirtieth'];
const ordinalValues = [...Array.from({length:20},(_,i)=>i+1),30];
const catalog = [{id:'camera',re:/\bcameras?(?:\s+a\b)?/g},{id:'tripod',re:/\btripods?(?:\s+b\b)?/g},{id:'microphone',re:/\b(?:microphones?|mics?)(?:\s+c\b)?/g}];
export function validDate(value) {
 if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
 const d = new Date(value+'T00:00:00Z');
 return Number.isFinite(+d) && d.toISOString().slice(0,10) === value;
}
export function dateLabel(value) {
 return validDate(value) ? new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z')) : value;
 }
function normalize(text) {
 let s = String(text || '').toLowerCase()
  .replace(/\b(?:two thousand(?: and)?|twenty) (twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[ -](one|two|three|four|five|six|seven|eight|nine))?\b/g, (_,t,u) => String(2000 + (tens.indexOf(t)+2)*10 + (u ? units.indexOf(u) : 0)))
  .replace(/\b(?:a )?couple of\b/g,'2')
  .replace(/[’]/g,"'")
  .replace(/([a-z])(\d)|(\d)([a-z])/g,(_,a,b,c,d)=>a?`${a} ${b}`:`${c} ${d}`)
  .replace(/\b(\d+)\s+(st|nd|rd|th)\b/g,'$1')
  .replace(/\b(twenty|thirty)[ -](first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)\b/g,(_,t,u)=>String((t==='twenty'?20:30)+ordinals.indexOf(u)+1));
 s=s.replace(new RegExp(`\\b(${ordinals.join('|')})\\b`,'g'),v=>String(ordinalValues[ordinals.indexOf(v)]));
 s=s.replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[ -](one|two|three|four|five|six|seven|eight|nine)\b/g,(_,t,u)=>String((tens.indexOf(t)+2)*10+units.indexOf(u)));
 s=s.replace(new RegExp(`\\b(${units.join('|')}|${tens.join('|')})\\b`,'g'),v=>String(units.includes(v)?units.indexOf(v):(tens.indexOf(v)+2)*10));
 return s.replace(/\s+/g,' ').trim();
}
function issue(slot,prompt,patch={},extra={}) { return {intent:'update',patch,issue:{slot,prompt,...extra}};
 }
function iso(part,year) { return `${year}-${String(part.month).padStart(2,'0')}-${String(part.day).padStart(2,'0')}`;
 }
function applyDates(parts, patch, draft, mode) {
 const values=parts.map(p=>iso(p,p.year));
 if(values.some(v=>!validDate(v))) return issue('dates','That date does not exist. What exact start and end dates should I use?',patch);
 const proposed={...draft,...patch};
 if (parts.length===2) { proposed.start=values[0];
 proposed.end=values[1];
 }
 else if(mode==='end') proposed.end=values[0];
 else if(mode==='start') proposed.start=values[0];
 else return issue('dates','What are the start and end dates? Please say both, even for a one-day booking.',patch);
 if(proposed.start && proposed.end) {
  const days=(Date.parse(proposed.end)-Date.parse(proposed.start))/86400000+1;
  if(days<1 || days>366) return issue('dates',days<1?'The end is before the start. What date range should I use?':'Please choose a booking of no more than 366 days.',patch);
 }
 return {intent:'update',patch:{...patch,...(parts.length===2?{start:values[0],end:values[1]}:{[mode]:values[0]})},pending:null};
}
export function interpret(text, context={}) {
 const {draft={},pending=null}=context;
 let s=normalize(text);
 const patch={};
 if(!s) return {intent:'unknown',patch,issue:{slot:'intent',prompt:'I did not catch any speech. Please try again.'}};
 if(/\b(?:excluding|exclude|weekdays? only|weekends? only|business days?|every other|excepting)\b/.test(s)) return issue('dates','This demo reserves every day in one inclusive range. What exact uninterrupted start and end dates would you like?',{start:null,end:null});
 if(/\b(if|maybe|perhaps|either|possibly|not sure|might|or)\b/.test(s)) return issue('intent','Which exact equipment, quantity, and dates would you like? I will wait for a definite choice.',{itemId:null,quantity:null,start:null,end:null});
 if(/^(?:please\s+)?(?:cancel(?: (?:it|this|the booking|my booking))?|never mind|nevermind|stop)[.!?]*$/.test(s)) return {intent:'cancel',patch};
 if(!/^(?:please)?[.!?]*$/.test(s) && /^(?:(?:yes|yeah|yep|okay|ok|sure)[, ]*)?(?:please|confirm(?: it| booking| the booking)?|book it|reserve it|go ahead(?: and (?:book|reserve)(?: it)?)?|that(?: looks| is|'s) (?:right|correct)|looks (?:right|good))?[.!?]*$/.test(s)) return {intent:'confirm',patch};
 if(/^(?:please )?(?:repeat(?: that)?|say that again|what did you say)[.!?]*$/.test(s)) return {intent:'repeat',patch};
 const replacement=/\bnot\s+\d+[, ]+(?:make (?:that|it)|change (?:it|that) to)\s+\d+/;
 const remainingNegation=s.replace(replacement,'');
 if(/\b(?:no|no longer|never|refuse|cancel|not|don'?t|do not|without|except|remove|delete)\b/.test(remainingNegation)) {
  const rejectsItem = catalog.some(item => new RegExp(item.re.source).test(s));
  const rejectsDates = new RegExp(`\\b(?:${months.join('|')}|dates?|start|end|tomorrow|today)\\b`).test(s);
  const rejected = rejectsItem && !rejectsDates ? {itemId:null,quantity:null}
   : rejectsDates && !rejectsItem ? {start:null,end:null}
   : {itemId:null,quantity:null,start:null,end:null};
  return issue('intent','What would you like instead? Please state the replacement equipment, quantity, or dates.',rejected);
 }
 if(/^(?:(?:please )?review (?:my |the )?(?:booking|request|reservation)|what did i ask for)[?!.]*$/.test(s)) return {intent:'question',patch,question:'status'};
 const question=/\?|^(?:what|which|how|when|why|where|is there|are there|do you|can you tell)\b/.test(s) && !/^(?:can|could|would) (?:you|i) (?:please )?(?:book|reserve|rent|have|get|set aside)\b/.test(s);
 if(question) {
  const q=/\b(cost|price|charge|much)\b/.test(s)?'cost':/\b(available|availability|free)\b/.test(s)?'availability':/\b(status|booking|reserved|summary)\b/.test(s)?'status':/\b(equipment|items|catalog|rent|offer|have)\b/.test(s)?'catalog':/\b(help|work|use)\b/.test(s)?'help':'other';
 if(q==='availability') {
   const request=s.replace(/[?]/g,'')
  .replace(/^(?:are|is|do you have|can i get)\s+/,'')
  .replace(/\b(?:available|availability|free)\b/g,'');
 const slots=interpret('reserve '+request,context);
 return {intent:'question',patch:slots.patch,question:q,...(slots.issue?{issue:slots.issue}:{}),...(slots.pending?{pending:slots.pending}:{})};
 } return {intent:'question',patch,question:q};
 }
 if(pending?.kind==='year' && /^(?:(?:in|year|the year|make it) )?\d{4}[.!]*$/.test(s)) {
  const year=Number(s.match(/\d{4}/)[0]);
 return applyDates(pending.parts.map(p=>({...p,year:p.year||year})),{},draft,pending.mode);
 }
 const itemResult = extractItemQuantity(s,context);
 const dateResult = extractDates(s, draft);
 const merged = {...itemResult.patch, ...dateResult.patch};
 // Independent, explicitly grounded slots survive a clarification elsewhere.
 if (itemResult.issue) return {...itemResult, patch:merged};
 if (dateResult.issue) return {...dateResult, patch:merged};
 if (Object.keys(merged).length) return {intent:'update',patch:merged,pending:null};
 return {intent:'unknown',patch:{},issue:{slot:'intent',prompt:'Tell me the equipment and quantity, such as “two Tripod B”, or ask what is available.'}};
}
function extractItemQuantity(s,context) {
 const patch = {};
 const dateStart = s.search(new RegExp(`\\b(?:${months.join('|')}|\\d{4}-\\d{2}-\\d{2}|from|dates?|year|until|starting|ending)\\b`));
 const nounPhrase = dateStart < 0 ? s : s.slice(0,dateStart);
 const knownTypes = catalog.filter(item => new RegExp(item.re.source).test(s));
 if (knownTypes.length > 1) return issue('itemId','Please choose one equipment type: Camera A, Tripod B, or Microphone C.',{}, {candidates:knownTypes.map(item=>item.id)});
 const correction = nounPhrase.match(/\b(?:quantity(?: to| is| of)?|make (?:that|it)|change (?:it|that|the quantity) to)\s+(\d+)\b/);
 const hits=catalog.flatMap(item=>[...s.matchAll(item.re)].map(m=>({id:item.id,index:m.index,end:m.index+m[0].length,text:m[0]}))).sort((a,b)=>a.index-b.index);
 // A complete count reply is grounded by the known item or an explicit quantity
 // question. Do not convert ASR homophones or numbers embedded in other facts.
 const quantityReply=!hits.length && (context.draft?.itemId || context.pending?.slot==='quantity')
  ? s.match(/^(?:(?:actually|just|only|please)[, ]+)?(?:(?:i (?:need|want)|make it) )?(?:(?:the )?(?:number|quantity)(?: is)? )?(\d+)(?: (?:units?|numbers?))?[, ]*(?:please)?[.!]*$/)
  : null;
 const attachedCounts = hits.map(hit => s.slice(0,hit.index).match(/\b(\d+)\s+(?:(?:number|of|the)\s+)*$/)?.[1]).filter(Boolean);
 if(!correction && new Set(attachedCounts).size > 1) return issue('quantity','I heard different quantities. How many should I reserve?',{quantity:null});
 const beforeItem=hits.length ? s.slice(0,hits[0].index) : '';
 const attached=beforeItem.match(/(?:\b(\d+)\s+(?:(?:number|of|the)\s+)*|\b(a|an)\s+)$/);
 if(attached) patch.quantity=attached[1]?Number(attached[1]):1;
 if(!hits.length) {
  const unknownCount=nounPhrase.match(/\b(\d+)\s+(?:tree\s*pot|drone|laptop|projector|speaker|lens|headphone)/);
  if(unknownCount) patch.quantity=Number(unknownCount[1]);
 }
 if(correction) {
  const countNumbers=[...nounPhrase.matchAll(/\b\d+\b/g)];
  const explicitReplacement=/^(?:please )?not \d+[, ]+(?:make (?:that|it)|change (?:it|that) to) \d+(?: (?:cameras?(?: a)?|tripods?(?: b)?|microphones?(?: c)?))?(?: please)?[.!]*$/.test(nounPhrase.trim());
  if(countNumbers.length>1&&!explicitReplacement) return issue('quantity','I heard more than one replacement quantity. How many units should I use?',{quantity:null});
  patch.quantity=Number(correction[1]);
 }
 const repeatedCount=/\b\d+\s*(?:and|,|to|-)\s*\d+\s*(?:(?:number|of|the)\s+)*$/.test(beforeItem);
 const unsafeCount=/(?:^|\s)-\s*\d|\b(?:minus|negative|half|hundred|thousand|dozen|dozens|score|scores|gross|pair|pairs|pack|packs|sets)\b|\d+\.\d+|\d+\s+point\s+\d+|\d+\s*\/\s*\d+/.test(nounPhrase);
 if((!correction && repeatedCount) || unsafeCount || (patch.quantity!==undefined && (patch.quantity<1 || patch.quantity>99))) {
  return issue('quantity','Please give one whole-number quantity between 1 and 99.',{quantity:null});
 }
 if(/\b(?:tree\s+pots?|drones?|laptops?|projectors?|speakers?|lenses|headphones)\b/.test(s)) return issue('itemId','I can book Camera A, Tripod B, or Microphone C. Which one do you mean?',patch);

 if(new Set(hits.map(h=>h.id)).size>1) return issue('itemId','Please choose one equipment type: Camera A, Tripod B, or Microphone C.',patch, {candidates:[...new Set(hits.map(h=>h.id))]});
 if(!hits.length && !quantityReply && /\b\d+\s+(?!please\b)(?:[a-z]+)\b/.test(nounPhrase.replace(/\b(?:from|to|for|on)\s*$/, ''))) return issue('itemId','Which catalog item do you mean: Camera A, Tripod B, or Microphone C?',patch);
 if(hits.length) {
  const h=hits[0];
 const before=s.slice(0,h.index);
  if(/\b(not|without|except|instead of)\s+(?:\d+\s+)?$/.test(before)) return issue('itemId','Which equipment would you like instead?',patch);
  // Validate the local noun phrase, not every word in a conversational utterance.
  if(/\b(?:tree\s+pots?|laptop|projector|speaker|lens|light|drone|monitor|computer|phone|headphones)\b/.test(s)) return issue('itemId','I can book Camera A, Tripod B, or Microphone C. Which one do you mean?',patch);
  if(/\b(?:half|hundred|thousand)\b/.test(before)) return issue('quantity','Please give a whole-number quantity between 1 and 99.');
  const local=before.match(/\b([a-z]+)\s+$/)?.[1];
  if(local && !/^(?:a|an|the|some|any|number|of|for|need|needed|want|wanted|reserve|book|get|have|use|rent|take|with|to|my|that|this|another|please)$/.test(local)) return issue('itemId','Do you mean '+({camera:'Camera A',tripod:'Tripod B',microphone:'Microphone C'}[h.id])+'?',patch, {candidates:[h.id]});
  const wrongLabel=s.slice(h.index+h.text.length).match(/^\s+([abc])\b/);
  if(wrongLabel) return issue('itemId','Please use the catalog name: Camera A, Tripod B, or Microphone C.',patch);
  const after=s.slice(h.end);
  const modifier=after.match(/^\s+([a-z]+)\b/)?.[1];
  if(modifier && !months.includes(modifier) && !/^(?:from|to|for|on|starting|beginning|until|through|please|instead|thanks|thank|and|with|between|at|is|would|will)$/.test(modifier)) return issue('itemId','Do you mean '+({camera:'Camera A',tripod:'Tripod B',microphone:'Microphone C'}[h.id])+'?',patch, {candidates:[h.id]});
  if(/\b(?:and|plus)\s+(?:a|an|some|\d+)\s+[a-z]/.test(after)) return issue('itemId','Please choose one equipment type for this booking.',patch);
  patch.itemId=h.id;
  const qty=before.match(/(?:\b(\d+)\s+(?:(?:number|of|the)\s+)*|\b(a|an)\s+)$/);
  if(qty) patch.quantity=qty[1]?Number(qty[1]):1;
  if(/\bto\s+$/.test(before) && /\bneed(?:ed)?\b/.test(before)) return issue('quantity','How many '+h.id+'s do you need? Please say the number.',patch);
 }
 const qtyCorrection=s.match(/\b(?:quantity(?: to| is| of)?|make (?:that|it)|change (?:it|that|the quantity) to)\s+(\d+)\b/);
 if(qtyCorrection) patch.quantity=Number(qtyCorrection[1]);
 if(quantityReply) patch.quantity=Number(quantityReply[1]);
 if(patch.quantity!==undefined && (patch.quantity<1 || patch.quantity>99)) { delete patch.quantity;
 return issue('quantity','How many do you need? Please choose a whole number from 1 to 99.',patch);
 }
 if(/\b\d+\.\d+\b|\b(?:half|hundred|thousand)\b/.test(nounPhrase)) { delete patch.quantity;
 return issue('quantity','Please give a whole-number quantity between 1 and 99.',patch);
 }
 return {intent:'update',patch};
}
function extractDates(s,draft) {
 const patch={};
 if(/\b(?:today|tomorrow|yesterday|next|this weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\d\s*\/\s*\d/.test(s)) return issue('dates','Please say the exact dates with the month name and year, for example November 14 to November 16, 2026.',patch);
 const parts=[];
 const dateRe=new RegExp(`\\b(?:(\\d{4})-(\\d{2})-(\\d{2})|(${months.join('|')})\\s+(\\d{1,2})(?:\\s*,?\\s*(\\d{4}))?)\\b`,'g');
 for(const m of s.matchAll(dateRe)) parts.push({year:Number(m[1]||m[6])||null,month:m[2]?Number(m[2]):months.indexOf(m[4])+1,day:Number(m[3]||m[5]),index:m.index,end:m.index+m[0].length});
 // Shared-month range: November 14 to 16, 2026.
 if(parts.length>=1) {
  const tail=s.slice(parts[0].end).match(/^\s*(?:to|through|until|–|-)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?\b/);
  if(tail) parts.splice(1,0,{month:parts[0].month,day:Number(tail[1]),year:Number(tail[2])||null,index:parts[0].end,end:parts[0].end+tail[0].length,shared:true});
 }
 const mode=/\b(?:end|ending|return|until|through)\b/.test(s)?'end':/\b(?:start|starting|begin|beginning)\b/.test(s)?'start':null;
 if(parts.length) {
  let unclaimed = s.slice(parts[0].index);
  for (const part of [...parts].reverse()) {
   const begin = part.index-parts[0].index;
   const finish = part.end-parts[0].index;
   unclaimed = unclaimed.slice(0,begin) + ' '.repeat(finish-begin) + unclaimed.slice(finish);
  }
  if (/\d/.test(unclaimed)) return issue('dates','I heard extra numbers in the dates. Please say just the start date and end date with the year.',patch);
  if(parts.length>2 || (parts.length===2 && !parts[1].shared && !/^\s*(?:to|through|until|–|-)\s*$/.test(s.slice(parts[0].end,parts[1].index)))) return issue('dates','Please say a clear date range: from the start date to the end date, including the year.',patch);
  if(parts.length===1 && !mode) return issue('dates','What are the start and end dates? Please say both, even for a one-day booking.',patch);
  if(parts.length===2) { const year=parts[1].year||parts[0].year;
 parts.forEach(p=>{if(!p.year)p.year=year;});
 }
  if(parts.some(p=>!p.year)) return {...issue('year','Which year are those dates in?',patch),pending:{kind:'year',parts,mode}};
  return applyDates(parts,patch,draft,mode);
 }
 if(new RegExp(`\\b(${months.join('|')}|date|dates|year|start|end|from|until)\\b`).test(s)) return issue('dates','What exact start and end dates should I use? Please include the month, day, and year.',patch);
 return {intent:'update',patch};
}
