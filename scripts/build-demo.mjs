import { build } from 'esbuild';
await build({entryPoints:['worker/domain.mjs'],outfile:'request/demo-domain.mjs',bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'none'});
console.log('Built isolated browser demo using the production request rules.');
