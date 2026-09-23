# Physical Component Assets

The initial 14 PNG images were supplied on 2026-09-07. Two subsequently supplied
lamp-holder images replace the bare-bulb display and add an illuminated appearance.
There are now 17 display assets and 20 unchanged source images, including the
retired bare bulb. Images 1, 8, and 9 are byte-identical, confirmed by SHA-256:
`16dcf1ae21a55a1ef65caedfd00f8d4537162fd99298ef74c35624c47dc66f35`.

All originals are retained unchanged under `public/assets/components/originals/`.
`public/assets/components/manifest.json` records the exact original filenames,
archive filenames, original hashes, crop rectangles, and alpha statistics.
The retired source 12 has status `archived`, no active `assetFile`, and
`supersededBy: 15`; all other sources remain active.

## Identifications

| Source number | Display asset | Identified component | Connection details |
| --- | --- | --- | --- |
| 1, 8, 9 | `switch-open.png` | Single-pole single-throw knife switch, open | Two visible red binding posts. |
| 2 | `switch-closed.png` | Single-pole single-throw knife switch, closed | Two visible red binding posts; same component type as the open state. |
| 3 | `voltmeter.png` | Analog voltmeter, 3 V / 15 V | Three posts: common negative, 3 V positive, 15 V positive. |
| 4 | `ammeter.png` | Analog ammeter, 0.6 A / 3 A | Three posts: common negative, 0.6 A positive, 3 A positive. |
| 5 | `galvanometer.png` | Sensitive galvanometer, G | Negative left, positive right; no numerical sensitivity inferred. |
| 6 | `motor-fan.png` | Teaching motor with fan and base | Two visible red binding posts. |
| 7 | `motor-bare.png` | Bare cylindrical motor | Electrical terminals are not visible in this view. Any editor ports must be explicitly treated as schematic connection points. |
| 10 | `switch-spdt.png` | Single-pole double-throw knife switch | Three posts; central pivot is the common connection. The supplied blade is in the open position. |
| 11 | `battery-pack.png` | Two-cell battery pack | Positive left, negative right. Cell chemistry and actual voltage cannot be established from the image alone. |
| 12 | Archived original only | Bare screw-base incandescent bulb | Replaced by the unlit holder; the original file is retained unchanged. |
| 13 | `resistor.png` | Fixed resistor on teaching base | Two visible binding posts; resistance value is not legible. |
| 14 | `rheostat.png` | Four-terminal sliding rheostat | Two end terminals for the resistance winding and two for the slider rail; all four contacts should remain available. |
| 15 | `lamp-bulb.png` | Lamp in a teaching holder, unlit | Default lamp appearance; contacts are the two red binding posts. Existing `lamp-bulb` IDs remain valid. |
| 16 | `lamp-on.png` | Lamp in a teaching holder, illuminated | Alternative appearance with two red binding posts. Simulation can select registered on/off state images. |
| 17 | `battery-single.png` | Single cell in a holder | Positive left, negative right; voltage is configured by the experiment. |
| 18 | `power-supply.png` | DC power source | Gray negative left, red positive right; no rated output is inferred from the image. |
| 19 | `potentiometer.png` | Three-pin rotary potentiometer | A/W/B are illustrative pin roles, pending datasheet or measurement confirmation. |
| 20 | `buzzer.png` | Two-pin buzzer | Active/passive construction and polarity cannot be established; simulation uses a configurable equivalent load. |

Both holder appearances keep the electrical terminal IDs `left` and `right`, so
old drafts and existing connections survive the asset replacement and appearance
changes. The binding-post anchors are measured in source pixels: unlit
`left=(45,182)`, `right=(289,184)`; illuminated `left=(43,183)`,
`right=(262,183)`. Wires leave the left post to the left and the right post to the
right. Each appearance is displayed at width 140 with its own unchanged aspect
ratio; the different source dimensions are not stretched to a shared height.

## Display Crops

Coordinates are zero-based source pixels. Only the fully transparent exterior
was removed, using the bounding rectangle of pixels whose alpha is greater than
zero. Images were not resized, recolored, flattened, or background-removed.
Partial transparency and opaque black details are preserved.

| Asset | Original width x height | Crop left, top | Display width x height |
| --- | --- | --- | --- |
| `switch-open.png` | 160 x 160 | 16, 43 | 127 x 73 |
| `switch-closed.png` | 147 x 64 | 0, 0 | 147 x 63 |
| `voltmeter.png` | 189 x 189 | 25, 10 | 139 x 174 |
| `ammeter.png` | 191 x 192 | 25, 10 | 139 x 175 |
| `galvanometer.png` | 134 x 173 | 0, 0 | 134 x 173 |
| `motor-fan.png` | 124 x 125 | 0, 0 | 124 x 124 |
| `motor-bare.png` | 130 x 85 | 0, 0 | 129 x 85 |
| `switch-spdt.png` | 136 x 111 | 0, 0 | 136 x 110 |
| `battery-pack.png` | 197 x 197 | 11, 75 | 174 x 47 |
| `lamp-bulb.png` | 336 x 311 | 0, 0 | 336 x 311 |
| `lamp-on.png` | 306 x 306 | 0, 0 | 306 x 306 |
| `resistor.png` | 196 x 198 | 9, 63 | 178 x 73 |
| `rheostat.png` | 220 x 220 | 8, 58 | 206 x 119 |
| `battery-single.png` | 119 x 47 | 0, 0 | 118 x 47 |
| `power-supply.png` | 141 x 108 | 0, 0 | 141 x 107 |
| `potentiometer.png` | 86 x 108 | 0, 0 | 85 x 107 |
| `buzzer.png` | 76 x 82 | 0, 0 | 76 x 82 |

