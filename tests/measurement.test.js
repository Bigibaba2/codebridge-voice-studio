/** These artificial values test validator arithmetic only; they are not recording evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {summarizeAnnotations,verifyRecordingFiles} from '../scripts/measure-recording.js';
const date='2026-11-10T10:00:00Z';
const annotation=(latencies=[100,200,300,400,500])=>({
 kind:'genuine-recording-human-annotations',
 recording:{id:'R1',reference:'recording.wav',containsUserAndAppAudio:true,audioReviewedBy:'Unit test',audioReviewedAt:date,durationMs:100000},
 acousticSamples:latencies.map((latency,index)=>({id:'S'+index,recordingId:'R1',recordingReference:'recording.wav',annotationMethod:'waveform-and-listening',annotatedBy:'Unit test',annotatedAt:date,lastAudibleUserPhonemeMs:1000,firstAudibleAppPhonemeMs:1000+latency}))
});
test('computes supplied samples only: median and nearest-rank p95',()=>{
 const r=summarizeAnnotations(annotation());assert.equal(r.acousticMedianMs,300);assert.equal(r.acousticP95Ms,500);assert.equal(r.sampleCount,5);
 assert.equal(r.independentlyAudioVerified,false);assert.equal(r.localRecordingFilesChecked,false);
 assert.equal(summarizeAnnotations(annotation([400,100,300,200])).acousticMedianMs,250);
 assert.equal(summarizeAnnotations(annotation(Array.from({length:20},(_,i)=>(i+1)*10))).acousticP95Ms,190);
});
test('does not use supplied aggregate numbers instead of samples',()=>{
 const input=annotation();input.acousticMedianMs=9000;input.acousticP95Ms=9999;
 assert.equal(summarizeAnnotations(input).acousticMedianMs,300);
});
test('requires audio metadata and at least one provided annotation',()=>{
 for(const change of [x=>delete x.kind,x=>delete x.recording,x=>x.recording.containsUserAndAppAudio=false,x=>delete x.recording.audioReviewedBy,x=>x.acousticSamples=[]]) {
  const x=annotation();change(x);assert.throws(()=>summarizeAnnotations(x));
 }
 assert.throws(()=>summarizeAnnotations({status:'pending-real-recording',recording:null,acousticSamples:[]}),/Missing genuine audio/);
});
test('rejects negative invalid out-of-range and overlapping timestamps',()=>{
 for(const value of [-1,NaN,Infinity,'100',null,100001]) {
  const x=annotation();x.acousticSamples[0].lastAudibleUserPhonemeMs=value;assert.throws(()=>summarizeAnnotations(x));
 }
 const x=annotation();x.acousticSamples[0].firstAudibleAppPhonemeMs=999;assert.throws(()=>summarizeAnnotations(x),/precedes/);
});
test('rejects synthetic sources and callback measurements at any declared level',()=>{
 for(const change of [x=>x.kind='synthetic-transcript-not-audio',x=>x.recording.kind='generated-audio',x=>x.acousticSamples[0].source='browser-callback',x=>x.acousticSamples[0].annotationMethod='synthetic']) {
  const x=annotation();change(x);assert.throws(()=>summarizeAnnotations(x),/synthetic|generated|callback/i);
 }
});
test('requires recording linkage annotator timestamps method and unique sample identities',()=>{
 for(const change of [x=>x.acousticSamples[0].recordingId='missing',x=>x.acousticSamples[0].recordingReference='other.wav',x=>x.acousticSamples[0].annotatedAt='yesterday',x=>x.acousticSamples[0].annotatedBy='',x=>x.acousticSamples[0].annotationMethod='guess',x=>x.acousticSamples[1].id=x.acousticSamples[0].id]) {
  const x=annotation();change(x);assert.throws(()=>summarizeAnnotations(x));
 }
});
test('CLI evidence check requires a nonempty local file and does not claim audio verification',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'annotation-validator-'));
 try {
  const summary=summarizeAnnotations(annotation());assert.throws(()=>verifyRecordingFiles(summary,dir),/Missing local audio/);
  writeFileSync(path.join(dir,'recording.wav'),'');assert.throws(()=>verifyRecordingFiles(summary,dir),/nonempty/);
  // Deliberately not real audio: this tests file existence only, as the output discloses.
  writeFileSync(path.join(dir,'recording.wav'),'unit-test-file');
  const result=verifyRecordingFiles(summary,dir);assert.equal(result.localRecordingFilesChecked,true);assert.equal(result.independentlyAudioVerified,false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('duplicate boundaries cannot inflate sample count under different IDs',()=>{
 const x=annotation();x.acousticSamples[1]={...x.acousticSamples[0],id:'different-id'};
 assert.throws(()=>summarizeAnnotations(x),/duplicate recording\/boundary/);
});
