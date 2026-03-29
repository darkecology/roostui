#!/bin/bash

NAME=${1:-ui-test}
HOST=${2:-doppler.cs.umass.edu}
DST=${3:-/var/www/html/roost-ui-dev}

FULLPATH=$DST/$NAME

ssh $HOST mkdir -p $FULLPATH
rsync -avz --include "index.html" --include "dist**" --include "data**" --exclude "*" --chmod=ug=rwX . $HOST:$FULLPATH/
