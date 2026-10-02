// Cloudflare Worker entry. Contract logic and docs: core.mjs (Workers runtime allows only handler exports here).
import { handle, d1Store } from './core.mjs';

export default {
  fetch(request, env) {
    return handle(request, env, d1Store(env.DB));
  },
};
