# The Observatory — isolated design concept 02

This branch wraps the actual Chair, price-provenance and Streamer components from
commit `12c9d12f0787825fc4be5b27e4144232df69eed3` in a new, preview-only composition.
The original call component source is unchanged. The approved entrance, guide
cards, styling and full navigation now share source with the staged application
integration in PR #231. This is still not a full production clone or trading
simulator; the preview harness and synthetic fixtures are never merged into the app.

The default route is the immersive experience. `/?qa=1` opens the comparison
workbench, including the original Quiet, Full and Streamer designs. Focus mode
removes the introduction and character cards while keeping the call accessible.
The footer's Preview controls change the synthetic call; no engine runs.

The full site navigation is now visible. Lab, Gallery, Books, Chamber and Settings
are direct desktop links; All sections retains every destination. Phone shortcuts
include Floor, Lab, Gallery and Settings, plus a complete menu. In this isolated
preview, these links explicitly open the **current live site in a new tab**. They
do not pretend to display staged Lab or Settings data.

- Synthetic fixtures only; no production database or credentials.
- No server process, account routes, live market feeds or analytics.
- `connect-src 'none'` blocks browser data requests, beacons and WebSockets.
- Only selected public artwork, the compiled frontend, robots.txt and source
  fingerprints are published. Source maps and repository files are not published.
- No-index metadata and robots.txt discourage search indexing; this is not access
  control. The preview contains only public code/artwork and synthetic readings.
- The viewport picker loads the same components in a real, fixed-width iframe so
  their original media queries run at desktop, tablet and phone widths.

Build from the repo root:

```sh
npm ci
node --test preview/extract.test.mjs
npx vite build --config preview/vite.config.mjs
```

Publish `preview-dist` as a Render Static Site. No environment groups, database,
secrets, custom domain or paid compute plan are required. Automatic deploys are
off so changes to production or the draft polish PR do not silently update this
preview. Render's existing workspace build/bandwidth usage allowances still apply.

Before updating, verify the five UI source fingerprints and concept fingerprints,
rerun tests/build, then manually deploy this preview branch. Update the component
base commit only if those original component sources change.
Never merge the preview harness into production just to publish the visual changes.