All 20 source files decode as 32-bit ARGB and contain both fully transparent and
partially transparent pixels. All display assets are preserved as exact crops
of the source images. A visual contact sheet of the initial sources is
available at `artifacts/physical-source-sheet.png`.

## Original File Mapping

| Source | Original filename | Archived filename |
| --- | --- | --- |
| 1 | `codex-clipboard-7e386bc8-7131-47e3-9c95-1e85ec20c20a.png` | `originals/01-switch-open.png` |
| 2 | `codex-clipboard-5ea6c97f-0593-400f-9b42-a104bd2e8e9a.png` | `originals/02-switch-closed.png` |
| 3 | `codex-clipboard-82ec107f-9b79-41d4-af4c-b96e8e259db9.png` | `originals/03-voltmeter.png` |
| 4 | `codex-clipboard-c8bd991b-40b6-44d2-8475-92ef5bd35b1a.png` | `originals/04-ammeter.png` |
| 5 | `codex-clipboard-8ca68f58-11da-41fe-9ac4-909418d59940.png` | `originals/05-galvanometer.png` |
| 6 | `codex-clipboard-8f035768-2c9d-418a-a16a-510607d6e23f.png` | `originals/06-motor-fan.png` |
| 7 | `codex-clipboard-9931fafc-022f-4b43-ba37-a76ee3f5da87.png` | `originals/07-motor-bare.png` |
| 8 | `codex-clipboard-146184aa-b93d-4837-8665-5252f6a12091.png` | `originals/08-switch-open.png` |
| 9 | `codex-clipboard-c10f5719-7868-4d89-ab55-7c43722b3266.png` | `originals/09-switch-open.png` |
| 10 | `codex-clipboard-82772e81-1f1c-4de1-8b88-b21189a8034d.png` | `originals/10-switch-spdt.png` |
| 11 | `codex-clipboard-2ad87372-fcc6-4916-86cc-d534dea9ee36.png` | `originals/11-battery-pack.png` |
| 12 | `codex-clipboard-4c5747b0-a1ae-4415-8ee1-95e3c7c76c4f.png` | `originals/12-lamp-bulb.png` |
| 13 | `codex-clipboard-91ab2583-94f9-4b49-85e6-625b84c7bbb3.png` | `originals/13-resistor.png` |
| 14 | `codex-clipboard-c406193a-ebb0-42e0-bd88-cc154fed5412.png` | `originals/14-rheostat.png` |
| 15 | `灯泡关闭.png` | `originals/15-lamp-bulb.png` |
| 16 | `灯泡点亮.png` | `originals/16-lamp-on.png` |
| 17 | `codex-clipboard-82b710ce-5881-4ba3-bc1f-a885ce2bb2d3.png` | `originals/17-battery-single.png` |
| 18 | `codex-clipboard-96d77b35-4eb9-4519-bb6d-8e1fe61a8334.png` | `originals/18-power-supply.png` |
| 19 | `codex-clipboard-10dc9ec9-8eee-4d65-bf12-2e394cf34720.png` | `originals/19-potentiometer.png` |
| 20 | `codex-clipboard-6edfb651-f671-4946-8290-066e09264040.png` | `originals/20-buzzer.png` |

## Dynamic Experiment Layers

`getVisualOrientation(component, mode)` separates `realOrientation` from the
schematic `orientation`. Physical images default to their upright source view;
an explicit physical rotation is independent of schematic rotation.

`scripts/prepare-dynamic-assets.ps1` reproducibly creates the separate
`dynamic/` images. Original and default display files remain unchanged.
Ammeter and voltmeter `meterDial` metadata uses source-pixel coordinates with
SVG angles (zero points right). The original scale, case and clamping posts are
retained, and only the fixed needle is removed from a derived base image.
The renderer adds the calculated or manually selected needle separately.
The ammeter uses pivot `(68,78)` and voltmeter `(69,78)`, both radius `68` and
angles `-140` through `-40` degrees. Their connection anchors now meet the
bottom clamping nut at source `y=137`, with `contact: 'binding-post'` metadata
for the wire ferrule. The galvanometer sockets are marked `contact: 'socket'`.

Rheostat `sliderVisual` provides a cleaned base and a transparent 30 x 72 slider.
`left=59` and `right=147` are the slider-center travel limits, not image-left
coordinates. The slider is drawn at `x=center-width/2`, `y=top` in source pixels.
The winding and rail terminals do not move when the slider changes resistance.

Lamp and switch `stateImages` are pre-registered to each asset's canvas and two
electrical anchors. Changing state uses the registered image while retaining
the selected asset's dimensions and ports, so wires remain attached. These
derived state images use an affine fit; archive and palette images retain their
original proportions.

## Reimporting

On Windows with PowerShell and System.Drawing, run from the project directory:

```powershell
./scripts/import-physical-assets.ps1 -SourceDirectory 'C:/path/to/source/pngs' -LampDirectory 'C:/path/to/lamp/pngs'
```

The source directory contains the initial 14 and latest 4 original filenames, and the lamp
directory contains the two newer holder images. Missing source files can be
restored from the existing unchanged archive. The script regenerates the source
archive, display assets, and structured manifest without promoting retired
source 12 back into the display library. Repeated active asset names are accepted
only when their original hashes match.
