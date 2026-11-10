/** Offline arithmetic over explicitly supplied human annotations. No recording or playback. */
import {readFileSync,statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const KIND='genuine-recording-human-annotations';
export class AnnotationError extends Error {}
const requireValue=(condition,message)=>{if(!condition)throw new AnnotationError(message);};
const nonempty=value=>typeof value==='string' && value.trim().length>0;
const timestamp=value=>nonempty(value) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const milliseconds=value=>typeof value==='number' && Number.isFinite(value) && value>=0;
const forbiddenKind=value=>typeof value==='string' && /synthetic|simulat|callback|loopback|generated|mock|fixture/i.test(value);
function rejectSyntheticLabels(value,where='input') {
 if(!value || typeof value!=='object')return;
 for(const [key,entry] of Object.entries(value)) {
  if(['kind','source','method','annotationMethod','evidenceType'].includes(key)) requireValue(!forbiddenKind(entry),`${where}.${key}: synthetic, generated, callback and simulated measurements are not acoustic annotations.`);
  if(entry && typeof entry==='object')rejectSyntheticLabels(entry,`${where}.${key}`);
 }
}
export function summarizeAnnotations(input) {
 requireValue(input && typeof input==='object' && !Array.isArray(input),'Provide an annotation JSON object.');
 rejectSyntheticLabels(input);
 requireValue(input.kind===KIND,`Missing genuine audio-evidence declaration. Set kind to "${KIND}" only after reviewing the genuine recording.`);
 requireValue(!(input.recording && input.recordings),'Use recording or recordings, not both.');
 const recordings=input.recordings || (input.recording?[input.recording]:[]);
 requireValue(Array.isArray(recordings) && recordings.length>0,'Missing audio evidence: provide at least one recording reference and human audio review.');
 const byId=new Map();
 for(const [index,recording] of recordings.entries()) {
  const label=`recordings[${index}]`;
  requireValue(recording && typeof recording==='object',`${label}: provide recording metadata.`);
  requireValue(nonempty(recording.id),`${label}.id is required.`);
  requireValue(!byId.has(recording.id),`${label}.id duplicates another recording.`);
  requireValue(nonempty(recording.reference),`${label}.reference must identify the local genuine recording file.`);
  requireValue(!/^[a-z][a-z0-9+.-]*:\/\//i.test(recording.reference),`${label}.reference must be a local file path. This helper never downloads recordings.`);
  requireValue(recording.containsUserAndAppAudio===true,`${label}: missing audio evidence. A human must confirm that both user speech and app output are audible.`);
  requireValue(nonempty(recording.audioReviewedBy),`${label}.audioReviewedBy is required.`);
  requireValue(timestamp(recording.audioReviewedAt),`${label}.audioReviewedAt must be an ISO timestamp with timezone.`);
  requireValue(milliseconds(recording.durationMs) && recording.durationMs>0,`${label}.durationMs must be the positive recording duration in milliseconds.`);
  byId.set(recording.id,recording);
 }
 requireValue(Array.isArray(input.acousticSamples) && input.acousticSamples.length>0,'No acoustic samples were supplied. Annotate audible phoneme boundaries from the genuine recording first.');
 const seen=new Set();
 const seenBoundaries=new Set();
 const samples=input.acousticSamples.map((sample,index)=>{
  const label=`acousticSamples[${index}]`;
  requireValue(sample && typeof sample==='object',`${label}: provide a sample object.`);
  requireValue(nonempty(sample.id) && !seen.has(sample.id),`${label}.id must be nonempty and unique.`);
  seen.add(sample.id);
  const recording=byId.get(sample.recordingId);
  requireValue(recording,`${label}.recordingId must reference a declared recording.`);
  requireValue(sample.recordingReference===recording.reference,`${label}.recordingReference must exactly match its recording reference.`);
  requireValue(sample.annotationMethod==='waveform-and-listening',`${label}.annotationMethod must be waveform-and-listening, not a browser callback or UI timer.`);
  requireValue(nonempty(sample.annotatedBy),`${label}.annotatedBy is required.`);
  requireValue(timestamp(sample.annotatedAt),`${label}.annotatedAt must be an ISO timestamp with timezone.`);
  const user=sample.lastAudibleUserPhonemeMs,app=sample.firstAudibleAppPhonemeMs;
  requireValue(milliseconds(user) && milliseconds(app),`${label}: phoneme boundaries must be finite, non-negative numeric milliseconds from the same recording's start.`);
  requireValue(user<=recording.durationMs && app<=recording.durationMs,`${label}: a phoneme boundary is beyond the recording duration.`);
  requireValue(app>=user,`${label}: app speech precedes the final user phoneme. Do not use an overlapping/negative-latency sample for this response-latency measure.`);
  const boundaryKey=JSON.stringify([sample.recordingId,user,app]);
  requireValue(!seenBoundaries.has(boundaryKey),`${label}: duplicate recording/boundary annotation. Count a speech exchange only once.`);
  seenBoundaries.add(boundaryKey);
  return {...sample,latencyMs:app-user};
 });
 const values=samples.map(sample=>sample.latencyMs).sort((a,b)=>a-b);
 const middle=Math.floor(values.length/2);
 const median=values.length%2?values[middle]:(values[middle-1]+values[middle])/2;
 return {
  kind:'human-annotated-acoustic-latency-summary',
  independentlyAudioVerified:false,
  localRecordingFilesChecked:false,
  measurement:'Last audible user phoneme to first audible app phoneme, using human waveform/listening annotations on one recording timebase per sample.',
  sampleCount:values.length,
  acousticMedianMs:median,
  acousticP95Ms:values[Math.ceil(.95*values.length)-1],
  percentileMethod:'nearest-rank: sorted[ceil(0.95 * n) - 1]',
  minMs:values[0],maxMs:values.at(-1),
  recordings:recordings.map(recording=>({...recording})),samples,
  warnings:[
   'The helper validates supplied metadata and arithmetic only. It does not verify audio content, authenticity, phoneme placement, or successful task completion.',
   ...(values.length<5?['Fewer than five samples: collect at least five before reporting a representative latency result.']:[])
  ]
 };
}
export function verifyRecordingFiles(summary,annotationDirectory) {
 for(const recording of summary.recordings) {
  const filename=path.resolve(annotationDirectory,recording.reference);
  let stat;
  try{stat=statSync(filename);}catch{throw new AnnotationError(`Missing local audio evidence file: ${recording.reference}`);}
  requireValue(stat.isFile() && stat.size>0,`Recording reference is not a nonempty file: ${recording.reference}`);
 }
 return {...summary,localRecordingFilesChecked:true};
}
export function main(args=process.argv.slice(2)) {
 requireValue(args.length===1,'Usage: node scripts/measure-recording.js PATH_TO_HUMAN_ANNOTATIONS.json');
 const filename=path.resolve(args[0]);
 let input;
 try{input=JSON.parse(readFileSync(filename,'utf8'));}catch(error){throw new AnnotationError(`Cannot read valid annotation JSON: ${error.message}`);}
 const summary=verifyRecordingFiles(summarizeAnnotations(input),path.dirname(filename));
 process.stdout.write(JSON.stringify(summary,null,2)+'\n');
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 try{main();}catch(error){console.error(`Annotation validation failed: ${error.message}`);process.exitCode=1;}
}
