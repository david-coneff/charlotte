---
description: Groom a repo's state then decompose its monoliths (docs via rhiz-Merkle, single-file code via build-roll-up) and stage universal lessons.
argument-hint: "[optional path to a single file to partition]"
---

Run the **rhiz-Partition** procedure on the current repository. The canonical
spec is `david-coneff/rhizome` → `rhizome/modules/rhiz-partition/rhiz-partition.md`
— read it first (simultaneous repo access is assumed). Execute its phases in
order; **do not skip the gates**.

1. **Orient.** Load rhiz-Core and this repo's `rhiz-memory/_instance.md`,
   `state/SESSION_HANDOFF.md`, `state/RESUME_BLOCK.md`. Inventory every file's
   line and byte size; classify each as product code / documentation /
   rhiz-memory. Note the project charter (sovereign over product-code structure).

2. **Coherence first (gate).** Run a rhiz-Audit repository-census + coherence
   pass and **fix** memory↔code drift, stale references, broken cross-links, and
   contradictions **before** splitting anything.

3. **Refresh state (gate).** Bring `SESSION_HANDOFF.md` and `RESUME_BLOCK.md`
   current.

4. **Identify monoliths.** List every file over **500 lines OR 50 KB** (or the
   charter's own threshold).

5. **Partition each by modality:**
   - **Docs / memory / governance prose → rhiz-Merkle** (`doc-graph.py split …`,
     then write section descriptions, cross-link, `verify`). Respect an existing
     project convention (Charlotte's decision log partitions by AD range). Keep a
     coherent unit whole when shredding would harm a sequential read; record why.
   - **Single-file code deliverables → modular source + build-roll-up (DS-002)** —
     small `src/` modules compiled into the one shipped file by Vite/rollup/
     esbuild; built artifact is output-only; verify equivalence + suite green.
     Charlotte's charter permits this as of AD-081 (runtime stays zero-install;
     build tools are `devDependencies`).
   - **A coherent unit kept whole on purpose → leave + flag** as an OBSERVATION
     (Charlotte keeps its crawl engine and the HTA whole; AD-009/14/16).

6. **Package universal lessons** into `rhiz-memory/RHIZOME-CORE-CANDIDATES.md`
   (transferable, evidence-cited). If `david-coneff/rhizome` is in scope, promote
   them (review lenses → rhiz-Audit catalog; working methods →
   cross-project-design-standards; merge, don't duplicate) and retire the file to
   a promotion record.

7. **Record and hand off** — add an ADR; update the `_instance.md` memory map;
   refresh `SESSION_HANDOFF.md` / `RESUME_BLOCK.md` to name the new root indexes;
   commit.

If a path is given as an argument ($ARGUMENTS), partition just that file — still
running the coherence and state gates for its neighbourhood first.
