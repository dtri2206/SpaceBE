// Separate optimizer cache: never contend with the human's port-5173 dev server.
import os from 'node:os';
import path from 'node:path';
export default {cacheDir:path.join(os.tmpdir(),'hangar-scratch','vite-cache-5280'),server:{port:5280,strictPort:true}};
