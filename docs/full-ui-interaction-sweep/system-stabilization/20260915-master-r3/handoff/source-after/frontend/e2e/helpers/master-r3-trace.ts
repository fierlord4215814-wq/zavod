import type {Page} from '@playwright/test';
import {records,save} from './frontend-series';

// Observation only: native implementations and callback ordering are preserved.
// No CSS, scroll correction, product state assignment, history owner or external data.
export async function installNavigationTrace(page:Page) {
 await page.addInitScript(()=>{
  const events:any[]=[];let dropped=0,sequence=0;
  const element=(e:any)=>e instanceof Element?{tag:e.tagName,type:e.getAttribute('type'),name:e.getAttribute('name'),id:e.id,classes:e.className}:null;
  const source=()=>new Error().stack?.split('\n').slice(2,6).join('\n');
  const snap=(event:string,detail:any={})=>{
   if(events.length>=5000){dropped++;return;}
   const row=Array.from(document.querySelectorAll<HTMLElement>('.people-compact-row')).find(e=>e.textContent?.includes('Сервисов'));
   const rect=row?.getBoundingClientRect();
   events.push({seq:++sequence,ms:performance.now(),event,...detail,y:scrollY,height:document.documentElement.scrollHeight,
    bodyTop:document.body?.style.top,position:document.body?.style.position,locked:document.body?.classList.contains('app-scroll-locked'),
    focus:element(document.activeElement),anchor:rect?{top:rect.top,height:rect.height,documentTop:rect.top+scrollY}:null,
    loading:!!Array.from(document.querySelectorAll('.empty-state')).find(e=>e.textContent==='Загрузка людей...'),
    layers:Array.from(document.querySelectorAll('[role=dialog],.profile-card')).map(element),
    navInset:document.querySelector('.app-shell')?getComputedStyle(document.querySelector('.app-shell')!).getPropertyValue('--shell-navigation-inset'):null});
  };
  (window as any).__r3Trace={events,get dropped(){return dropped;},mark:(label:string)=>snap('MARK',{label})};
  const raf=window.requestAnimationFrame.bind(window),cancelRaf=window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame=cb=>{const call=source();let id=0;id=raf(t=>{snap('RAF_FIRE',{id,call});try{cb(t);}finally{snap('RAF_DONE',{id});}});snap('RAF_SCHEDULE',{id,call,callback:String(cb).slice(0,300)});return id;};
  window.cancelAnimationFrame=id=>{snap('RAF_CANCEL',{id,call:source()});return cancelRaf(id);};
  const scroll=window.scrollTo.bind(window);
  const fetchNative=window.fetch.bind(window);
  window.fetch=async(input,init)=>{const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;const pathname=new URL(url,location.href).pathname;snap('FETCH_START',{path:pathname});try{const response=await fetchNative(input,init);snap('FETCH_RESPONSE',{path:pathname,status:response.status});return response;}catch(error){snap('FETCH_ERROR',{path:pathname});throw error;}};
  window.scrollTo=((...args:any[])=>{snap('SCROLL_TO_BEFORE',{args,call:source()});(scroll as any)(...args);snap('SCROLL_TO_AFTER');}) as typeof window.scrollTo;
  const into=Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView=function(arg){snap('INTO_VIEW_BEFORE',{target:element(this),arg,call:source()});into.call(this,arg);snap('INTO_VIEW_AFTER');};
  const timeout=window.setTimeout.bind(window),clearTimeoutNative=window.clearTimeout.bind(window);
  window.setTimeout=((handler:TimerHandler,delay?:number,...args:any[])=>{if(typeof handler!=='function')return timeout(handler,delay,...args);const call=source();let id=0;id=timeout(()=>{snap('TIMER_FIRE',{id,delay,call});try{handler(...args);}finally{snap('TIMER_DONE',{id});}},delay);snap('TIMER_SCHEDULE',{id,delay,call,callback:String(handler).slice(0,180)});return id;}) as typeof window.setTimeout;
  window.clearTimeout=id=>{snap('TIMER_CANCEL',{id});clearTimeoutNative(id);};
  for(const method of ['pushState','replaceState'] as const){const fn=history[method].bind(history);history[method]=((...args:any[])=>{snap('HISTORY_'+method,{stateKeys:Object.keys(args[0]??{}),url:args[2],call:source()});(fn as any)(...args);}) as typeof fn;}
  for(const event of ['pointerdown','pointerup','click','focusin','focusout','scroll','resize','popstate','zavod:mobile-back-request','zavod:navigate']){
   window.addEventListener(event,e=>{snap(event,{target:element(e.target),...(event==='zavod:navigate'?{intent:(e as CustomEvent).detail}:{} )});if(event==='popstate')queueMicrotask(()=>snap('POPSTATE_MICROTASK'));},true);
  }
  const NativeResizeObserver=window.ResizeObserver;
  window.ResizeObserver=class extends NativeResizeObserver{constructor(cb:ResizeObserverCallback){const call=source();super((entries,observer)=>{snap('RESIZE_OBSERVER_BEFORE',{call,targets:entries.map(e=>element(e.target))});cb(entries,observer);snap('RESIZE_OBSERVER_AFTER');});}};
  const observe=()=>new MutationObserver(list=>snap('DOM_MUTATION',{changes:list.slice(0,12).map(m=>({kind:m.type,attribute:m.attributeName,target:element(m.target)}))})).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['style','class','aria-pressed']});
  if(document.body)observe();else document.addEventListener('DOMContentLoaded',observe,{once:true});
 });
}
export const mark=async(page:Page,label:string)=>page.evaluate(label=>(window as any).__r3Trace.mark(label),label);
export async function saveTrace(page:Page,label:string){
 const trace=await page.evaluate(()=>({events:(window as any).__r3Trace.events,dropped:(window as any).__r3Trace.dropped}));
 records.push({causalTrace:label,...trace});save();return trace;
}
