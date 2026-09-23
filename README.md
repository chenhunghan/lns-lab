# Inside the microVM — an lns lab

An interactive 3D guide to how an [lns](https://hub.lns.run) sandbox works. It opens up one run on a Mac and walks through the machinery chapter by chapter. Every chapter has something to press.

The workload in the sandbox is a little **Claude Code**. Its eyes follow every packet it sends, and its face shows what happened: ^^ when the model answers, > < when the gate says 403, "waiting…" while an approval card is held, and zzz after `lns stop`. When you press a demo, the labels fade, the glass dims, and the camera frames just the parts involved.

**Live:** https://chenhunghan.github.io/lns-lab/

| # | Chapter | What you can do |
|---|---------|-----------------|
| 01 | The whole machine | Send a request; watch the host, the microVM, the gate and the internet |
| 02 | Boot & the supervisor | Replay `lns run`: service → hypervisor → kernel → `lns-init` → broker → `lns-supervisor` → workload; `lns exec`, stop/start |
| 03 | Mounts | Edit a file on the host and see it live in the guest; hit the `.env` mask; copy-up into the writable layer; read the scrubbed `/proc/cmdline` |
| 04 | Volumes | Write to a bind, a named volume, the writable layer and `/tmp`, then `lns stop` / `start` / `rm` / `run` and see what survives; try a second sandbox on the same volume |
| 05 | Filesets | Seed `inline` and `hostPath` filesets; edit the host file (the snapshot doesn't change); `owner: root`; a mixin displacing `/opt/app` |
| 06 | Network | Follow a connection hop by hop: nftables → proxy → policy → eth0 → NAT; DNS NXDOMAIN; try to skip the proxy; a RAW TCP card; an inbound published port |
| 07 | Policy | Answer approval cards (once / always), edit the run's `decisions.yaml`, close the directory with `"*"` deny |
| 08 | Connectors | install → connect → grant; the placeholder in the guest, the real token injected by the proxy for one domain only |
| 09 | Mixins | Toggle mixins and watch the merge (`lns inspect`), the tool shelf and the verdict beacons change |

The page opens with a **guided tour**: one caption at a time, with the boot shown step by step. Pause, skip, or press *Explore on my own* at any point. Then each chapter has **Try it** buttons for going deeper. A deep link such as `#policy` skips the tour and opens that chapter.

Keys: `1`–`9` chapters · `←` `→` · `T` tour · `Esc` leave the tour · `L` labels · `M` miniature (tilt-shift) · `Space` pause · `R` reset camera · `/` hide UI · `?` help.

## Preview locally

The page is plain HTML with ES modules and three.js from a CDN. There's no build step, but modules need to be served over HTTP:

```bash
git clone https://github.com/chenhunghan/lns-lab && cd lns-lab
python3 -m http.server 8000
# open http://localhost:8000
```

Any static server works (`npx serve`, `caddy file-server`, …). Opening `index.html` straight from disk won't load the modules.

## Files

```
index.html   layout, styles, dialogs
world.js     the three.js diorama: host, microVM, pipes, destinations, post-processing
app.js       the simulation: packets, policy evaluation, approval cards, chapters, UI
clawd.js     the Claude Code mascot: body, canvas-drawn face, moods, speech bubble
examples/    the lns documents the lab shows, as real files
```

## Accuracy

The model follows **lns 0.25** and its documentation. Chapters use the real component names, vsock ports, device layout, merge precedence and CLI verbs. The simplifications:

- Timings are shortened. Real approval cards time out after 60 s, and the lab keeps that.
- Only the macOS (Virtualization.framework) path is drawn. On Linux the hypervisor is KVM with Cloud Hypervisor.
- The internet destinations are illustrative.

Every YAML document the lab displays is in `examples/` and validates:

```bash
cd examples
for f in lns.yaml team-egress.yaml connectors/github/lns.yaml mixins/*/lns.yaml; do lns artifact validate -f "$f"; done
lns inspect -f lns.yaml --mixin ./mixins/anthropic --mixin ./team-egress.yaml --mixin ./mixins/prod-settings
```

## Testing hook

`window.__lab.advance(seconds)` steps the simulation without relying on `requestAnimationFrame`, which is handy for headless screenshots:

```js
__lab.go(6); await __lab.advance(2); __lab.request('linear'); await __lab.advance(3);
```

Inspired by the one-page labs at [lens.lab.sael.net](https://lens.lab.sael.net/), [tt.lab.sael.net](https://tt.lab.sael.net/) and [sael.net/cube-graph](https://sael.net/cube-graph).
