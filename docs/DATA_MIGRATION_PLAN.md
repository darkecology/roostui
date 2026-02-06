# Plan: Remove Bulk Data from Git History

## Problem

The `data/` directory contains ~1.9GB of bulk text data files (with ~500MB more
incoming). The `.git` directory is 766MB. These files are pipeline outputs (scans,
detections/tracks, bounding boxes, sweep counts) under various naming conventions
that have evolved over time (e.g., `scans_*.txt`, `tracks_*.txt`, `*_boxes.txt`,
`roost_labels_*.csv`, `sweeps_*.txt`). They don't benefit from version control.

## Goal

Keep only lightweight config files in git. Bulk data lives on doppler (where it's
already deployed via `publish.sh`) and is synced to local machines on demand.

## What stays in git

Per dataset directory:
- `batches.txt`
- `config.json`

Top-level `data/` files (unchanged):
- `config.json` (master dataset list)
- `fetch.sh`, `init_dataset.sh`
- `README.md`
- `default/` directory

Everything outside `data/` is unaffected.

## What gets removed

Everything else in dataset directories. The naming conventions vary per dataset
(controlled by each dataset's `config.json` pattern fields), but they are all
conceptually scans data and detection/box data:

- `scans_*.txt`, `tracks_*.txt` (most datasets)
- `sweeps_*.txt`, `sweeps2_*.txt`, `sweeps3_*.txt` (texas_bats_v3, texas_bats_v3_more)
- `*_boxes.txt`, `scan_list.txt` (greatlakes-2019, train)
- `roost_labels_*.csv` (all_stations_v2_screened -- serves as that dataset's boxes file)
- `*.json~` (editor backup files)

## Prerequisites

### 1. Ensure doppler has all current data

Before rewriting history, confirm the deployed copy on doppler is complete. This
becomes the canonical source for bulk data going forward.

```bash
# From a working copy that has all data
bash publish.sh ui-test
# Verify on doppler that data/ looks right
```

Consider also making an archival copy on doppler outside the web root (e.g.,
`/roost/data-archive/`) in case the deployed copy is ever cleaned up.

### 2. Note any forks

After the history rewrite, forks will have diverged histories. They still work
independently -- you can clone them and access their code and data. But you
cannot `git merge` or `git pull` from a fork into the rewritten repo. To bring
code from a fork into the rewritten repo later, copy files manually or use
`git format-patch`/`git am` on individual commits.

If there's anything in a fork you might want, note which forks exist and what's
useful in them before proceeding.

### 3. Coordinate with colleague

Everyone needs to **re-clone** after the rewrite. Old local clones become
incompatible with the rewritten remote.

Checklist:
- [ ] All in-progress work pushed to origin
- [ ] No uncommitted changes
- [ ] Agree on a time to do the rewrite

## Steps

### 1. Fresh clone for rewriting

`git filter-repo` requires a fresh clone.

```bash
git clone git@github.com:<org>/roostui.git roostui-rewrite
cd roostui-rewrite
```

### 2. Run `git filter-repo`

Install if needed: `pip install git-filter-repo` or `brew install git-filter-repo`.

This rewrites **all branches and tags**. Every branch will have the bulk data
removed from its entire history.

```bash
# List all the known bulk data patterns to remove.
# --invert-paths means "remove paths matching these globs."
git filter-repo \
  --path-glob 'data/*/scans_*.txt' \
  --path-glob 'data/*/tracks_*.txt' \
  --path-glob 'data/*/sweeps_*.txt' \
  --path-glob 'data/*/sweeps2_*.txt' \
  --path-glob 'data/*/sweeps3_*.txt' \
  --path-glob 'data/*/*_boxes.txt' \
  --path-glob 'data/*/scan_list.txt' \
  --path-glob 'data/*/roost_labels_*.csv' \
  --path-glob 'data/*/*.json~' \
  --invert-paths
```

### 3. Add `.gitignore`

```gitignore
# Bulk data files in dataset directories.
# Stored on doppler; sync locally with: cd data && bash sync-data.sh
# Naming conventions vary per dataset (see each dataset's config.json).
data/*/*.txt
data/*/*.csv
!data/*/batches.txt
```

This ignores all `.txt` and `.csv` files in dataset directories, then un-ignores
`batches.txt`. The per-dataset `config.json` files are unaffected (they're
`.json`, not `.txt` or `.csv`). This is forward-compatible: future datasets with
new naming conventions will be ignored automatically.

### 4. Add `data/sync-data.sh`

Script for pulling bulk data from doppler after a fresh clone.

```bash
#!/bin/bash
# Sync bulk data from doppler for local development.
# Usage: bash sync-data.sh [host] [src_path]

HOST=${1:-doppler.cs.umass.edu}
SRC=${2:-/var/www/html/roost/ui/data}

echo "Syncing data from $HOST:$SRC ..."
rsync -avz \
  --include='*/' \
  --include='*.txt' \
  --include='*.csv' \
  --exclude='batches.txt' \
  --exclude='*' \
  "$HOST:$SRC/" .
echo "Done."
```

Note: the rsync source path may need adjusting based on where data/ lives on
doppler after `publish.sh` runs. Check and update accordingly.

### 5. Commit `.gitignore` and `sync-data.sh`

```bash
git add .gitignore data/sync-data.sh
git commit -m "Add .gitignore for bulk data and sync script"
```

### 6. Force-push the rewritten history

```bash
# filter-repo removes the origin remote as a safety measure; re-add it
git remote add origin git@github.com:<org>/roostui.git
git push origin --force --all
git push origin --force --tags
```

### 7. Everyone re-clones

```bash
rm -rf roostui
git clone git@github.com:<org>/roostui.git
cd roostui/data
bash sync-data.sh
```

## Workflow after migration

### Adding a new dataset

Same as before, except the bulk data files are no longer committed:

1. `bash fetch.sh <dataset_name>` -- CSVs land locally, images go to doppler
2. `bash init_dataset.sh <dataset_name>` -- creates `batches.txt` and `config.json`
3. Edit `data/config.json` to add the dataset
4. Test locally (`yarn run serve`)
5. `bash publish.sh` -- deploys to doppler
6. Commit and push -- only `config.json`, `batches.txt`, and per-dataset
   `config.json` enter git (bulk files are auto-ignored)

### Getting data on a new machine

```bash
cd data && bash sync-data.sh
```

## FAQ

**Does filter-repo affect all branches?**
Yes. It rewrites the entire repository history across all branches and tags.

**What happens to forks?**
Forks keep their original history with all data intact. You can still clone them.
You cannot merge from a fork into the rewritten repo (the histories have
diverged). Use `git format-patch`/`git am` or manual copy to bring code over.

**Can I still access the old history?**
Not from the rewritten repo. The forks serve as archives of the old history. You
can also keep a local clone of the original repo before rewriting if you want.

**What if doppler's copy is lost?**
The data is deterministic pipeline output and can be regenerated via
`fetch.sh` from swarm / the roost-system pipeline.
