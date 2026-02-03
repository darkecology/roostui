# RoostUI
> Web interface to visualize bird roosts in NEXRAD radar data that are detected and tracked by AI

## Prerequisites

* Node.js and [Yarn](https://yarnpkg.com/lang/en/docs/install/)

## Annotation app

The main app for labeling roost detections.

```
yarn install
yarn run build
yarn run serve        # serves on port 8888
```

Open `http://localhost:8888` and select a dataset/batch.

Use `yarn run watch-serve` to rebuild on edits.

## Test viewer

Standalone read-only viewer with hard-coded sample data (KCLE 8/20/2020). Lives in `test-viewer/`.

```
npx rollup -c test-viewer/rollup.config.js
yarn run serve
```

Open `http://localhost:8888/test-viewer/`.
