// Static, loopback-only R2 frontend. No Vite proxy, dotenv, backend, WebSocket or lifecycle bootstrap.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../dist');
const port=process.env.MASTER_BATCH==='20260916-master-r4'?15464:5173;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,`http://127.0.0.1:${port}`);
  if(req.method!=='GET'||!(url.pathname==='/'||/^\/(assets\/|pwa-icon-|favicon|manifest)/.test(url.pathname))){res.writeHead(501,{'Content-Type':'application/json'});return res.end('{"message":"R2_UNINTERCEPTED_REQUEST_BLOCKED"}');}
  const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);
});
server.on('upgrade',(_req,socket)=>socket.destroy());
server.listen(port,'127.0.0.1',()=>process.stdout.write(JSON.stringify({pid:process.pid,port,host:'127.0.0.1',root,proxy:false})+'\n'));
const stop=()=>server.close(()=>process.exit(0));process.on('SIGINT',stop);process.on('SIGTERM',stop);
