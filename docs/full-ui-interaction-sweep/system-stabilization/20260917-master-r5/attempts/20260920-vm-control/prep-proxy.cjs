'use strict';
// Trusted preparation coordinator only. Bind host loopback; strict public official downloads, never app traffic.
const http=require('node:http'),https=require('node:https'),net=require('node:net'),dns=require('node:dns/promises'),fs=require('node:fs'),path=require('node:path');
const HOST='127.0.0.1',PORT=18080;
const allowed=new Set(['archive.ubuntu.com','security.ubuntu.com','nodejs.org','ftp.postgresql.org','www.postgresql.org','registry.npmjs.org','binaries.prisma.sh','cdn.playwright.dev','playwright.download.prss.microsoft.com','download.prss.microsoft.com','playwright.azureedge.net']);
const plainAllowed=new Set(['archive.ubuntu.com','security.ubuntu.com']);
const connections=new Set();let stopped=false;
const receipt=path.join(__dirname,'prep-proxy-start.json'),terminal=path.join(__dirname,'prep-proxy-terminal.json');
if(fs.existsSync(receipt)||fs.existsSync(terminal))throw Error('Existing prep proxy attempt: preserve, never start a duplicate');
function public4(ip){const b=ip.split('.').map(Number);return net.isIP(ip)===4&&b.length===4&&b[0]!==0&&b[0]!==10&&b[0]!==127&&b[0]<224&&!(b[0]===169&&b[1]===254)&&!(b[0]===172&&b[1]>=16&&b[1]<=31)&&!(b[0]===192&&(b[1]===168||b[1]===0||b[1]===2))&&!(b[0]===100&&b[1]>=64&&b[1]<=127)&&!(b[0]===198&&(b[1]===18||b[1]===19||b[1]===51))&&!(b[0]===203&&b[1]===0&&b[2]===113);}
async function target(host,port,plain=false){host=host.toLowerCase();if(!allowed.has(host)||port!==(plain?80:443)||(plain&&!plainAllowed.has(host)))throw Error('Destination denied');const addresses=await dns.resolve4(host);if(!addresses.length||addresses.some(ip=>!public4(ip)))throw Error('Non-public destination denied');return{host,address:addresses[0],port};}
function track(socket){connections.add(socket);socket.on('close',()=>connections.delete(socket));socket.setTimeout(120000,()=>socket.destroy());return socket;}
function denied(res){if(!res.headersSent)res.writeHead(403,{'content-type':'text/plain'});res.end('R5 preparation destination denied');}
const server=http.createServer(async(req,res)=>{try{
 if(!['GET','HEAD'].includes(req.method)||req.headers.authorization||req.headers['proxy-authorization'])return denied(res);
 const u=new URL(req.url);if(u.protocol!=='http:'||u.username||u.password||u.hash||u.search)throw Error('Only unauthenticated official HTTP package paths');
 const t=await target(u.hostname,Number(u.port||80),true);
 const upstream=http.request({host:t.address,port:t.port,path:u.pathname,method:req.method,headers:{host:t.host,'user-agent':'Zavod-R5-preparation',...(req.headers.range?{range:req.headers.range}:{})}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
 upstream.on('socket',track);upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('R5 official upstream unavailable');});req.on('aborted',()=>upstream.destroy());upstream.end();
 }catch{denied(res);}});
server.on('connect',async(req,client,head)=>{try{if(req.headers.authorization||req.headers['proxy-authorization']||!/^[-a-z0-9.]+:443$/i.test(req.url))throw Error('CONNECT denied');const [host,p]=req.url.split(':');const t=await target(host,Number(p));const remote=track(net.connect({host:t.address,port:t.port},()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)remote.write(head);remote.pipe(client);client.pipe(remote);}));track(client);remote.on('error',()=>client.destroy());client.on('error',()=>remote.destroy());client.on('close',()=>remote.destroy());}catch{client.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');}});
server.on('clientError',(_,socket)=>socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
function finish(reason){if(stopped)return;stopped=true;for(const s of connections)s.destroy();server.close(()=>{fs.writeFileSync(terminal,JSON.stringify({at:new Date().toISOString(),pid:process.pid,reason,bind:HOST,port:PORT,closed:true,appTrafficAllowed:false},null,2),{flag:'wx'});process.exit(0);});}
process.on('SIGINT',()=>finish('OWN_PREP_SIGINT'));process.on('SIGTERM',()=>finish('OWN_PREP_SIGTERM'));
const stopFile=path.join(__dirname,'prep-proxy.stop');
if(fs.existsSync(stopFile))throw Error('Prior stop marker exists; do not restart implicitly');
setInterval(()=>{if(fs.existsSync(stopFile))finish('OWN_HOST_STOP_MARKER');},500).unref();
setTimeout(()=>finish('BOUNDED_THREE_HOUR_PREP_DEADLINE'),3*3600000).unref();
server.listen(PORT,HOST,()=>{fs.writeFileSync(receipt,JSON.stringify({at:new Date().toISOString(),pid:process.pid,bind:HOST,port:PORT,allowed:[...allowed],plainAllowed:[...plainAllowed],scope:'OFFICIAL_PUBLIC_PREPARATION_ONLY_NO_HOST_LAN_DESTINATIONS',tls:'CONNECT_TO_PUBLIC_PINNED_ADDRESS; certificate validation belongs to ordinary guest client',hostFirewallChanged:false,appTrafficAllowed:false},null,2),{flag:'wx'});console.log('R5 restricted loopback preparation proxy ready, PID='+process.pid);});
