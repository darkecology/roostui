#!/bin/bash

# This corresponds to the EXPERIMENT_NAME that we set when launching roost-system for inference
# and the Dataset name that will be displayed in the UI
DATASET_NAME=${1}
SRC=${2:-swarm.cs.umass.edu:/mnt/nfs/scratch1/wenlongzhao/roosts_data}
HOST=${3:-doppler.cs.umass.edu}
DST=${4:-/var/www/html/roost/img}

echo "name is $DATASET_NAME"

# Images
ssh $HOST mkdir -p $DST/$DATASET_NAME
rsync -avz $SRC/$DATASET_NAME/ui/img/* $HOST:$DST/$DATASET_NAME/

# CSV files
rsync -avz $SRC/$DATASET_NAME/ui/scans_and_tracks/ $DATASET_NAME/