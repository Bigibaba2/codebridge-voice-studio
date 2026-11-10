/** Pure multi-line reservation parser. Dates are shared; nothing is saved here. */
import { interpret } from './interpret.js';
const names = {camera:'Camera A',tripod:'Tripod B',microphone:'Microphone C'};
const itemPattern = /\b(cameras?)(?:\s+a\b)?|\b(tripods?)(?:\s+b\b)?|\b(microphones?|mics?)(?:\s+c\b)?/gi;
const dateBoundary = /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}|today|tomorrow|yesterday|next|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const removal = /\b(?:remove|drop|delete|cancel|without|not|no longer|don't want|do not want)\b/i;
function issue(slot,prompt,patch={},extra={}) {
 return {intent:'update',patch,issue:{slot,prompt,...extra}};
}
function copyItems(draft) {
 return (draft.items || []).map(({itemId,quantity})=>({itemId,quantity}));
}
function missingQuantity(items,patch) {
 const line=items.find(item=>item.quantity==null);
 if(!line) return null;
 return {...issue('quantity',`How many ${names[line.itemId]} would you like?`,patch,{itemId:line.itemId}),pending:{kind:'quantity',slot:'quantity',itemId:line.itemId}};
}
// Date introducers delimit a date clause even when its first month was misheard.
// Keep that uncertain prefix out of equipment parsing; never map it to a month.
function dateClauseBoundary(text) {
 return /\b(?:from|starting|beginning|until|through)\b|\b(?:for|on)\b(?=(?:(?!\b(?:from|starting|beginning)\b)[\s\S])*\b(?:to|until|through)\b)/i.exec(text);
}
function retainItemClarification(pending,items) {
 const {patch:oldSuggestion,...blocker}=pending;
 const prompt='Please restate the complete equipment list and quantities, including the extra or unclear item. Nothing is booked.';
 return {...issue(pending.slot,prompt,{items:[]}),pending:{...blocker,kind:'clarify',prompt,retainedItems:items,requiresFullList:true}};
}
function getDates(text,draft) {
 const match=dateBoundary.exec(text);
 const clause=dateClauseBoundary(text);
 // Inspect the entire date clause before rejecting a misheard month. An added
 // equipment request after the dates must not disappear during date recovery.
 const start=clause && (!match || clause.index<match.index)?clause.index:match?.index;
 if(start!==undefined) {
  const dateText=text.slice(start);
  const fullClause=interpret('from '+dateText,{draft});
  const extraObject=/\b(?:and|plus|also)\s+(?:a|an|some)\s+[a-z]+/i.test(dateText)
   || dateText.split(/\b(?:and|plus|also)\b/i).slice(1).some(extra=>interpret(extra).issue?.slot==='itemId');
  if(fullClause.issue?.slot==='itemId' || extraObject) {
   return issue('itemId','I heard extra equipment after the dates. Please clarify the complete equipment list and quantities.',{start:null,end:null});
  }
 }
 if(clause && (!match || clause.index<match.index)) {
  const prefix=match?text.slice(clause.index,match.index).trim():text.slice(clause.index).trim();
  if(!match || !/^(?:from|starting|beginning|until|through|for|on)(?:\s+on)?(?:\s+the)?$/i.test(prefix)) {
   return issue('dates','I could not identify the full date range. Please say the start and end dates with the month names and year.');
  }
 }
 if(!match) {
  if(/\b(?:dates?|year|start|end|until|from)\b/i.test(text)) return interpret(text,{draft});
  return {intent:'update',patch:{}};
 }
 const before=text.slice(0,match.index);
 const mode=/\b(?:end|ending|return)\b/i.test(before)?'change the end to ':/\b(?:start|starting|beginning)\b/i.test(before)?'change the start to ':'from ';
 return interpret(mode+text.slice(match.index),{draft});
}
function datePatch(result) {
 return Object.fromEntries(Object.entries(result.patch||{}).filter(([key])=>key==='start'||key==='end'));
}
function cleanPrefix(text) {
 return text.replace(/^\s*[,;]+\s*/,'').replace(/^\s*(?:and|plus|also)\b\s*/i,'').trim();
}
export function interpretOrder(text,context={}) {
 let s=String(text||'').trim();
 // Conversational markers do not change an explicitly named correction. Strip
 // them only directly before a correction verb; keep all question, negation,
 // condition, and quantity wording for the existing safety checks.
 s=s.replace(/^(?:(?:actually|please|wait)[,\s]+)+(?=(?:change|set|update|make)\b)/i,'');
 const countRangeCorrection=s.match(/^(?:change|set|update|make)\s+(?:(?:the|a)\s+)?(?:(cameras?(?:\s+a)?)|(tripods?(?:\s+b)?)|((?:microphones?|mics?)(?:\s+c)?))\s+from\s+(.+)$/i);
 s=s.replace(/^(?:change|set|update)\s+(?:(?:the|a)\s+)?((?:cameras?(?: a)?|tripods?(?: b)?|microphones?(?: c)?))\s+(?:quantity\s+)?to\s+(.+)$/i,(_,item,count)=>`make it ${count.replace(/[.!?]+\s*$/,'')} ${item}`);
 s=s.replace(/^make\s+(?:(?:the|a)\s+)?((?:cameras?(?: a)?|tripods?(?: b)?|microphones?(?: c)?))\s+(?:to\s+)?(.+)$/i,(_,item,count)=>`make it ${count.replace(/[.!?]+\s*$/,'')} ${item}`);
 s=s.replace(/([a-z])(\d)|(\d)([a-z])/gi,(_,a,b,c,d)=>a?`${a} ${b}`:`${c} ${d}`);
 if(!/^(?:what|which|how|when|why|where|is|are|do you|can you tell)\b/i.test(s)) s=s.replace(/\?\s*$/, '');
 const draft=context.draft||{};
 const pending=context.pending||null;
 const existing=['itemId','items'].includes(pending?.slot) && Array.isArray(pending.retainedItems) ? pending.retainedItems.map(line=>({...line})) : copyItems(draft);
 const scalarDraft={start:draft.start,end:draft.end};
 if(!s) return {intent:'unknown',patch:{},issue:{slot:'intent',prompt:'Please tell me which equipment you need.'}};
 if(/\b(?:if|maybe|perhaps|either|possibly|not sure|might|or)\b/i.test(s)) {
  return issue('intent','Please state the exact equipment, quantities, and shared dates you want.',{items:[],start:null,end:null});
 }
 if(/\b(?:only|replace)\b/i.test(s) && /\b(?:cameras?|tripods?|microphones?|mics?)\b/i.test(s)) {
  return {...issue('items','Please restate the complete equipment list you want, with a quantity for each item. I will keep the shared dates.',{items:[]}),pending:{kind:'clarify',slot:'items'}};
 }
 const initialIntent=interpret(s,{draft:scalarDraft});
 if(initialIntent.intent==='question') return {intent:'question',question:initialIntent.question,patch:{}};
 // A negated correction is not a request to remove the named equipment.
 if(/^(?:(?:actually|please|wait)[,\s]+)*(?:do not|don't|never)\s+(?:change|set|update|make)\b/i.test(s)) return {intent:'unknown',patch:{}};
 if(/^should I\s+(?:change|set|update|make)\b/i.test(s)) return {intent:'question',question:'other',patch:{}};
 // An explicit named correction withdraws that line's old quantity even when
 // recognition ended before the replacement count. Never reuse the old count.
 const incomplete=s.match(/^(?:change|set|update|make)\s+(?:(?:the|a)\s+)?(?:(cameras?(?:\s+a)?)|(tripods?(?:\s+b)?)|((?:microphones?|mics?)(?:\s+c)?))(?:\s+quantity)?(?:\s+to)?\s*[.!?]*$/i) || (countRangeCorrection && !dateBoundary.test(countRangeCorrection[4].replace(/([a-z])(\d)/gi,'$1 $2'))?countRangeCorrection:null);
 if(incomplete) {
  const itemId=incomplete[1]?'camera':incomplete[2]?'tripod':'microphone';
  const items=existing.map(line=>line.itemId===itemId?{...line,quantity:null}:line);
  if(!items.some(line=>line.itemId===itemId)) items.push({itemId,quantity:null});
  if(['itemId','items'].includes(pending?.slot)) return retainItemClarification(pending,items);
  const deferredYear=pending?.kind==='year'?pending:pending?.deferredYear;
  return {...issue('quantity',`What quantity should I change ${names[itemId]} to?`,{items},{itemId}),pending:{kind:'quantity',slot:'quantity',itemId,...(deferredYear?{deferredYear}:{})}};
 }

 if(pending?.kind==='year') {
  const answer=interpret(s,{draft:scalarDraft,pending});
  if(answer.patch.start || answer.patch.end) {
   const patch=datePatch(answer);
   return missingQuantity(existing,patch)||{intent:'update',patch,pending:null};
  }
 }
 // An item-specific prompt is the only context that disambiguates a bare count
 // in a multi-line order. The single-line case is also grounded.
 const countText=s.replace(/^\s*(?:number|quantity)\s+/i,'');
 const target=pending?.itemId || (existing.length===1?existing[0].itemId:null);
 const count=interpret(countText,{draft:target?{itemId:target}: {}});
 const isCountReply=/^(?:(?:actually|just|only|please)[, ]+)?(?:(?:i (?:need|want)|make (?:it|that)|number|quantity) )?(?:\d+|[a-z-]+(?: [a-z-]+)?)[, ]*(?:please)?[.!]*$/i.test(s)
  && !itemPattern.test(s) && !count.issue && count.patch.quantity!==undefined;
 itemPattern.lastIndex=0;
 if(isCountReply && target) {
  const items=existing.map(line=>line.itemId===target?{...line,quantity:count.patch.quantity}:line);
  if(!items.some(line=>line.itemId===target)) items.push({itemId:target,quantity:count.patch.quantity});
  if(['itemId','items'].includes(pending?.slot)) return retainItemClarification(pending,items);
  const patch={items};
  if(pending?.deferredYear) return {...issue('year','Which year are those dates in?',patch),pending:pending.deferredYear};
  return missingQuantity(items,patch)||{intent:'update',patch,pending:null};
 }
 // Detect an ungrounded count even when the single-line parser correctly refuses it.
 const probe=interpret(countText,{draft:{itemId:'camera'}});
 if(!target && existing.length>1 && !probe.issue && probe.patch.quantity!==undefined && !/\b(?:camera|tripod|microphone|mic)s?\b/i.test(s)) {
  if(['itemId','items'].includes(pending?.slot)) return retainItemClarification(pending,existing.map(line=>({...line,quantity:null})));
  return issue('quantity','Which item is that quantity for? Please name Camera A, Tripod B, or Microphone C.',{items:existing.map(line=>({...line,quantity:null}))}, {candidates:existing.map(line=>line.itemId)});
 }
 const hits=[...s.matchAll(itemPattern)].map(m=>({itemId:m[1]?'camera':m[2]?'tripod':'microphone',start:m.index,end:m.index+m[0].length,text:m[0]}));
 const firstDate=dateBoundary.exec(s);
 if(hits.length>1 && firstDate && firstDate.index<hits.at(-1).start) {
  const affected=new Set(hits.map(hit=>hit.itemId));
  const items=existing.filter(line=>!affected.has(line.itemId));
  for(const itemId of affected) items.push({itemId,quantity:null});
  return issue('dates','All items must share one date range. Please state the equipment quantities, then one start and end date for the whole reservation.',{items,start:null,end:null});
 }
 if(!hits.length) {
  const general=dateClauseBoundary(s) && initialIntent.intent==='update' && !['intent','itemId','quantity'].includes(initialIntent.issue?.slot)
   ? getDates(s,scalarDraft) : interpret(s,{draft:scalarDraft,pending});
  if(['confirm','cancel','repeat','question'].includes(general.intent)) return general;
  if(general.intent==='unknown') return {intent:'unknown',patch:{}};
  if(general.issue?.slot==='quantity') {
   const affected=target?existing.map(line=>line.itemId===target?{...line,quantity:null}:line):existing.map(line=>({...line,quantity:null}));
   if(['itemId','items'].includes(pending?.slot)) return retainItemClarification(pending,affected);
   return {...general,patch:{items:affected},issue:{...general.issue,...(target?{itemId:target}:{})},pending:{kind:'quantity',slot:'quantity',...(target?{itemId:target}:{})}};
  }
  if(general.issue?.slot==='itemId') {
   const patch={...datePatch(general),items:[]};
   const quantity=general.patch.quantity;
   return {...general,patch,pending:{kind:'clarify',slot:'itemId',retainedItems:existing,...(quantity!=null?{quantity}:{}),...(general.issue.candidates?{candidates:general.issue.candidates}:{})}};
  }
  if(general.patch.start || general.patch.end || general.issue?.slot==='dates'||general.issue?.slot==='year') {
   const patch=datePatch(general);
   if(['dates','year'].includes(general.issue?.slot)) {patch.start=null;patch.end=null;}
   if(['itemId','items'].includes(pending?.slot)) return {...issue(pending.slot,pending.prompt||'Which catalog items did you mean?',{...patch,items:[]}),pending:{...pending,...(general.pending?{deferredYear:general.pending}:{})}};
   if(general.issue) return {...general,patch};
   return missingQuantity(existing,patch)||{intent:'update',patch,pending:null};
  }
  if(general.issue?.slot==='intent' && Object.values(general.patch).includes(null)) return {...general,patch:{items:[],start:null,end:null}};
  return {...issue('itemId','Which equipment do you mean? You can combine Camera A, Tripod B, and Microphone C.',{items:[]}),pending:['itemId','items'].includes(pending?.slot)?pending:{kind:'clarify',slot:'itemId',retainedItems:existing}};
 }
 const dates=getDates(s,scalarDraft);
 const patch=datePatch(dates);
 // Revoke every rejected replacement before choosing which clarification to ask.
 // A quantity error must never hide invalid dates and retain an old reviewed range.
 if(dates.issue && ['dates','year'].includes(dates.issue.slot)) {
  patch.start=null;
  patch.end=null;
 }
 let items=existing;
 let firstIssue=dates.issue?.slot==='itemId'?dates.issue:null;
 let unresolvedQuantity;
 const removeList=/^(?:please )?(?:remove|drop|delete|cancel|without|no longer)\b/i.test(s);
 const seen=new Set();
 for(let index=0;index<hits.length;index++) {
  const hit=hits[index];
  const begin=index?hits[index-1].end:0;
  const prefix=cleanPrefix(s.slice(begin,hit.start));
  if(dateBoundary.test(prefix)) {
   firstIssue ||= {slot:'dates',prompt:'Please give one shared date range after listing all equipment.'};
   continue;
  }
  if(seen.has(hit.itemId)) {
   items=items.map(line=>line.itemId===hit.itemId?{...line,quantity:null}:line);
   firstIssue ||= {slot:'quantity',itemId:hit.itemId,prompt:`You mentioned ${names[hit.itemId]} more than once. What single total quantity should I use?`};
   continue;
  }
  seen.add(hit.itemId);
  if(removal.test(prefix) || (removeList && !/\b(?:add|include|reserve|book|instead)\b/i.test(prefix))) {
   items=items.filter(line=>line.itemId!==hit.itemId);
   continue;
  }
  if(/\b(?:never|refuse|do not|don't|no)\b/i.test(prefix)) {
   items=items.filter(line=>line.itemId!==hit.itemId);
   firstIssue ||= {slot:'intent',prompt:'Tell me the equipment you do want to reserve.'};
   continue;
  }
  const fragment=prefix.replace(/^(?:add|include)\s+/i,'').replace(/^(?:yes|yeah|okay)(?:[, ]+|$)/i,'')+' '+hit.text;
  const parsed=interpret(fragment);
  if(parsed.issue) {
   firstIssue ||= {...parsed.issue,...(parsed.issue.slot==='quantity'?{itemId:hit.itemId}:{})};
   // A recognized catalog noun is a requested line even when its count or
   // surrounding words are unclear. Never drop it or reuse an obsolete count.
   items=items.filter(line=>line.itemId!==hit.itemId);
   items.push({itemId:hit.itemId,quantity:parsed.issue.slot==='quantity'?null:parsed.patch.quantity??null});
   continue;
  }
  const previous=items.find(line=>line.itemId===hit.itemId);
  const quantity=parsed.patch.quantity??(['itemId','items'].includes(pending?.slot) && hits.length===1?pending.quantity:undefined)??previous?.quantity??null;
  items=items.filter(line=>line.itemId!==hit.itemId);
  items.push({itemId:hit.itemId,quantity});
 }
 const tail=s.slice(hits.at(-1).end);
 const knownBoundary=dateBoundary.exec(tail);
 const clauseBoundary=dateClauseBoundary(tail);
 const boundary=clauseBoundary && (!knownBoundary || clauseBoundary.index<knownBoundary.index)?clauseBoundary:knownBoundary;
 let trailing=(boundary?tail.slice(0,boundary.index):tail).replace(/\b(?:from|on|for|starting|beginning|until|through)\s*$/i,'').trim();
 if(hits.length===1 && trailing) {
  const countAnswer=interpret(trailing,{draft:{itemId:hits[0].itemId}});
  if(!countAnswer.issue && countAnswer.patch.quantity!=null && /^(?:number )?(?:\d+|[a-z]+(?:[ -][a-z]+)?)[.!]*$/i.test(trailing)) {
   items=items.map(line=>line.itemId===hits[0].itemId?{...line,quantity:countAnswer.patch.quantity}:line);
   trailing='';
  }
 }
 if(trailing && !/^[, .!?]*(?:please|thanks|thank you|instead)?[, .!?]*$/i.test(trailing)) {
  const trailingResult=interpret(cleanPrefix(trailing));
  unresolvedQuantity=trailingResult.patch.quantity;
  if(initialIntent.issue?.slot==='itemId' && initialIntent.issue.candidates?.length===1) firstIssue ||= initialIntent.issue;
  firstIssue ||= {slot:'itemId',prompt:'I heard something else after the equipment list. Please name each item and its quantity using Camera A, Tripod B, or Microphone C.'};
 }
 patch.items=items;
 if(['itemId','items'].includes(pending?.slot) && /^make it\b/i.test(s)) {
  const blocked=retainItemClarification(pending,items);
  return {...blocked,patch:{...patch,items:[]}};
 }
 if(firstIssue) {
  const retainedItems=items.map(line=>({...line}));
  if(firstIssue.slot==='itemId') patch.items=[];
  if(firstIssue.slot==='itemId' && firstIssue.candidates?.length===1) {
   const itemId=firstIssue.candidates[0];
   if(!retainedItems.some(line=>line.itemId===itemId)) retainedItems.push({itemId,quantity:initialIntent.patch.quantity??null});
   return {intent:'update',patch,issue:firstIssue,pending:{kind:'suggestion',slot:'itemId',prompt:firstIssue.prompt,candidates:firstIssue.candidates,retainedItems,patch:{items:retainedItems},...(dates.pending?{deferredYear:dates.pending}:{})}};
  }
  return {intent:'update',patch,issue:firstIssue,pending:{kind:'clarify',...firstIssue,...(firstIssue.slot==='itemId'?{retainedItems}:{}),...(unresolvedQuantity!=null?{quantity:unresolvedQuantity}:{}),...(dates.pending?{deferredYear:dates.pending}:{})}};
 }
 if(dates.issue) return {...dates,patch};
 if(pending?.kind==='year') return {...issue('year','Which year are those dates in?',patch),pending};
 if(pending?.deferredYear) return {...issue('year','Which year are those dates in?',patch),pending:pending.deferredYear};
 return missingQuantity(items,patch)||{intent:'update',patch,pending:null};
}
