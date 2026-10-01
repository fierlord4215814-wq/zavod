const path=require('node:path');
// Existing Vite preview/build, no alternative app and no working .env lookup.
(async()=>{const {preview}=await import('../../../node_modules/vite/dist/node/index.js');const root=path.resolve(__dirname,'../../..');await preview({root:path.join(root,'frontend'),configFile:path.join(root,'frontend/vite.config.ts'),envDir:path.join(__dirname,'../local-02/empty-build-env'),preview:{host:'127.0.0.1',port:5173,strictPort:true}});console.log('LOCAL03 canonical preview 127.0.0.1:5173');})().catch(e=>{console.error(e.message);process.exitCode=1;});
