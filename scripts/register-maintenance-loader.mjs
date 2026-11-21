// Workspace package schemas omit JSON import attributes; Next handles them, plain Node needs this loader.
import { register } from 'node:module';
register('./maintenance-json-loader.mjs', import.meta.url);
