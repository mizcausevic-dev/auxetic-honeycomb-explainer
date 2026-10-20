# Re-entrant honeycomb

A 34-second interactive explainer of an auxetic re-entrant honeycomb. One coupon is stretched in Y. The same kinematic model makes the central gauge taller and wider.

The polymer is not auxetic. The response belongs to the architecture. The motion is illustrative kinematics, not a finite-element result, and it does not report stress, stiffness, stored energy, or an elastic limit.

## Run

```bash
npm install
npm test
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

The build uses relative asset paths so it can be hosted from a GitHub Pages project site.

## What the model does

- Ribs meet at shared nodes. Interior joints have three ribs. There are no pin joints, sliders, or telescoping members.
- Oblique ribs keep length `l`. Vertical ribs keep length `h` and stay vertical.
- A single angle θ, measured from the horizontal, places every node. Negative θ is the re-entrant cell. Increasing θ toward zero opens the cell in both X and Y.
- The bottom rail is fixed in Y. Shoes on that rail move sideways with the end nodes. That is an illustrative, laterally accommodating fixture, not a rigid clamp that the material slides through.
- Gauge length H and width W are distances between tracked interior points. Strains are engineering strains. The secant ratio is ν_sec = −εx / εy, and it is hidden as "—" when εy is near zero.
- A separate inset replays a conventional convex honeycomb at the same axial strain. That example narrows. It is one convex layout, not a claim about every cellular solid.

## Controls

Space plays or pauses. Arrows seek. Home replays. M mutes. F toggles full screen when the browser allows it. Music and effects have separate levels. Reduced motion keeps the clock and the deformation, and cuts the camera instead of flying it. If WebGL is missing, an orthographic drawing of the same model remains.

Audio starts on the first Play. The score and cues are synthesized in the browser. Nothing is sampled from a recording.

## Checks

`npm test` checks welded connectivity, rib-length preservation, clearance, the sign of the secant ratio, unloading back to the initial pose, deterministic samples, and the 34-second shot map. Those checks do not establish structural safety.

## GitHub Pages

`.github/workflows/pages.yml` builds `dist` and deploys it with GitHub Pages. This environment did not have a GitHub login, so the workflow is in the tree and has not been run against a remote.
