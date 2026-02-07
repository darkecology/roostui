#!/bin/bash

NAME=${1:-ui-test}
HOST=${2:-doppler.cs.umass.edu}
DST=${3:-/var/www/html/roost/}

FULLPATH=$DST/$NAME

ssh $HOST mkdir -p $FULLPATH
rsync -avzO --include "index.html" --include "dist**" --include "data**" --include "viewer**" --exclude "*" --chmod=ug=rwX . $HOST:$FULLPATH/
