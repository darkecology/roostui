# RoostUI
> Web interface to visualize bird roosts in NEXRAD radar data that are detected and tracked by AI

## Prerequisites

* Node.js and [Yarn](https://yarnpkg.com/lang/en/docs/install/)

## Build and run

```
yarn install
yarn run build        # builds annotation app + viewer
yarn run serve        # serves on port 8888
```

Use `yarn run watch-serve` to rebuild on edits and serve.

## Annotation app

The main app for labeling roost detections. Open `http://localhost:8888` and select a dataset/batch.

## Viewer

Standalone read-only viewer. Open `http://localhost:8888/viewer/`.
