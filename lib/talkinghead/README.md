# Vendored: TalkingHead (met4citizen) v1.7.0 — MIT

3D lip-synced avatar engine used by the AI Presenter's 3D mode
(`/tools/avatar`). Vendored from the npm package `@met4citizen/talkinghead@1.7.0`
(https://github.com/met4citizen/TalkingHead, MIT — LICENSE file alongside)
rather than depended on, for two reasons:

1. **One patch we need** (marked `VECTIS PATCH` in `talkinghead.mjs`): the stock
   1.7.0 never calls `GLTFLoader.setMeshoptDecoder`, so it cannot open
   meshopt-compressed GLBs. Our bundled avatar (`public/avatars/auctioneer.glb`)
   is meshopt-compressed (36.8 MB → 22 MB), so the decoder is wired in
   unconditionally — it is a bundled JS module, no network fetch involved.
2. Its lipsync language modules were loaded with a **computed dynamic import**
   (`import(path + 'lipsync-' + lang + '.mjs')`), which Turbopack refuses to
   BUILD (hard "Module not found: Can't resolve <dynamic>" error, even when the
   code path is never called). That import is patched out of
   `lipsyncGetProcessor` (second `VECTIS PATCH`, replaced with a console.warn).
   Construct with `lipsyncModules: []` and inject the statically-imported
   processor yourself — `head.lipsync.en = new LipsyncEn()` (see
   `app/(app)/tools/avatar/head3d.tsx`). To add a language, import its module
   and inject it the same way; the `lipsyncModules` option no longer loads
   anything.

Files: `talkinghead.mjs` (patched), `dynamicbones.mjs`, `lipsync-en.mjs`,
`playback-worklet.js` (referenced via `new URL(..., import.meta.url)` at module
scope — keep it next to talkinghead.mjs). `three@0.180` stays an npm dependency
(the library imports bare `three` / `three/addons/...`).

To upgrade: copy the new `modules/` files over these, re-apply the three
`VECTIS PATCH` sites (meshopt import + wiring, dynamic-import removal), and
re-test the avatar page's 3D mode with `npx next build` — the build is what
catches a reintroduced dynamic import.

The avatar model itself is `mpfb.glb` from the TalkingHead repo — the ONE
example avatar licensed **CC0** (public domain; made with Blender + MPFB).
The others there (Ready Player Me, Avaturn, VRoid, AvatarSDK) are
**non-commercial only** — do not swap them in. Ready Player Me is additionally
unreachable from the Hambleton network (DNS-filtered), which is why the model
is bundled in `public/avatars/` instead of hot-loaded from a third party.
