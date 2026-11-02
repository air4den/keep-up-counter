# KeepUpCount: MVP Architecture

## Product

KeepUpCount is a browser-based practice app that uses a phone's front camera or a laptop webcam to count soccer keep-ups in real time and identify the body part used.

The complete project, including model-training and deployment code, is published under AGPL-3.0 to comply with the Ultralytics YOLOv8n license.

The MVP will:

- run unlimited practice sessions;
- track one player and one soccer ball;
- count contacts in real time;
- classify contacts as left foot, right foot, left thigh, right thigh, head, or `unknown`;
- show a live count and post-session breakdown; and
- process all camera data locally in the browser.

The MVP will not include accounts, leaderboards, competitive verification, uploads, height estimation, multiple players, or native mobile apps.

## System architecture

```text
Camera
  |
  v
Frame scheduler
  |----------------------|
  v                      v
MediaPipe Pose      ONNX ball detector
  |                      |
  |----------------------|
             v
   Timestamp synchronization
             v
    Kalman ball tracker
             v
   Contact state machine
       |             |
       v             v
     Count      Body-part label
       |-------------|
             v
       React interface
```

React owns screens and session state. Framework-independent TypeScript modules own camera processing, inference, tracking, contact detection, and classification.

## Web application

The client uses React, Vite, and TypeScript.

```text
src/
  app/          screens and navigation
  camera/       permissions and MediaStream lifecycle
  inference/    model adapters, scheduling, and worker messages
  tracking/     Kalman filter and ball-track state
  contacts/     contact detection and body-part classification
  session/      current practice session and summary
  rendering/    preview overlay and coordinate transforms
  diagnostics/  performance and detection diagnostics
  storage/      preferences and local session history
  workers/      inference worker entry point
  types/        shared domain types
public/
  models/       versioned model files
  ort/          pinned ONNX Runtime files
  _headers      Cloudflare Pages headers
```

React state contains setup, permissions, session status, counts, and summaries. High-frequency frame and inference state stays outside React. The camera overlay is drawn directly to a canvas.

## Camera and coordinates

The app requests the front-facing camera after an explicit user action and never requests microphone access.

New camera frames are observed with `HTMLVideoElement.requestVideoFrameCallback()`, which follows the presented video frame rate and supplies presentation metadata. Each accepted frame receives a session-local sequence ID and uses `metadata.mediaTime * 1000` as its source-frame synchronization timestamp. Queueing and inference latency are measured separately with the monotonic `performance.now()` clock. The scheduler does not assume that the callback observes every camera frame.

Every camera stream has an epoch ID. A frame sent for inference carries its stream epoch, frame ID, source timestamp, and oriented visible source dimensions. Results from an obsolete epoch are discarded so a camera restart, resolution change, or orientation change cannot align an old result with a new preview.

Model adapters convert all outputs into one canonical, unmirrored coordinate system based on the oriented visible source frame. The application does not mirror pixels before inference, so MediaPipe's anatomical left and right remain unchanged when the front-camera preview is mirrored.

Model inputs preserve their aspect ratio rather than being stretched. Each adapter records the exact preprocessing transform used for its frame: source and model dimensions, horizontal and vertical scale, and horizontal and vertical offset. For a letterboxed input, the scale is uniform and the offsets are its padding. The adapter applies the inverse transform to points and all four bounding-box edges, rejects detections that lie only in padding, clamps results to the source bounds, and only then publishes an observation. MediaPipe landmarks are likewise mapped from normalized image coordinates, reversing any crop, rotation, or letterboxing performed by the pose adapter. Preprocessing metadata accompanies raw model output only until this postprocessing is complete, except when retained for diagnostics.

Tracking, velocity, contact regions, and proximity tests use aspect-correct source-height units rather than measuring distance directly in independently normalized `[0, 1]` axes:

```text
analysisX = sourcePixelX / sourceHeight
analysisY = sourcePixelY / sourceHeight
```

This keeps horizontal and vertical distances isotropic for portrait, landscape, and square frames. Domain observations may additionally expose conventional normalized coordinates for interchange, but geometry calculations do not use them directly.

Preview mirroring, `object-fit` cropping or letterboxing, canvas scaling, and viewport rotation are rendering-only transforms. They do not travel with inference results. The rendering layer recalculates the current source-to-canvas transform from the result's source dimensions and the current canvas, fit mode, and mirror setting. This keeps delayed results aligned after a resize and prevents display concerns from entering tracking or contact detection.

When a session ends or the camera screen closes, the app cancels the pending video-frame callback, stops all camera tracks, and explicitly releases pending or transferred frame resources.

## Vision models

### Pose

MediaPipe Pose Landmarker detects one person. The app uses the Lite model initially and moves to Full only if recorded-video tests show a meaningful improvement in body-part classification without unacceptable latency.

Segmentation masks are disabled. Pose landmarks are converted into five contact regions:

- each foot uses its ankle, heel, and foot-index landmarks;
- each thigh uses a capsule between its hip and knee; and
- the head uses facial landmarks and estimated head scale.

### Ball

The MVP uses COCO-pretrained Ultralytics YOLOv8n and its `sports ball` class. The model is exported to ONNX and runs through ONNX Runtime Web's WASM execution provider. Model and runtime assets are self-hosted and versioned.

The pretrained model is measured on representative juggling clips using detection recall near contacts and final juggle-count accuracy. Fine-tuning is not required for the baseline MVP.

If the pretrained model misses the MVP accuracy target, it is fine-tuned as a one-class soccer-ball detector using the observed failure cases. Training data then covers varied balls, lighting, backgrounds, devices, motion blur, partial occlusion, small balls, and hard negatives. Dataset splits are separated by recording session rather than adjacent frames.

The detector adapter maps model-space output back through its inverse preprocessing transform and produces a timestamped canonical bounding box, center point, ball size, and confidence. Tracking and contact detection consume the aspect-correct coordinates defined above rather than raw model or display coordinates.

## Inference and concurrency

The MVP runs pose and ball inference sequentially in one dedicated Web Worker so model calls do not block React or the visible camera interface. Pose inference, ball inference, and scheduling use separate interfaces; the scheduler does not depend on worker topology. A future configuration may place the models in separate workers without changing inference consumers.

The scheduler has one latest-frame mailbox rather than a queue. When inference is busy, newer frames replace the waiting frame. Pose and ball each track a target interval and maximum staleness deadline. When the worker becomes free, an overdue model runs first; otherwise the model furthest past its target runs. Ball inference wins only when both are equally due, preventing pose starvation.

Every result includes its frame ID, source-frame timestamp, inference start time, and inference finish time. Synchronization uses the source-frame timestamp; the other times measure queueing, inference, and result age.

Pose and ball results are retained in timestamp-indexed 0.5-second ring buffers. Contact detection interpolates pose landmarks between the samples surrounding the contact timestamp. If suitable pose samples are unavailable or too stale, the body part is `unknown`. The total count may update immediately while the body-part label waits briefly for the following pose sample.

Ball and pose target frequencies and maximum staleness limits are configurable and measured on representative devices. ONNX Runtime's WASM thread count is also configurable rather than assumed; sustained benchmarks select a setting that balances latency, UI responsiveness, heat, and battery use.

The architecture keeps the runtime behind an interface so WebGPU can be added later if WASM cannot meet the performance target.

## Ball tracking and Kalman filter

Use a Kalman filter with position and velocity state to:

- reduce detector jitter;
- estimate ball velocity;
- predict through brief missed detections; and
- associate new detections with the active ball track.

The filter uses a constant-velocity motion model with configurable process and observation noise. It is reset after a long gap or an implausible jump.

Contact detection must not rely only on the smoothed path. It also uses raw detections and the Kalman innovation—the difference between the prediction and observation—because a real contact creates an abrupt motion change that a smooth model may otherwise soften.

The app does not add a separate visual object tracker for the MVP. The Kalman prediction bridges only short gaps; it does not invent a long-lived track when the ball is lost.

## Contact counting

A contact state machine accepts a juggle when the evidence agrees:

- the ball has a plausible upward reversal or sharp trajectory change;
- the change occurs close to a valid body region at the same time;
- ball and pose confidence are sufficient; and
- the state machine is ready for a new contact.

A cooldown and trajectory state prevent double counting. Ambiguous body-part classifications are stored as `unknown`; a physically credible `unknown` contact still increments the total count.

The classifier uses the ball boundary, not just its center, and weights body regions by pose-landmark visibility. Anatomical left and right remain correct even when the preview is mirrored.

## Session data and backend

The MVP has no application backend. Preferences and practice summaries are stored locally in the browser. Small preferences use `localStorage`; session history uses IndexedDB behind a repository interface.

Raw video, images, and frame data are never stored or uploaded.

A backend can be added later for accounts, cross-device history, shared results, or competitive verification without changing the inference and session domain modules.

## Hosting and browser support

Cloudflare Pages hosts the static Vite build, model files, workers, and WASM runtime over HTTPS.

Cross-origin isolation is enabled so ONNX Runtime can use WASM multithreading where available. All inference assets are served from the same origin. HTML uses a short cache lifetime; hashed bundles and versioned model files use immutable caching.

The app supports current Chrome, Edge, Safari, and Firefox on desktop, plus current Chrome on Android and Safari on iPhone. ONNX Runtime Web's WASM provider is the common inference path across all of them.

Startup capability checks select multithreaded or single-threaded WASM and report when the required camera, worker, or model features are unavailable. Optional acceleration never replaces the WASM fallback.

Functional support means the app loads, opens the camera, runs inference, and completes a session. Real-time performance still depends on the device, so the release matrix records which representative devices meet the counting-rate and latency targets. Older browsers, embedded webviews, and devices below the measured performance floor receive a clear compatibility or performance warning.

## Reliability and performance

The interface handles camera denial, unavailable or interrupted cameras, model-loading failures, unsupported browser features, missing players or balls, slow inference, tab backgrounding, rotation, and resizing.

The provisional ball-detection target is at least 15 fresh results per second on representative devices, with no growing queue and no steadily increasing latency. Sustained tests must also check heat and battery behavior.

Recorded-video regression tests measure:

- total count error;
- false and missed contacts;
- body-part classification accuracy;
- ball recall around contact and occlusion;
- inference latency and result age; and
- dropped-frame rate.

Unit tests cover coordinate transforms, mirrored left/right behavior, detector decoding, Kalman tracking, missing observations, contact-state transitions, cooldowns, and body-region geometry.

## Privacy and security

Camera processing stays on the device. The application does not record footage, load third-party scripts into the inference experience, or claim that practice counts are competition-grade or cheat-resistant.

Runtime and model versions are pinned. Cloudflare serves a restrictive permissions policy, cross-origin isolation headers, and a Content Security Policy compatible with the selected worker design.

## Future extensions

The architecture leaves room for WebGPU acceleration, a backend, accounts, cross-device history, leaderboards, competitive verification, ball-height estimates, and a visual tracker between detector frames. These are outside the MVP.
